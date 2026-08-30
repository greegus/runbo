/**
 * Sessions: the live "this week" window, paged history, and the two writes that
 * move program state — finishing a session and undoing the last one.
 *
 * Every rule here comes from a pure module (`evaluateSession`, `nextCursor`);
 * the store only decides the ORDER, and the order is the whole point:
 *
 * 1. `stateSnapshot` is cloned off `programState` BEFORE anything is evaluated —
 *    it is what "delete the last session" restores, so a state mutated first
 *    would restore the wrong weights.
 * 2. The session document and the profile patch go out in ONE batch. Written as
 *    two awaits, a failure between them leaves a finished session recorded
 *    against a `programState` it never saw.
 */

import { type CollectionReference, doc, type FirestoreError, serverTimestamp, writeBatch } from 'firebase/firestore'
import { defineStore } from 'pinia'
import { v4 as uuid } from 'uuid'
import { shallowRef } from 'vue'

import { profilesCollection, sessionsCollection } from '@/constants/firebaseCollections'
import { evaluateSession, exerciseKey } from '@/liftoscript/evaluator'
import { parseProgram } from '@/liftoscript/parser'
import type { Program } from '@/liftoscript/types'
import { db } from '@/services/firebaseService'
import {
  deleteSession,
  listSessionHistory,
  loadLatestSession,
  saveSession,
  type SessionCursor,
  subscribeToSessionsInRange,
} from '@/services/sessionsService'
import { useProfileStore } from '@/stores/profile'
import { evalContextFromSettings } from '@/training/plates'
import { cursorOfDay, nextCursor, rotationDays } from '@/training/rotation'
import type { ExerciseState, Profile, Session } from '@/types'
import { addDays, startOfWeekMonday, toIso, WEEK_LENGTH } from '@/utils/date'
const HISTORY_PAGE_SIZE = 25

/** The live window: last week, this week and the next, so the composer and the completion ratio both have their input. */
const LIVE_WEEKS_BEFORE = 1
const LIVE_WEEKS_AFTER = 1

/**
 * The document without its converter. Batch payloads are *partial* documents
 * carrying `FieldValue` sentinels, which `toFirestore` is typed to reject —
 * the same escape hatch `firebaseService` uses for its own writes.
 */
function rawDoc<T>(collection: CollectionReference<T>, id: string) {
  return doc(collection.withConverter(null), id)
}

export type SessionDraft = Omit<Session, 'id' | 'uid' | 'status' | 'createdAt' | 'updatedAt'> & { id?: string }

/** Mirrors the evaluator's own defensive copy — plain data, no reactive proxies reach Firestore. */
function cloneExerciseState(state: ExerciseState): ExerciseState {
  return {
    weights: state.weights.map((item) => ({ ...item })),
    setVariationIndex: state.setVariationIndex,
    state: Object.fromEntries(
      Object.entries(state.state).map(([name, value]) => [name, typeof value === 'number' ? value : { ...value }]),
    ),
    ...(state.askWeight === undefined ? {} : { askWeight: state.askWeight }),
  }
}

function cloneProgramState(programState: Record<string, ExerciseState>): Record<string, ExerciseState> {
  return Object.fromEntries(Object.entries(programState).map(([key, state]) => [key, cloneExerciseState(state)]))
}

/**
 * DECISION: the cursor is derived from the session's own program day rather
 * than stepped blindly, so finishing and deleting are exact inverses even after
 * a claim or a swap moved the week off the stored cursor. `nextCursor` only
 * moves forward, which is why the undo path resolves the day instead of it.
 */
function rotationOf(profile: Profile): string[] {
  const { program, diagnostics } = parseProgram(profile.strengthTrack.programText)
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? [] : rotationDays(program)
}

/** The `week` / `day` slot the evaluator needs to resolve the exercise line actually trained. */
function slotOf(program: Program, programDay: string | undefined): { week: number; day: number } {
  for (const [weekIndex, week] of program.weeks.entries()) {
    const dayIndex = week.days.findIndex((day) => day.name === programDay)
    if (dayIndex >= 0) return { week: weekIndex + 1, day: dayIndex + 1 }
  }

  return { week: 1, day: 1 }
}

interface StrengthOutcome {
  programState: Record<string, ExerciseState>
  summary: string[]
}

/**
 * Runs each logged exercise's progression against the state as it stood before
 * the session and collects the human lines.
 *
 * A program that no longer parses leaves the state alone: the session is still
 * worth keeping, and silently guessing at a progression would be worse than
 * saying nothing happened.
 */
function evaluateStrengthSession(
  profile: Profile,
  session: Session,
  before: Record<string, ExerciseState>,
): StrengthOutcome {
  const { program, diagnostics } = parseProgram(profile.strengthTrack.programText)

  if (diagnostics.length > 0) {
    return { programState: before, summary: ['Program text does not parse — weights left unchanged.'] }
  }

  const ctx = evalContextFromSettings(profile.settings, slotOf(program, session.programDay))
  const programState = cloneProgramState(before)
  const summary: string[] = []

  for (const entry of session.exercises ?? []) {
    // The same key `initialProgramState` writes: GZCLP runs Squat as T1 and T2
    // on different days, and those are two independent progressions.
    const key = exerciseKey({ name: entry.name, ...(entry.tier ? { label: `T${entry.tier}` } : {}) })
    const state = programState[key]
    if (!state) continue

    const result = evaluateSession(program, key, state, entry.sets, ctx)
    programState[key] = result.nextState
    summary.push(result.summary)
  }

  return { programState, summary }
}

export const useSessionsStore = defineStore('sessions', () => {
  // shallowRef: both lists are replaced wholesale by a snapshot or a page.
  const weekSessions = shallowRef<Session[]>([])
  const history = shallowRef<Session[]>([])
  const hasMoreHistory = shallowRef(false)
  const isLoadingHistory = shallowRef(false)
  const error = shallowRef<FirestoreError | null>(null)

  let unsubscribe: (() => void) | null = null
  let boundUid: string | null = null
  let historyCursor: SessionCursor | null = null

  function reset(): void {
    unsubscribe?.()
    unsubscribe = null
    boundUid = null
    historyCursor = null
    weekSessions.value = []
    history.value = []
    hasMoreHistory.value = false
    error.value = null
  }

  /**
   * Subscribes to the weeks the planner reads. `todayIso` is a parameter with a
   * clock-reading default — a store may read the clock, but a caller that
   * already knows "today" must be able to pass it rather than race midnight.
   */
  function bind(uid: string, todayIso: string = toIso(new Date())): void {
    reset()
    boundUid = uid

    const weekStart = startOfWeekMonday(todayIso)

    unsubscribe = subscribeToSessionsInRange(
      uid,
      addDays(weekStart, -WEEK_LENGTH * LIVE_WEEKS_BEFORE),
      addDays(weekStart, WEEK_LENGTH * (LIVE_WEEKS_AFTER + 1) - 1),
      (sessions) => {
        if (boundUid === uid) weekSessions.value = sessions
      },
      (listenerError) => {
        // Keep what is already on screen; an offline listener recovers by itself.
        console.error('[sessions] listener failed', listenerError.code, listenerError.message)
        error.value = listenerError
      },
    )
  }

  function requireProfile(): Profile {
    const profile = useProfileStore().profile
    if (!profile) throw new Error('No profile loaded')

    return profile
  }

  /** Next page of history, appended. Call `resetHistory` to start over. */
  async function loadMoreHistory(pageSize: number = HISTORY_PAGE_SIZE): Promise<void> {
    const profile = requireProfile()

    isLoadingHistory.value = true
    try {
      const page = await listSessionHistory(profile.id, pageSize, historyCursor)
      historyCursor = page.cursor
      history.value = [...history.value, ...page.sessions]
      hasMoreHistory.value = page.hasMore
    } finally {
      isLoadingHistory.value = false
    }
  }

  function resetHistory(): void {
    historyCursor = null
    history.value = []
    hasMoreHistory.value = false
  }

  /** Creates the document up front so a half-logged session survives a reload. */
  async function startSession(draft: SessionDraft): Promise<Session> {
    const profile = requireProfile()

    const session: Session = { ...draft, id: draft.id ?? uuid(), uid: profile.id, status: 'active' }
    await saveSession(session)

    return session
  }

  /**
   * Marks the session done and, for a strength session, advances the program in
   * the same batch. Returns the document as it was written.
   */
  async function finishSession(session: Session): Promise<Session> {
    const profile = requireProfile()

    // FIRST, before anything is evaluated — this is the undo point.
    const stateSnapshot = cloneProgramState(profile.strengthTrack.programState)

    const finished: Session = { ...session, status: 'done' }
    let profilePatch: Partial<Profile> | null = null

    if (session.kind === 'strength') {
      const { programState, summary } = evaluateStrengthSession(profile, session, stateSnapshot)
      const days = rotationOf(profile)

      finished.stateSnapshot = stateSnapshot
      finished.progressionSummary = summary

      profilePatch = {
        strengthTrack: {
          ...profile.strengthTrack,
          programState,
          // Once per finished strength session, never on a cardio one.
          rotationCursor: nextCursor(
            days,
            cursorOfDay(days, session.programDay) ?? profile.strengthTrack.rotationCursor,
          ),
        },
      }
    }

    const batch = writeBatch(db)
    const { id, ...payload } = finished

    batch.set(rawDoc(sessionsCollection, id), { ...payload, updatedAt: serverTimestamp() }, { merge: true })
    if (profilePatch) {
      batch.update(rawDoc(profilesCollection, profile.id), { ...profilePatch, updatedAt: serverTimestamp() })
    }

    await batch.commit()

    return finished
  }

  /**
   * Undoes the most recent session: the document goes, and the program state it
   * was recorded against comes back — again in one batch, so the two can never
   * disagree. Returns the deleted session, or `null` when there was none.
   */
  async function deleteLastSession(): Promise<Session | null> {
    const profile = requireProfile()

    const latest = await loadLatestSession(profile.id)
    if (!latest) return null

    if (!latest.stateSnapshot) {
      // A cardio session moves no program state; nothing to restore.
      await deleteSession(latest.id)
      return latest
    }

    const batch = writeBatch(db)

    batch.delete(rawDoc(sessionsCollection, latest.id))
    batch.update(rawDoc(profilesCollection, profile.id), {
      strengthTrack: {
        ...profile.strengthTrack,
        programState: latest.stateSnapshot,
        // Back to the day this session was: `nextCursor` only moves forward.
        rotationCursor: cursorOfDay(rotationOf(profile), latest.programDay) ?? profile.strengthTrack.rotationCursor,
      },
      updatedAt: serverTimestamp(),
    })

    await batch.commit()

    return latest
  }

  return {
    weekSessions,
    history,
    hasMoreHistory,
    isLoadingHistory,
    error,
    bind,
    reset,
    loadMoreHistory,
    resetHistory,
    startSession,
    finishSession,
    deleteLastSession,
  }
})
