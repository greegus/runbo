<script setup lang="ts">
import { v4 as uuid } from 'uuid'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BodyweightQuickAdd from '@/components/BodyweightQuickAdd.vue'
import DiagnosticsList from '@/components/DiagnosticsList.vue'
import ReadinessSheet from '@/components/ReadinessSheet.vue'
import StatTile from '@/components/StatTile.vue'
import ComebackCard from '@/components/today/ComebackCard.vue'
import TodayCard from '@/components/today/TodayCard.vue'
import type { Diagnostic } from '@/liftoscript/diagnostics'
import { buildStrengthPlan, draftFromPlan } from '@/session/strengthSession'
import {
  buildToday,
  claimedOutcome,
  comebackPatch,
  strengthHeadline,
  swappedOutcome,
  type TodayOverride,
} from '@/session/today'
import { useBodyweightStore } from '@/stores/bodyweight'
import { useProfileStore } from '@/stores/profile'
import { type SessionDraft, useSessionsStore } from '@/stores/sessions'
import { planCardioWeek } from '@/training/cardioPlan'
import type { ReadinessInput } from '@/training/readiness'
import { plannedCardioDays } from '@/training/schedule'
import type { PlannedItem, Session } from '@/types'
import { startOfWeekMonday, toIso } from '@/utils/date'

/**
 * The home screen: one card, one tap to the bar.
 *
 * The clock is read here and nowhere else below, and threaded into every pure
 * call as `todayIso`. Every decision (rest day, claim,
 * swap, deload, streak, tiles) comes from `buildToday`; this view only owns the
 * async edges: starting a session, accepting a comeback, saving a weight.
 */
const router = useRouter()
const profileStore = useProfileStore()
const sessionsStore = useSessionsStore()
const bodyweightStore = useBodyweightStore()

/**
 * The clock is read here and only here: once on mount, again whenever the app is
 * re-activated, and once more immediately before a write. A phone app is left
 * open across midnight as a matter of course, and a session started at 00:30
 * against yesterday's date is misfiled in the rollup, the streak and the cursor.
 */
const todayIso = ref(toIso(new Date()))

const model = computed(() =>
  profileStore.profile ? buildToday(profileStore.profile, sessionsStore.weekSessions, todayIso.value) : null,
)

/**
 * A claim or a swap is a pure recomposition and persists NOTHING: the program
 * day the athlete actually trains is recorded on the session, and
 * `finishSession` derives the cursor from that. So the chosen item lives here,
 * in local state, until the session document is created.
 */
const override = ref<TodayOverride | null>(null)

const item = computed<PlannedItem | null>(() => (override.value ? override.value.item : (model.value?.item ?? null)))
const explanation = computed(() => override.value?.explanation ?? model.value?.explanation ?? null)

/**
 * Derived from the EFFECTIVE item, not from the model: a claimed or swapped
 * strength day is exactly the case where the athlete has no idea what weight is
 * coming, and `model.headline` only ever describes the originally planned item.
 */
const headline = computed(() =>
  item.value?.kind === 'strength' && profileStore.profile
    ? strengthHeadline(profileStore.profile, item.value.programDay)
    : null,
)

const busy = ref(false)
const startError = ref<string | null>(null)
/** A program that does not prescribe cannot start a session; the parser says why. */
const planDiagnostics = ref<Diagnostic[]>([])

const readinessOpen = ref(false)
const pendingItem = ref<PlannedItem | null>(null)

const comebackProposal = computed(() => model.value?.resolution.comebackProposal ?? null)
/** Local only: dismissing persists nothing, so the offer returns while the gap holds. */
const comebackDismissed = ref(false)
const comebackBusy = ref(false)
const comebackError = ref<string | null>(null)

const bodyweightBusy = ref(false)
const bodyweightError = ref<string | null>(null)

/**
 * The auth store binds the profile and the sessions, but not the weights — so
 * this view owns both the bind and the teardown. It is driven by the uid, not by
 * the list being empty: a second account signing in without a reload would
 * otherwise keep reading the first account's rows.
 */
watch(
  () => profileStore.profile?.id,
  (uid) => {
    if (uid) bodyweightStore.bind(uid)
    else bodyweightStore.reset()
  },
  { immediate: true },
)

function refreshToday(): void {
  const now = toIso(new Date())
  if (now === todayIso.value) return

  const previousWeek = startOfWeekMonday(todayIso.value)
  todayIso.value = now
  // A claim or a swap belongs to the day it was made on.
  override.value = null
  comebackDismissed.value = false

  // The live window is anchored on the week it was bound in.
  const uid = profileStore.profile?.id
  if (uid && startOfWeekMonday(now) !== previousWeek) sessionsStore.bind(uid, now)
}

function onVisible(): void {
  if (document.visibilityState === 'visible') refreshToday()
}

/**
 * DECISION: the block is rolled forward here, over blocks that have ENDED, and
 * never over the one on screen — adopting the current block would re-anchor it
 * while the planner keeps planning from that anchor, so today's prescription
 * would jump mid-block. `adoptCardioBlock` is idempotent (it refuses an action
 * the stored anchor no longer matches), so a second tab, a reload or a stale
 * snapshot is a no-op; one block is adopted per snapshot and the listener echo
 * re-fires this watcher until the state reaches today.
 *
 * `planCardioWeek` is called directly rather than through `planWeek`: the write
 * needs the mesocycle numbers and nothing else, and composing a week around them
 * only invited the anchor of the composed week and the anchor of the block to
 * disagree.
 */
let adopting = false

async function adoptEndedCardioBlocks(): Promise<void> {
  const profile = profileStore.profile
  if (!profile || adopting) return

  const action = profileStore.pendingCardioBlock(sessionsStore.weekSessions, todayIso.value)
  if (action.kind === 'idle') return

  adopting = true
  try {
    const plan =
      action.kind === 'advance'
        ? planCardioWeek(profile.cardioTrack, action.ratio, plannedCardioDays(profile.availability))
        : undefined

    await profileStore.adoptCardioBlock(action, plan)
  } catch (error) {
    console.error('[today] could not adopt the cardio block', error)
  } finally {
    adopting = false
  }
}

watch(
  () => [profileStore.profile, sessionsStore.weekSessions] as const,
  () => void adoptEndedCardioBlocks(),
  {
    immediate: true,
  },
)

onMounted(() => {
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', refreshToday)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('focus', refreshToday)
})

const tonnage = computed(() => {
  const rollup = model.value?.rollup
  if (!rollup) return null

  return { value: Math.round(rollup.tonnage.value), unit: rollup.tonnage.unit }
})

function routeFor(session: Session): 'strength-session' | 'cardio-session' {
  return session.kind === 'strength' ? 'strength-session' : 'cardio-session'
}

function onClaim(): void {
  if (!model.value) return
  override.value = claimedOutcome(model.value)
}

function onSwap(): void {
  if (!model.value) return
  override.value = swappedOutcome(model.value)
}

function undoOverride(): void {
  override.value = null
}

/** The readiness sheet sits between the tap and the write, and never blocks. */
function onStart(): void {
  // A day that is already logged has nothing to start. The card refuses to emit
  // this, but the guard belongs here too: a second session for the same day
  // would advance the rotation twice.
  if (!item.value || model.value?.doneSession) return

  startError.value = null
  planDiagnostics.value = []
  pendingItem.value = item.value
  readinessOpen.value = true
}

async function onResume(session: Session): Promise<void> {
  await router.push({ name: routeFor(session), params: { id: session.id } })
}

async function startSession(readiness?: ReadinessInput): Promise<void> {
  const profile = profileStore.profile
  const target = pendingItem.value
  if (!profile || !target || busy.value) return

  // A desktop tab that never fires a visibility or focus event can still be the
  // one crossing midnight, so the date is re-read at the moment of the write.
  refreshToday()

  busy.value = true
  startError.value = null

  try {
    /**
     * The id is generated HERE and the write is deliberately not awaited.
     * Offline, `setDoc` stays pending until reconnect while the document is
     * already durable in the persistent cache and visible to the live listener
     * under this id — waiting on the ack would strand the athlete on the Today
     * card with 'Starting…' and no way forward. A genuine rejection (rules, bad
     * payload) surfaces as the start error.
     */
    const id = uuid()

    const write = (draft: SessionDraft): void => {
      void sessionsStore.startSession({ ...draft, id }).catch((error: unknown) => {
        console.error('[today] could not write the new session', error)
        startError.value = 'Could not start the session. Check your connection and try again.'
      })
    }

    if (target.kind === 'strength') {
      const plan = buildStrengthPlan(profile, target.programDay)

      // A broken program prescribes nothing sane — refuse rather than guess.
      if (plan.diagnostics.length > 0) {
        planDiagnostics.value = plan.diagnostics
        return
      }

      write(draftFromPlan(plan, todayIso.value, readiness))
      await router.push({ name: 'strength-session', params: { id } })
      return
    }

    write({
      date: todayIso.value,
      kind: 'cardio',
      prescription: target.prescription,
      source: 'manual',
      ...(readiness ? { readiness } : {}),
    })
    await router.push({ name: 'cardio-session', params: { id } })
  } catch (error) {
    console.error('[today] could not start the session', error)
    startError.value = 'Could not start the session. Check your connection and try again.'
  } finally {
    busy.value = false
    pendingItem.value = null
  }
}

async function onComebackAccept(): Promise<void> {
  const profile = profileStore.profile
  const proposal = comebackProposal.value
  if (!profile || !proposal || comebackBusy.value) return

  comebackBusy.value = true
  comebackError.value = null

  try {
    await profileStore.save(comebackPatch(profile, proposal))
    // The gap that produced the proposal is unchanged until a session is
    // logged, so without this the card redraws from the already-reduced
    // weights and a second tap cuts them again.
    comebackDismissed.value = true
  } catch (error) {
    console.error('[today] could not apply the comeback', error)
    comebackError.value = 'Could not save the comeback. Check your connection and try again.'
  } finally {
    comebackBusy.value = false
  }
}

async function onBodyweight(payload: { date: string; weight: number }): Promise<void> {
  if (bodyweightBusy.value) return

  bodyweightBusy.value = true
  bodyweightError.value = null

  try {
    await bodyweightStore.add(payload.date, payload.weight)
  } catch (error) {
    console.error('[today] could not save the bodyweight', error)
    bodyweightError.value = 'Could not save the weight. Check your connection and try again.'
  } finally {
    bodyweightBusy.value = false
  }
}
</script>

<template>
  <section class="mx-auto flex max-w-lg flex-col gap-4 p-4">
    <h1 class="text-2xl font-bold text-ink-900">Today</h1>

    <!-- The profile and the session snapshot both arrive asynchronously; a
         "rest day" flashed before they land would be a lie. -->
    <div v-if="!model" role="status" class="flex flex-col gap-4" aria-busy="true">
      <span class="sr-only">Loading today's plan…</span>
      <div class="h-44 animate-pulse rounded-xl bg-ink-100" />
      <div class="grid grid-cols-2 gap-3">
        <div v-for="index in 4" :key="index" class="h-24 animate-pulse rounded-lg bg-ink-100" />
      </div>
    </div>

    <template v-else>
      <ComebackCard
        v-if="comebackProposal && !comebackDismissed"
        :proposal="comebackProposal"
        :busy="comebackBusy"
        :error="comebackError"
        @accept="onComebackAccept()"
        @dismiss="comebackDismissed = true"
      />

      <TodayCard
        :item="item"
        :is-rest-day="model.resolution.isRestDay && override === null"
        :is-deload-week="model.isDeloadWeek"
        :catch-up="model.catchUp"
        :can-claim="model.canClaim && override === null"
        :can-swap="model.canSwap && override === null"
        :headline="headline"
        :zones="profileStore.profile?.cardioTrack.zones"
        :active-session="model.activeSession"
        :done-session="model.doneSession"
        :explanation="explanation"
        :busy="busy"
        :error="startError"
        @start="onStart()"
        @resume="onResume($event)"
        @claim="onClaim()"
        @swap="onSwap()"
      />

      <button
        v-if="override"
        type="button"
        class="min-h-[48px] rounded-xl border border-ink-200 px-4 text-base font-medium text-ink-700"
        @click="undoOverride()"
      >
        Back to the planned day
      </button>

      <div v-if="planDiagnostics.length" class="flex flex-col gap-2 rounded-xl border border-accent-300 p-4">
        <h2 class="text-base font-semibold text-ink-900">This session cannot start</h2>
        <p class="text-sm text-ink-700">Your program text does not parse, so nothing can be prescribed.</p>
        <DiagnosticsList :diagnostics="planDiagnostics" />
        <router-link
          :to="{ name: 'program' }"
          class="min-h-[48px] rounded-xl border border-ink-300 px-4 py-3 text-center text-base font-semibold text-ink-700"
        >
          Fix the program
        </router-link>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <StatTile label="Streak" :value="model.streak" unit="sessions" icon="check" emphasis />
        <StatTile
          label="Strength"
          :value="`${model.rollup.strength.done}/${model.rollup.strength.planned}`"
          icon="dumbbell"
          hint="done this week"
        />
        <StatTile
          label="Cardio"
          :value="model.rollup.cardio.doneMinutes"
          unit="min"
          icon="run"
          :hint="`of ${model.rollup.cardio.plannedMinutes} min planned`"
        />
        <StatTile
          v-if="tonnage"
          label="Tonnage"
          :value="tonnage.value"
          :unit="tonnage.unit"
          icon="weight"
          hint="lifted this week"
        />
      </div>

      <BodyweightQuickAdd
        v-if="profileStore.profile"
        :today-iso="todayIso"
        :unit="profileStore.profile.settings.units"
        :entry="bodyweightStore.entryOn(todayIso)"
        :entries="bodyweightStore.entries"
        :busy="bodyweightBusy"
        :error="bodyweightError"
        @submit="onBodyweight($event)"
      />
    </template>

    <ReadinessSheet
      v-model:open="readinessOpen"
      :kind="pendingItem?.kind === 'cardio' ? 'cardio' : 'strength'"
      :busy="busy"
      @submit="startSession($event)"
      @skip="startSession()"
    />
  </section>
</template>
