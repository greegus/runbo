<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { Button, Icon, IconButton, useDialogStack } from 'vuiii'

import DiagnosticsList from '@/components/DiagnosticsList.vue'
import ReadinessSheet from '@/components/ReadinessSheet.vue'
import RestTimer from '@/components/RestTimer.vue'
import TierBlock from '@/components/strength/TierBlock.vue'
import { deleteSession, loadSession, saveSession } from '@/services/sessionsService'
import { loggedCount } from '@/session/setCycle'
import {
  applyLoggedSets,
  applyWorkingWeight,
  buildStrengthPlan,
  finishBlockedReason,
  loggedSetsFromSession,
} from '@/session/strengthSession'
import type { LoggedSet } from '@/session/types'
import { useProfileStore } from '@/stores/profile'
import { useSessionsStore } from '@/stores/sessions'
import type { ReadinessInput } from '@/training/readiness'
import { detectNewRecords, type NewRecord } from '@/training/stats'
import type { Session, WeightValue } from '@/types'
import { playRestAlert, primeRestAlert } from '@/utils/restAlert'

/**
 * The strength session screen.
 *
 * It owns three things and delegates everything else: WHEN a write happens,
 * WHEN the rest clock restarts, and WHICH panel is on screen. Every training
 * rule comes from `@/session/strengthSession` and every progression from
 * `useSessionsStore.finishSession` — nothing here computes a weight, a stage or
 * a summary line.
 *
 * Persistence, in the order that matters:
 *  1. the document was created by `startSession` BEFORE this screen was reached,
 *     so a dead phone loses nothing that was already written;
 *  2. set changes autosave on an 800 ms trailing debounce — a write per tap
 *     costs a round trip per rep correction, and a write only on finish loses a
 *     whole session to a screen lock;
 *  3. the debounce is flushed on leave, on unmount, when the tab is hidden and
 *     immediately before finishing, so the only work at risk is the last 800 ms;
 *  4. finishing is ONE call to `finishSession`, which batches the session, the
 *     state snapshot and the profile patch. Splitting it breaks
 *     delete-last-and-restore.
 */
const props = defineProps<{ id: string }>()

const router = useRouter()
const dialog = useDialogStack()
const profileStore = useProfileStore()
const sessionsStore = useSessionsStore()

const AUTOSAVE_MS = 800
const SAVE_FAILED = 'We couldn’t save that. It will be retried — keep logging.'

/**
 * Firestore resolves a write only when the SERVER acknowledges it, while the
 * document is durable in the persistent cache the moment it is written. Offline
 * that means a promise that never settles, so the screen waits a short while for
 * the ack and then carries on — the write is not lost, only unconfirmed.
 */
const QUEUED = Symbol('queued')
const QUEUED_AFTER_MS = 2500

function settleOrQueued<T>(write: Promise<T>): Promise<T | typeof QUEUED> {
  return Promise.race([
    write,
    new Promise<typeof QUEUED>((resolve) => setTimeout(() => resolve(QUEUED), QUEUED_AFTER_MS)),
  ])
}

const RECORD_LABELS: Record<NewRecord['kind'], string> = {
  weight: 'Heaviest set',
  e1rm: 'Estimated 1RM',
  amrapReps: 'Most reps in a set',
}

const session = shallowRef<Session | null>(null)
const logged = ref<LoggedSet[][]>([])
const collapsed = ref<boolean[]>([])

const resolving = ref(true)
const notFound = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

const finished = shallowRef<Session | null>(null)
const records = shallowRef<NewRecord[]>([])
/** The session is finished locally but the batch has not been acknowledged yet. */
const pendingSync = ref(false)

const readinessOpen = ref(false)
const readinessHandled = ref(false)

const restSeconds = ref(0)
const restStartedAt = ref<number | null>(null)
const restLabel = ref('')

const profile = computed(() => profileStore.profile)

/**
 * The prescription is rebuilt from the profile, never read off the document:
 * warmups, plate hints and rep targets are display data that was deliberately
 * not persisted, and `programDay` is all that is needed to get them back.
 */
const plan = computed(() => {
  const current = session.value
  if (!profile.value || !current || current.kind !== 'strength') return null

  return buildStrengthPlan(profile.value, current.programDay ?? '')
})

/** Program days are named by the athlete, and many are already called "Day 1". */
const dayLabel = computed(() => {
  const name = session.value?.programDay?.trim()
  if (!name) return 'Session'
  return /^day\b/i.test(name) ? name : `Day ${name}`
})

const isDone = computed(() => session.value?.status === 'done' || finished.value !== null)

const summarySession = computed(() => finished.value ?? (session.value?.status === 'done' ? session.value : null))

const totalSets = computed(() => logged.value.reduce((count, sets) => count + sets.length, 0))
const doneSets = computed(() => logged.value.reduce((count, sets) => count + loggedCount(sets), 0))

const blockedReason = computed(() => (plan.value ? finishBlockedReason(plan.value, logged.value) : 'Loading…'))

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined
let dirty = false

function currentDocument(): Session | null {
  const current = session.value
  if (!current) return null

  return applyLoggedSets(current, logged.value)
}

/** Writes whatever is dirty right now. Safe to call when nothing is. */
async function flush(): Promise<void> {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }

  const payload = currentDocument()
  if (!dirty || !payload || payload.status === 'done') return

  dirty = false

  try {
    // `false`: the document already exists, so the existence probe is a round
    // trip per logged set for an answer we know.
    await saveSession(payload, false)
    error.value = null
  } catch {
    // Keep the work on screen and keep it dirty — the next flush retries it.
    dirty = true
    error.value = SAVE_FAILED
  }
}

function scheduleSave(): void {
  dirty = true
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flush(), AUTOSAVE_MS)
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') void flush()
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function hydrate(doc: Session): void {
  session.value = doc
  logged.value = loggedSetsFromSession(doc)
  collapsed.value = logged.value.map(() => false)

  // The sheet is offered once per screen, and never on a session that already
  // carries answers or is already history.
  if (doc.status === 'active' && !doc.readiness && !readinessHandled.value) readinessOpen.value = true
  if (doc.status === 'done') records.value = detectNewRecords(sessionsStore.weekSessions, doc)
}

async function resolve(): Promise<void> {
  resolving.value = true
  notFound.value = false

  // The live window covers the dates a session started minutes ago falls in; the
  // fetch is for a cold load of a URL.
  const local = sessionsStore.weekSessions.find((item) => item.id === props.id)
  const doc = local ?? (await loadSession(props.id))

  if (!doc) {
    // Not "missing" — possibly "not readable yet". Today routes here the moment
    // it has an id, without waiting for the server to acknowledge the write, so
    // a first miss is the normal case rather than an error. Declaring it gone
    // would throw away a session the athlete is standing in the gym to start.
    if (!sessionsStore.isLoaded) return

    resolving.value = false
    notFound.value = true
    return
  }

  resolving.value = false

  if (doc.kind !== 'strength') {
    await router.replace({ name: 'cardio-session', params: { id: doc.id } })
    return
  }

  hydrate(doc)
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function setExerciseSets(index: number, sets: LoggedSet[]): void {
  logged.value = logged.value.map((current, i) => (i === index ? sets : current))
  scheduleSave()
}

function setWeight(index: number, weight: WeightValue): void {
  logged.value = logged.value.map((sets, i) => (i === index ? applyWorkingWeight(sets, weight) : sets))
  scheduleSave()
}

/**
 * A new `startedAt` is the only way to restart the clock, so it is written on
 * every first log even when the duration is unchanged.
 */
function onFirstLog(exerciseIndex: number, payload: { setIndex: number; restSec: number }): void {
  const exercise = plan.value?.exercises[exerciseIndex]

  // Synchronously inside the tap, because this is the last gesture before the
  // clock runs out and mobile audio will not start without one.
  primeRestAlert()

  clearRestLinger()
  restSeconds.value = payload.restSec
  restLabel.value = exercise ? `${exercise.tier ? `T${exercise.tier} ` : ''}${exercise.name} rest` : 'Rest'
  restStartedAt.value = Date.now()
}

function dismissRest(): void {
  clearRestLinger()
  restStartedAt.value = null
}

/**
 * The finished timer is a full-width accent block. Leaving it up until the next
 * set is logged costs an extra tap on the screen where taps are most expensive,
 * so it lingers just long enough to be seen and heard, then clears itself.
 */
const REST_LINGER_MS = 5000
let restLingerTimer: ReturnType<typeof setTimeout> | undefined

function clearRestLinger(): void {
  if (restLingerTimer === undefined) return
  clearTimeout(restLingerTimer)
  restLingerTimer = undefined
}

function onRestDone(): void {
  playRestAlert()
  clearRestLinger()
  restLingerTimer = setTimeout(() => {
    restLingerTimer = undefined
    restStartedAt.value = null
  }, REST_LINGER_MS)
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

async function submitReadiness(input: ReadinessInput): Promise<void> {
  readinessHandled.value = true
  readinessOpen.value = false

  const current = session.value
  if (!current) return

  // Answers are stored, never applied: the prescription, the sets and the
  // program state are all untouched by a readiness score.
  session.value = { ...current, readiness: input }
  scheduleSave()
  await flush()
}

function skipReadiness(): void {
  readinessHandled.value = true
  readinessOpen.value = false
}

// ---------------------------------------------------------------------------
// Finish and abandon
// ---------------------------------------------------------------------------

async function finish(): Promise<void> {
  const current = session.value
  const currentPlan = plan.value
  if (!current || !currentPlan || busy.value || blockedReason.value !== null) return

  // Before the await, not after it: the confirm dialog is an async gap, and a
  // second activation inside it would queue a second `finishSession` batch —
  // which would evaluate the progression twice and overwrite the undo snapshot
  // with an already-advanced state.
  busy.value = true
  error.value = null

  try {
    const untouched = totalSets.value - doneSets.value

    if (untouched > 0) {
      const confirmed = await dialog.confirm({
        title: 'Finish with sets not logged?',
        content: `${doneSets.value} of ${totalSets.value} sets are logged. The other ${untouched} will be recorded as missed, which can reset a stage.`,
        confirmLabel: 'Finish session',
      })

      if (!confirmed) return
    }

    await settleOrQueued(flush())

    const commit = sessionsStore.finishSession(applyLoggedSets(current, logged.value))
    // A late rejection must not be lost: the summary is already on screen by
    // then, so it lands in the error panel above the Done button.
    commit.catch(() => {
      error.value = 'The finished session could not be synced. Reopen it and finish again.'
    })

    const result = await settleOrQueued(commit)

    if (result === QUEUED) {
      // Offline the batch is durable in the persistent cache but the commit
      // does not resolve until reconnect. Show the session as finished rather
      // than spinning forever; the progression lines arrive with the sync.
      pendingSync.value = true
      finished.value = { ...applyLoggedSets(current, logged.value), status: 'done' }
      session.value = finished.value
    } else {
      pendingSync.value = false
      session.value = result
      finished.value = result
      // Safe before the listener echoes it back: `detectNewRecords` matches the
      // session out of the history by id.
      records.value = detectNewRecords(sessionsStore.weekSessions, result)
    }

    restStartedAt.value = null
  } catch {
    error.value = 'We couldn’t finish the session. Check your connection and try again.'
  } finally {
    busy.value = false
  }
}

async function abandon(): Promise<void> {
  if (busy.value) return

  // Before the await, as in `finish`: the confirm dialog is an async gap, and a
  // second activation inside it would stack a second dialog and a second delete.
  busy.value = true

  const confirmed = await dialog.confirm({
    title: 'Delete this session?',
    content: 'Everything logged so far is deleted. Your program is left exactly as it is.',
    confirmLabel: 'Delete session',
  })

  if (!confirmed) {
    busy.value = false
    return
  }

  try {
    // `deleteSession`, not `deleteLastSession`: nothing was evaluated, so there
    // is no program state to restore, and the newest session may not be this one.
    dirty = false
    await deleteSession(props.id)
    await router.replace({ name: 'today' })
  } catch {
    error.value = 'We couldn’t delete the session. Check your connection and try again.'
  } finally {
    busy.value = false
  }
}

function leave(): void {
  void router.push({ name: 'today' })
}

function formatValue(record: NewRecord): string {
  if (typeof record.value === 'number') return `${record.value} reps`

  return `${Math.round(record.value.value * 100) / 100} ${record.value.unit}`
}

function formatPrevious(record: NewRecord): string {
  if (record.previous === null) return 'first ever'
  if (typeof record.previous === 'number') return `was ${record.previous} reps`

  return `was ${Math.round(record.previous.value * 100) / 100} ${record.previous.unit}`
}

// A cold load onto this URL renders before the profile snapshot lands; the
// guard waits for auth, not for the document this screen reads.
watch(() => props.id, resolve, { immediate: true })

// The live snapshot is the other way the document can arrive. Re-resolving on it
// is what turns the race above into a wait: the session appears the moment
// Firestore answers, and only a genuinely absent id survives to `notFound`.
watch(
  () => [sessionsStore.weekSessions, sessionsStore.isLoaded] as const,
  () => {
    if (session.value === null) void resolve()
  },
)

onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange))

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  clearRestLinger()
  void flush()
})

// Fire and forget: `setDoc` does not resolve until the server acknowledges it,
// so awaiting here would trap the athlete on this screen with no signal. The
// write is already durable in the persistent cache and survives the unmount.
onBeforeRouteLeave(() => {
  void flush()
})
</script>

<template>
  <section class="mx-auto flex min-h-full max-w-lg flex-col">
    <!-- A cold load onto this URL waits for the profile: the router guard
         resolves auth, not the documents this screen reads. -->
    <p
      v-if="resolving || !profile || (!session && !notFound)"
      class="flex flex-1 items-center justify-center p-4 text-ink-500"
      role="status"
    >
      Loading…
    </p>

    <div v-else-if="notFound" class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <Icon name="alert" size="large" class="text-accent-600" />
      <p class="text-ink-900">Session not found.</p>
      <Button label="Back to Today" variant="outlined" class="min-h-[48px]" @click="leave()" />
    </div>

    <template v-else-if="session">
      <header class="flex items-center gap-3 px-4 pt-4">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-ink-500">{{ session.date }}</p>
          <h1 class="text-2xl font-bold text-ink-900">
            <!-- The day name is the athlete's own, and plenty of programs already
                 call theirs "Day 1" — prefixing unconditionally reads "Day Day 1". -->
            {{ isDone ? 'Session done' : dayLabel }}
          </h1>
        </div>

        <IconButton
          icon="close"
          variant="text"
          size="large"
          class="min-h-[48px] min-w-[48px]"
          aria-label="Back to Today"
          @click="leave()"
        />
      </header>

      <!-- A broken program prescribes nothing sane, so nothing is offered to
           log against it. -->
      <div v-if="plan && plan.diagnostics.length" class="flex-1 p-4">
        <p class="mb-3 text-ink-900">This session can’t be built from your program:</p>
        <DiagnosticsList :diagnostics="plan.diagnostics" />
        <Button
          label="Open the program editor"
          variant="outlined"
          class="mt-4 min-h-[48px]"
          @click="router.push({ name: 'program' })"
        />
      </div>

      <!-- The completion summary: the moment the athlete finds out what the
           session changed. Every line is the engine's own text. -->
      <div v-else-if="isDone && summarySession" class="flex-1 px-4 py-6">
        <div class="flex items-center gap-2 text-accent-700">
          <Icon name="check" size="large" />
          <p class="text-lg font-semibold">{{ doneSets }} of {{ totalSets }} sets logged</p>
        </div>

        <section v-if="summarySession.progressionSummary?.length" class="mt-6">
          <h2 class="text-sm font-semibold tracking-wide text-ink-500 uppercase">What changed</h2>
          <ul role="list" class="mt-2 flex flex-col gap-2">
            <li
              v-for="(line, index) in summarySession.progressionSummary"
              :key="index"
              class="rounded-xl border border-ink-200 bg-white p-3 text-ink-900"
            >
              {{ line }}
            </li>
          </ul>
        </section>

        <section v-if="records.length" class="mt-6">
          <h2 class="text-sm font-semibold tracking-wide text-ink-500 uppercase">New records</h2>
          <ul role="list" class="mt-2 flex flex-col gap-2">
            <li
              v-for="(record, index) in records"
              :key="`${record.exerciseKey}-${record.kind}-${index}`"
              class="flex items-baseline justify-between gap-3 rounded-xl border border-accent-600 bg-accent-50 p-3"
            >
              <span class="min-w-0">
                <span class="block font-semibold text-ink-900">{{ record.name }}</span>
                <span class="block text-sm text-ink-600">{{ RECORD_LABELS[record.kind] }}</span>
              </span>
              <span class="shrink-0 text-right tabular-nums">
                <span class="block text-xl font-bold text-accent-700">{{ formatValue(record) }}</span>
                <span class="block text-xs text-ink-500">{{ formatPrevious(record) }}</span>
              </span>
            </li>
          </ul>
        </section>

        <p v-if="pendingSync" role="status" class="mt-6 rounded-lg border border-ink-200 bg-ink-50 p-3 text-ink-700">
          Saved on this device — it will sync when you’re back online. What it changed shows up then.
        </p>

        <p v-else-if="!summarySession.progressionSummary?.length && !records.length" class="mt-6 text-ink-500">
          Nothing moved this time. The session is recorded.
        </p>
      </div>

      <!-- The live session. -->
      <div v-else-if="plan" class="flex-1 px-4 py-4">
        <div class="flex flex-col gap-4">
          <TierBlock
            v-for="(exercise, index) in plan.exercises"
            :key="exercise.key"
            :exercise="exercise"
            :model-value="logged[index] ?? []"
            :settings="profile.settings"
            :collapsed="collapsed[index] ?? false"
            :busy="busy"
            @update:model-value="setExerciseSets(index, $event)"
            @update:collapsed="collapsed[index] = $event"
            @update:weight="setWeight(index, $event)"
            @first-log="onFirstLog(index, $event)"
          />
        </div>

        <Button
          label="Delete this session"
          variant="text"
          color="secondary"
          class="mt-6 min-h-[48px]"
          :disabled="busy"
          :aria-disabled="busy"
          @click="!busy && abandon()"
        />
      </div>

      <!-- Sticky, not fixed: the primary action has to sit under the thumb
           without covering the last set row, and a fixed bar would be hidden by
           the software keyboard instead of pushed by it. -->
      <footer
        class="sticky bottom-0 border-t border-ink-200 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      >
        <!-- The timer lives in the sticky bar, not in the scrolling list: by the
             second exercise the top of the page is far off screen, and a card
             mounting up there would be invisible AND would push every set row
             down under the athlete's thumb. -->
        <RestTimer
          v-if="restStartedAt !== null && !isDone"
          :seconds="restSeconds"
          :started-at="restStartedAt"
          :label="restLabel"
          class="mb-3"
          @done="onRestDone()"
          @dismiss="dismissRest()"
        />

        <p v-if="error" role="alert" class="mb-3 rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-900">
          {{ error }}
        </p>

        <template v-if="isDone">
          <Button label="Done" size="large" block class="min-h-[56px]" @click="router.replace({ name: 'today' })" />
        </template>

        <template v-else-if="plan && plan.diagnostics.length === 0">
          <p
            v-if="blockedReason"
            role="status"
            class="mb-3 rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-700"
          >
            {{ blockedReason }}
          </p>

          <p v-else class="mb-3 text-sm text-ink-500 tabular-nums">
            {{ doneSets }} of {{ totalSets }} sets logged<span v-if="totalSets - doneSets > 0">
              — the rest is recorded as missed</span
            >
          </p>

          <Button
            label="Finish session"
            size="large"
            block
            class="min-h-[56px]"
            :disabled="blockedReason !== null"
            :aria-disabled="blockedReason !== null || busy"
            :loading="busy"
            @click="!blockedReason && !busy && finish()"
          />
        </template>
      </footer>

      <!-- The session is already under way here, so the default "Start session"
           would be a lie about what the button does. -->
      <ReadinessSheet
        v-model:open="readinessOpen"
        kind="strength"
        submit-label="Save"
        :busy="busy"
        @submit="submitReadiness"
        @skip="skipReadiness()"
      />
    </template>
  </section>
</template>
