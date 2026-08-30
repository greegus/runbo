/**
 * Pure aggregations over logged sessions: personal records, weekly volume,
 * streaks and the numbers PlanView / ProgressView show.
 *
 * Everything here is derived, never stored, and every function that needs a
 * "now" takes it as an ISO day so the whole module stays deterministic.
 */

import { exerciseKey } from '@/liftoscript/evaluator'
import {
  add,
  calculate1RM,
  compare,
  multiply,
  weight as makeWeight,
  type Unit,
  type Weight,
} from '@/liftoscript/weight'
import type { BodyweightEntry, ComposedWeek, Profile, Session, SetLog, WeightValue } from '@/types'
import { addDays, daysBetween, inWeek, startOfWeekMonday } from '@/utils/date'

/** The key a logged exercise's records are grouped under, e.g. `'T1:Squat'`. */
export function sessionExerciseKey(exercise: { name: string; tier?: 1 | 2 | 3 }): string {
  return exerciseKey({ name: exercise.name, ...(exercise.tier ? { label: `T${exercise.tier}` } : {}) })
}

export interface SetReference {
  exerciseKey: string
  name: string
  date: string
  sessionId: string
  set: SetLog
  /** Epley estimate for that set; `null` for an untouched or skipped set. */
  e1rm: WeightValue | null
}

export interface PersonalRecord {
  exerciseKey: string
  name: string
  bestWeight: { weight: WeightValue; reps: number; date: string } | null
  bestE1rm: { weight: WeightValue; reps: number; date: string } | null
  bestAmrapReps: { reps: number; weight: WeightValue; date: string } | null
}

export type RecordKind = 'weight' | 'e1rm' | 'amrapReps'

export interface NewRecord {
  exerciseKey: string
  name: string
  kind: RecordKind
  /** A `WeightValue` for `weight`/`e1rm`, a rep count for `amrapReps`. */
  value: WeightValue | number
  /** The best before this session — `null` when it is the first ever. */
  previous: WeightValue | number | null
  date: string
}

export interface BodyweightPoint {
  date: string
  weight: number
  /** Mean of every entry in the trailing 7 calendar days, this one included. */
  average: number
}

export interface WeeklyRollup {
  weekStart: string
  strength: { planned: number; done: number }
  cardio: { planned: number; done: number; plannedMinutes: number; doneMinutes: number }
  tonnage: WeightValue
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDone(session: Session): boolean {
  return session.status === 'done'
}

function byDateAscending(sessions: Session[]): Session[] {
  // Array#sort is stable, so same-day sessions keep the order they came in.
  return [...sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Every completed working set of every done strength session, oldest first. */
function completedSets(sessions: Session[]): SetReference[] {
  const references: SetReference[] = []

  for (const session of byDateAscending(sessions)) {
    if (!isDone(session) || session.kind !== 'strength') continue

    for (const exercise of session.exercises ?? []) {
      const key = sessionExerciseKey(exercise)

      for (const set of exercise.sets) {
        if (set.completedReps === null || set.completedReps <= 0) continue
        references.push({
          exerciseKey: key,
          name: exercise.name,
          date: session.date,
          sessionId: session.id,
          set,
          e1rm: estimatedOneRepMax(set),
        })
      }
    }
  }

  return references
}

function isHeavier(candidate: WeightValue, best: WeightValue | null): boolean {
  return best === null || compare(candidate, best) > 0
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** Epley estimate via the engine. `null` for an untouched or skipped set. */
export function estimatedOneRepMax(setLog: SetLog): WeightValue | null {
  if (setLog.completedReps === null || setLog.completedReps <= 0) return null

  return calculate1RM(setLog.weight, setLog.completedReps)
}

/**
 * The single best set ever logged for an exercise, ranked by estimated 1RM —
 * a heavy triple beats a light set of ten, which raw weight alone would miss.
 * Ties go to the heavier bar, then to the earlier date (the record stands).
 */
export function bestSetFor(sessions: Session[], key: string): SetReference | null {
  let best: SetReference | null = null

  for (const reference of completedSets(sessions)) {
    if (reference.exerciseKey !== key || reference.e1rm === null) continue
    if (best === null || best.e1rm === null) {
      best = reference
      continue
    }

    const byE1rm = compare(reference.e1rm, best.e1rm)
    if (byE1rm > 0 || (byE1rm === 0 && compare(reference.set.weight, best.set.weight) > 0)) best = reference
  }

  return best
}

/** Per exercise key: heaviest set, best estimated 1RM and best AMRAP set. */
export function personalRecords(sessions: Session[]): Record<string, PersonalRecord> {
  const records: Record<string, PersonalRecord> = {}

  for (const reference of completedSets(sessions)) {
    const reps = reference.set.completedReps as number
    const record = (records[reference.exerciseKey] ??= {
      exerciseKey: reference.exerciseKey,
      name: reference.name,
      bestWeight: null,
      bestE1rm: null,
      bestAmrapReps: null,
    })

    if (isHeavier(reference.set.weight, record.bestWeight?.weight ?? null)) {
      record.bestWeight = { weight: reference.set.weight, reps, date: reference.date }
    }

    if (reference.e1rm !== null && isHeavier(reference.e1rm, record.bestE1rm?.weight ?? null)) {
      record.bestE1rm = { weight: reference.e1rm, reps, date: reference.date }
    }

    if (reference.set.isAmrap && reps > (record.bestAmrapReps?.reps ?? 0)) {
      record.bestAmrapReps = { reps, weight: reference.set.weight, date: reference.date }
    }
  }

  return records
}

/**
 * The records a just-finished session set, for the completion screen.
 *
 * `sessions` is the history; the session itself may or may not be in it (it is
 * matched out by id). Only sessions on or before the session's date count as
 * "previous", so importing older history later cannot retro-award a PR.
 */
export function detectNewRecords(sessions: Session[], session: Session): NewRecord[] {
  const previous = personalRecords(
    sessions.filter((candidate) => candidate.id !== session.id && candidate.date <= session.date),
  )
  const current = personalRecords([{ ...session, status: 'done' }])
  const found: NewRecord[] = []

  for (const record of Object.values(current)) {
    const before = previous[record.exerciseKey]
    const base = { exerciseKey: record.exerciseKey, name: record.name, date: session.date }

    if (record.bestWeight && isHeavier(record.bestWeight.weight, before?.bestWeight?.weight ?? null)) {
      found.push({
        ...base,
        kind: 'weight',
        value: record.bestWeight.weight,
        previous: before?.bestWeight?.weight ?? null,
      })
    }

    if (record.bestE1rm && isHeavier(record.bestE1rm.weight, before?.bestE1rm?.weight ?? null)) {
      found.push({ ...base, kind: 'e1rm', value: record.bestE1rm.weight, previous: before?.bestE1rm?.weight ?? null })
    }

    if (record.bestAmrapReps && record.bestAmrapReps.reps > (before?.bestAmrapReps?.reps ?? 0)) {
      found.push({
        ...base,
        kind: 'amrapReps',
        value: record.bestAmrapReps.reps,
        previous: before?.bestAmrapReps?.reps ?? null,
      })
    }
  }

  return found
}

// ---------------------------------------------------------------------------
// Weekly volume
// ---------------------------------------------------------------------------

/**
 * Total weight moved in the week starting `weekStart` (Monday):
 * `Σ weight × completedReps`. Reported in `unit` because a tonnage summed from
 * mixed-unit logs must land in one predictable unit.
 */
export function weeklyTonnage(sessions: Session[], weekStart: string, unit: Unit = 'kg'): WeightValue {
  let total: Weight = makeWeight(0, unit)

  for (const session of sessions) {
    if (!isDone(session) || session.kind !== 'strength' || !inWeek(session.date, weekStart)) continue

    for (const exercise of session.exercises ?? []) {
      for (const set of exercise.sets) {
        if (set.completedReps === null || set.completedReps <= 0) continue
        total = add(total, multiply(set.weight, set.completedReps))
      }
    }
  }

  return total
}

/** Minutes of completed cardio in the week — unplanned sessions count too. */
export function weeklyCardioMinutes(sessions: Session[], weekStart: string): number {
  return sessions
    .filter((session) => isDone(session) && session.kind === 'cardio' && inWeek(session.date, weekStart))
    .reduce((sum, session) => sum + (session.minutes ?? 0), 0)
}

/**
 * Completed / prescribed cardio minutes — the adaptive input `planCardioWeek`
 * uses. A week with no target counts as fully done, so an empty plan can never
 * trigger the "held volume" branch.
 */
export function cardioCompletionRatio(sessions: Session[], weekStart: string, targetMinutes: number): number {
  if (targetMinutes <= 0) return 1

  return weeklyCardioMinutes(sessions, weekStart) / targetMinutes
}

// ---------------------------------------------------------------------------
// Streak & bodyweight
// ---------------------------------------------------------------------------

/**
 * Consecutive Monday-weeks with at least one completed session, counted back
 * from today.
 *
 * The current week gets a grace period: while it is still empty the streak is
 * measured from last week, so it does not read as broken every Monday morning.
 * It breaks only once a whole week passes with nothing logged.
 */
export function currentStreak(sessions: Session[], todayIso: string): number {
  const active = new Set(
    sessions
      .filter((session) => isDone(session) && session.date <= todayIso)
      .map((session) => startOfWeekMonday(session.date)),
  )

  const thisWeek = startOfWeekMonday(todayIso)
  let cursor = active.has(thisWeek) ? thisWeek : addDays(thisWeek, -7)
  let streak = 0

  while (active.has(cursor)) {
    streak += 1
    cursor = addDays(cursor, -7)
  }

  return streak
}

/** Raw bodyweight points plus a trailing 7-day rolling average, oldest first. */
export function bodyweightTrend(entries: BodyweightEntry[]): BodyweightPoint[] {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return sorted.map((entry, index) => {
    const window = sorted.slice(0, index + 1).filter((candidate) => daysBetween(candidate.date, entry.date) < 7)
    const mean = window.reduce((sum, candidate) => sum + candidate.weight, 0) / window.length

    return { date: entry.date, weight: entry.weight, average: Math.round(mean * 100) / 100 }
  })
}

// ---------------------------------------------------------------------------
// Week rollup
// ---------------------------------------------------------------------------

/**
 * Planned vs done per track for PlanView.
 *
 * Pass the composed week whenever there is one — it is the authority on what
 * was planned. Without it the planned counts are estimated from availability
 * with the composer's split rule (strength up to 3 days, cardio the rest).
 */
export function weeklyRollup(
  profile: Profile,
  sessions: Session[],
  weekStart: string,
  composedWeek?: ComposedWeek,
): WeeklyRollup {
  const thisWeek = sessions.filter((session) => inWeek(session.date, weekStart))
  const done = (kind: Session['kind']) => thisWeek.filter((session) => isDone(session) && session.kind === kind).length

  let plannedStrength: number
  let plannedCardio: number
  let plannedMinutes: number

  if (composedWeek) {
    const planned = composedWeek.days.map((day) => day.planned).filter((item) => item !== null)
    plannedStrength = planned.filter((item) => item.kind === 'strength').length
    plannedCardio = planned.filter((item) => item.kind === 'cardio').length
    plannedMinutes = planned.reduce(
      (sum, item) => sum + (item.kind === 'cardio' ? item.prescription.targetMinutes : 0),
      0,
    )
  } else {
    const budget = profile.availability.daysPerWeek
    plannedStrength = Math.min(3, budget)
    plannedCardio = budget - plannedStrength
    // Cardio always gets at least one slot when a modality is enabled, even if
    // that means one strength day fewer than the ideal three.
    if (plannedCardio === 0 && profile.cardioTrack.modalities.length > 0 && plannedStrength > 1) {
      plannedStrength -= 1
      plannedCardio = 1
    }
    plannedMinutes = profile.cardioTrack.modalities.length > 0 ? profile.cardioTrack.weeklyMinutes : 0
  }

  return {
    weekStart,
    strength: { planned: plannedStrength, done: done('strength') },
    cardio: {
      planned: plannedCardio,
      done: done('cardio'),
      plannedMinutes,
      doneMinutes: weeklyCardioMinutes(sessions, weekStart),
    },
    tonnage: weeklyTonnage(sessions, weekStart, profile.settings.units),
  }
}
