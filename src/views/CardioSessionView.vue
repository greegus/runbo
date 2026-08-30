<script setup lang="ts">
import { deleteField } from 'firebase/firestore'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { Button, useDialogStack } from 'vuiii'

import CardioLogForm from '@/components/cardio/CardioLogForm.vue'
import PrescriptionCard from '@/components/cardio/PrescriptionCard.vue'
import ReadinessSheet from '@/components/ReadinessSheet.vue'
import { deleteSession, loadSession, saveSession } from '@/services/sessionsService'
import { cardioLogPatch, emptyCardioLogDraft, fromSession } from '@/session/cardioLog'
import type { CardioLogDraft } from '@/session/types'
import { useProfileStore } from '@/stores/profile'
import { useSessionsStore } from '@/stores/sessions'
import { growLongestSession } from '@/training/cardioPlan'
import type { ReadinessInput } from '@/training/readiness'
import type { Session } from '@/types'

/**
 * One cardio session, from the prescription to the logged minutes.
 *
 * The screen decides nothing: `cardioLog.ts` owns the draft, the blocking rule
 * and the Firestore patch, `describePrescription` owns the target line, and
 * `useSessionsStore.finishSession` owns the terminal write. What lives here is
 * the ORDER of the writes and the lifecycle around them.
 *
 * Manual entry is the whole flow. Strava is a later phase: a `source: 'strava'`
 * document renders as already logged, but nothing here can create one and the
 * screen never implies an import exists.
 */

const props = defineProps<{ id: string }>()

const router = useRouter()
const dialog = useDialogStack()
const profileStore = useProfileStore()
const sessionsStore = useSessionsStore()

/** Trailing debounce for the autosave: a keystroke per round trip is not worth it. */
const AUTOSAVE_MS = 800

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

/** The optional cardio stats: present only when the athlete recorded them. */
const OPTIONAL_KEYS = ['distanceKm', 'avgHr', 'rpe', 'notes'] as const

type Phase = 'loading' | 'ready' | 'missing'

const phase = ref<Phase>('loading')
// shallowRef: the document is replaced wholesale, never mutated in place.
const session = shallowRef<Session | null>(null)
const draft = ref<CardioLogDraft>(emptyCardioLogDraft())
const blockedReason = ref<string | null>(null)

const busy = ref(false)
const error = ref<string | null>(null)
/** The session is finished locally but the write has not been acknowledged yet. */
const pendingSync = ref(false)

/** Set once the athlete answered or dismissed the sheet, so it opens at most once. */
const readinessSettled = ref(false)
const readinessOpen = ref(false)

const profile = computed(() => profileStore.profile)
const prescription = computed(() => session.value?.prescription ?? null)
const isDone = computed(() => session.value?.status === 'done')
const isImported = computed(() => session.value?.source === 'strava')

/**
 * DECISION: an unplanned session — the athlete simply went for a run — has no
 * prescription, so there is no target to compare against. `CardioLogForm` takes
 * `targetMinutes: number` and already renders no comparison line for a
 * non-finite one, so `NaN` is how "no target" is expressed rather than a `0`
 * that would read as "vs the 0 min target".
 */
const targetMinutes = computed(() => prescription.value?.targetMinutes ?? Number.NaN)

// ---------------------------------------------------------------- resolution

/**
 * Seeds the local draft ONCE. Later snapshots of the same document (our own
 * autosave echoing back, a second tab) must never re-seed it, or a number being
 * typed is stomped mid-keystroke.
 */
function adopt(next: Session): void {
  session.value = next
  draft.value = next.minutes === undefined ? emptyCardioLogDraft(next.prescription) : fromSession(next)
  phase.value = 'ready'

  // Readiness is optional and offered once. A session started from Today may
  // already carry it; a resumed one that never answered still gets the offer.
  readinessSettled.value = next.readiness !== undefined || next.status === 'done'
  readinessOpen.value = !readinessSettled.value
}

async function resolveSession(): Promise<void> {
  // The live window covers [weekStart-7, weekStart+13], which is every session
  // that can be open; the direct read is for a cold load of a shared URL.
  const known = sessionsStore.weekSessions.find((item) => item.id === props.id)
  const found = known ?? (await loadSession(props.id))

  if (!found) {
    // Not "missing" — possibly "not readable yet". Today routes here as soon as
    // it has an id, without waiting for the server to acknowledge the write, so
    // a first miss is the normal case. The live snapshot below re-resolves.
    if (!sessionsStore.isLoaded) return

    phase.value = 'missing'
    return
  }

  // A strength document opened here is a wrong link, not an error: send it to
  // the screen that can render it.
  if (found.kind === 'strength') {
    await router.replace({ name: 'strength-session', params: { id: found.id } })
    return
  }

  adopt(found)
}

// -------------------------------------------------------------- persistence

let saveTimer: ReturnType<typeof setTimeout> | null = null
const dirty = ref(false)

/**
 * DECISION: `cardioLogPatch` OMITS absent values (Firestore rejects `undefined`)
 * and every write is a merge, so an optional number that was autosaved and then
 * cleared stays on the document until it is overwritten. Deleting it would mean
 * `deleteField()` sentinels inside the pure module, which would make it impure
 * for a case (typing an HR and then erasing it) that costs one stale number.
 */
function payload(current: Session): Session {
  return { ...current, ...cardioLogPatch(draft.value) }
}

/**
 * The terminal write is the permanent record, so an optional value that was
 * autosaved and then cleared has to be REMOVED, not left behind by the merge.
 * The `deleteField()` sentinels live here rather than in `cardioLogPatch`, which
 * stays a pure function over plain data.
 *
 * `local` is the same document without the sentinels — what the screen keeps
 * showing, since a `FieldValue` would render as an object.
 */
function finishPayload(current: Session): { write: Session; local: Session } {
  const patch = cardioLogPatch(draft.value)
  const local: Session = { ...current, ...patch }
  const removals: Record<string, unknown> = {}

  for (const key of OPTIONAL_KEYS) {
    if (key in patch || current[key] === undefined) continue

    delete local[key]
    removals[key] = deleteField()
  }

  return { write: { ...local, ...removals } as Session, local }
}

async function flush(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  const current = session.value
  if (!dirty.value || !current || current.status !== 'active') return

  dirty.value = false
  try {
    // `isNew: false` skips the existence probe — the document was created by
    // `startSession` before this screen was ever reached.
    await saveSession(payload(current), false)
  } catch (saveError) {
    // Keep the change pending so the next flush retries it; the athlete's
    // numbers are still on screen, so nothing is lost.
    dirty.value = true
    console.error('[cardio-session] autosave failed', saveError)
  }
}

function scheduleSave(): void {
  if (session.value?.status !== 'active') return

  dirty.value = true
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flush(), AUTOSAVE_MS)
}

function onDraft(next: CardioLogDraft): void {
  draft.value = next
  scheduleSave()
}

/** A locked phone is the most common way a session ends without a navigation. */
function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') void flush()
}

// ------------------------------------------------------------------ actions

function acceptReadiness(input: ReadinessInput): void {
  readinessSettled.value = true

  const current = session.value
  if (!current || current.status !== 'active') return

  // Readiness only ever changes the advice string. It never touches the
  // prescription, the minutes or the profile.
  session.value = { ...current, readiness: input }
  dirty.value = true
  void flush()
}

function skipReadiness(): void {
  readinessSettled.value = true
}

/**
 * The per-session fact the planner needs back: without it the long-session cap
 * stays frozen at whatever onboarding was told and the week reports a shortfall
 * it can never place. Fire and forget — it must not hold up the summary.
 */
function growCap(minutes: number): void {
  const profileValue = profileStore.profile
  if (!profileValue) return

  const cardioTrack = profileValue.cardioTrack
  const grown = growLongestSession(cardioTrack.longestSessionMinutes, minutes)
  if (grown === cardioTrack.longestSessionMinutes) return

  void profileStore
    .save({ cardioTrack: { ...cardioTrack, longestSessionMinutes: grown } })
    .catch((saveError: unknown) => console.error('[cardio-session] could not grow the long-session cap', saveError))
}

async function finish(): Promise<void> {
  const current = session.value
  if (!current || busy.value || blockedReason.value !== null) return

  busy.value = true
  error.value = null
  try {
    await settleOrQueued(flush())

    const { write, local } = finishPayload(current)

    // One terminal write: `finishSession` batches the document itself. A cardio
    // session moves no program state, so there is nothing else to persist here.
    const commit = sessionsStore.finishSession(write)
    // A late rejection must not be lost: the summary is already on screen by then.
    commit.catch(() => {
      error.value = 'The finished session could not be synced. Reopen it and finish again.'
    })

    // Offline the batch is durable in the persistent cache but the commit does
    // not resolve until reconnect, so the screen stops waiting on the ack. The
    // returned document carries the `deleteField()` sentinels, so the local one
    // — the same data without them — is what stays on screen either way.
    const result = await settleOrQueued(commit)
    pendingSync.value = result === QUEUED
    session.value = { ...local, status: 'done' }

    growCap(local.minutes ?? 0)
  } catch (finishError) {
    error.value = finishError instanceof Error ? finishError.message : 'Could not save the session.'
  } finally {
    busy.value = false
  }
}

async function abandon(): Promise<void> {
  const current = session.value
  if (!current || busy.value) return

  // Before the await, not after it: the confirm dialog is an async gap, and a
  // second activation inside it would queue a second delete.
  busy.value = true
  error.value = null

  const confirmed = await dialog.confirm({
    title: 'Abandon this session?',
    content: 'The session and everything logged on it will be deleted. This cannot be undone.',
    confirmLabel: 'Abandon',
  })
  if (!confirmed) {
    busy.value = false
    return
  }

  // Cancel the pending autosave first: a debounced write landing after the
  // delete would recreate the document.
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  dirty.value = false

  try {
    await deleteSession(current.id)
    await router.replace({ name: 'today' })
  } catch (deleteError) {
    error.value = deleteError instanceof Error ? deleteError.message : 'Could not delete the session.'
    busy.value = false
  }
}

// ---------------------------------------------------------------- lifecycle

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  void resolveSession()
})

// A cold load of a session URL renders before the live window arrives, and Today
// routes here before the write is acknowledged. Either way the snapshot may be
// the first sighting of the document, so re-resolve until something is resolved
// — 'loading' counts, or a first miss would wait for a retry that never comes.
watch(
  () => [sessionsStore.weekSessions, sessionsStore.isLoaded] as const,
  () => {
    if (phase.value === 'loading' || phase.value === 'missing') void resolveSession()
  },
)

onBeforeRouteLeave(() => {
  void flush()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  void flush()
})
</script>

<template>
  <section class="mx-auto flex min-h-full max-w-lg flex-col">
    <div v-if="phase === 'loading' || !profile" class="flex-1 px-4 py-6">
      <p class="text-ink-500" role="status">Loading the session…</p>
    </div>

    <div v-else-if="phase === 'missing'" class="flex-1 px-4 py-6">
      <h1 class="text-2xl font-bold text-ink-900">Session not found</h1>
      <p class="mt-2 text-ink-500">This session no longer exists, or it belongs to another account.</p>
      <Button :to="{ name: 'today' }" label="Back to today" size="large" variant="outlined" class="mt-6 min-h-[48px]" />
    </div>

    <template v-else-if="session">
      <header class="px-4 pt-4">
        <h1 class="text-2xl font-bold text-ink-900">{{ isDone ? 'Session done' : 'Cardio session' }}</h1>
        <p class="text-sm text-ink-500 tabular-nums">{{ session.date }}</p>
      </header>

      <div class="flex flex-1 flex-col gap-6 px-4 py-6">
        <PrescriptionCard
          v-if="prescription"
          :prescription="prescription"
          :zones="profile.cardioTrack.zones"
          :completed="isDone || isImported"
          :session="session"
        />

        <!-- An unplanned session: the athlete simply went out. There is nothing
             to prescribe, only something to record. -->
        <p v-else class="rounded-lg border border-ink-200 bg-ink-50 p-4 text-ink-700">
          Unplanned session — no target for this one. Log what you did.
        </p>

        <!-- A Strava activity is already logged; there is nothing to type. -->
        <p v-if="isImported" class="text-sm text-ink-500">This activity came from Strava, so it is already logged.</p>

        <template v-else-if="isDone">
          <!-- With a prescription the completed card above already carries the
               numbers; without one (an unplanned session) this is the record. -->
          <p v-if="!prescription" class="text-3xl font-semibold tabular-nums text-ink-900">
            {{ session.minutes ?? 0 }} <span class="text-base font-normal text-ink-500">min</span>
          </p>
          <p v-if="!prescription && session.notes" class="text-sm whitespace-pre-line text-ink-700">
            {{ session.notes }}
          </p>
          <p class="text-ink-700">Logged. Nice work.</p>
          <p
            v-if="pendingSync"
            role="status"
            class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-700"
          >
            Saved on this device — it will sync when you’re back online.
          </p>
        </template>

        <CardioLogForm
          v-else
          :model-value="draft"
          :target-minutes="targetMinutes"
          :busy="busy"
          @update:model-value="onDraft"
          @update:blocked-reason="blockedReason = $event"
        />
      </div>

      <!-- Sticky, not fixed: a fixed bar is covered by the software keyboard
           instead of pushed by it, and the minutes field is the last thing the
           athlete types. -->
      <div
        class="sticky bottom-0 border-t border-ink-200 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      >
        <p v-if="error" class="mb-3 rounded-lg bg-accent-50 p-3 text-sm text-accent-700" role="alert">{{ error }}</p>

        <!-- `replace`, so the back button cannot walk into a finished session. -->
        <Button
          v-if="isDone || isImported"
          label="Done"
          size="large"
          block
          class="min-h-[56px]"
          @click="router.replace({ name: 'today' })"
        />

        <template v-else>
          <p v-if="blockedReason" class="mb-3 text-sm text-accent-700" role="status">{{ blockedReason }}</p>

          <Button
            label="Finish session"
            size="large"
            block
            class="min-h-[56px]"
            :disabled="blockedReason !== null"
            :aria-disabled="blockedReason !== null || busy"
            :loading="busy"
            @click="blockedReason === null && !busy && finish()"
          />

          <Button
            label="Abandon session"
            size="large"
            variant="text"
            color="secondary"
            block
            class="mt-2 min-h-[48px]"
            :aria-disabled="busy"
            @click="!busy && abandon()"
          />
        </template>
      </div>

      <!-- The session is already under way here, so the default "Start session"
           would be a lie about what the button does. -->
      <ReadinessSheet
        v-model:open="readinessOpen"
        kind="cardio"
        submit-label="Save"
        :busy="busy"
        @submit="acceptReadiness"
        @skip="skipReadiness"
      />
    </template>
  </section>
</template>
