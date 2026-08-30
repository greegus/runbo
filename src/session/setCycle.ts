/**
 * The tap-cycle state machine for one logged set.
 *
 * This lives outside the component on purpose: it is the single place that
 * decides what a tap means, and it carries the athlete's training history —
 * a machine buried in a template is untestable and every bug in it silently
 * rewrites logged work.
 *
 * Pure: no Vue, no Date, no Firestore. Every function returns a NEW object and
 * never mutates its argument.
 *
 * The transition table for a non-AMRAP set prescribed at N:
 *
 *   untouched / null      -> done / N        (starts the rest timer)
 *   done / r  (r > 0)     -> done / r - 1    (a correction, no timer)
 *   done / 0              -> skipped / null
 *   skipped / null        -> untouched / null
 *
 * so the cycle is N + 3 states long. Only the first transition out of
 * `untouched` starts rest: taps 2..N+3 correct a set the athlete already
 * finished, and restarting a 3:00 clock because they tapped 5 down to 4 would
 * be a bug.
 */

import type { PrescribedSet } from '@/liftoscript/types'
import type { SetLog, WeightValue } from '@/types'

import type { LoggedSet } from './types'

/** Reps can never be fractional or negative, wherever they came from. */
function wholeReps(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback

  return Math.max(0, Math.round(parsed))
}

// The weight is copied, never shared: a `LoggedSet` is handed around by value
// and a shared reference would let one row's weight edit leak into another.
function copyWeight(weight: WeightValue | undefined): WeightValue {
  // DECISION: a missing weight becomes 0 in the profile's absence of units, and
  // the caller (`finishBlockedReason`) turns a 0 into "enter a weight" — the
  // athlete is asked, never blocked by an exception here.
  return { value: Number.isFinite(weight?.value) ? (weight as WeightValue).value : 0, unit: weight?.unit ?? 'kg' }
}

/** Optional keys are OMITTED, never set to `undefined` — Firestore rejects `undefined`. */
function optional(set: { minReps?: number; label?: string }): { minReps?: number; label?: string } {
  return {
    ...(set.minReps === undefined ? {} : { minReps: wholeReps(set.minReps) }),
    ...(set.label === undefined ? {} : { label: set.label }),
  }
}

/** A freshly prescribed set: nothing logged yet. */
export function toLoggedSet(set: PrescribedSet): LoggedSet {
  return {
    prescribedReps: wholeReps(set.reps),
    ...optional({ minReps: set.minReps, label: set.label }),
    isAmrap: set.isAmrap === true,
    weight: copyWeight(set.weight),
    phase: 'untouched',
    completedReps: null,
  }
}

/**
 * Rehydrate after a reload. `completedReps === null` means both "untouched" and
 * "skipped" in the stored model, so the skipped-ness is lost here — by design:
 * to every consumer of a finished session the two are the same miss.
 */
export function fromSetLog(log: SetLog): LoggedSet {
  const done = log.completedReps !== null && Number.isFinite(log.completedReps)

  return {
    prescribedReps: wholeReps(log.prescribedReps),
    ...optional(log),
    isAmrap: log.isAmrap === true,
    weight: copyWeight(log.weight),
    phase: done ? 'done' : 'untouched',
    completedReps: done ? wholeReps(log.completedReps) : null,
  }
}

/** Project back to the stored shape. The phase is dropped; skipped and untouched both become `null`. */
export function toSetLog(set: LoggedSet): SetLog {
  return {
    prescribedReps: wholeReps(set.prescribedReps),
    ...optional(set),
    isAmrap: set.isAmrap === true,
    completedReps: set.phase === 'done' ? wholeReps(set.completedReps) : null,
    weight: copyWeight(set.weight),
  }
}

/**
 * One tap on the row.
 *
 * AMRAP sets never enter the cycle: their whole point is a number ABOVE the
 * prescription, which a decrement-only cycle cannot express and which would
 * take 12 taps to reach. A tap on an AMRAP confirms it at the prescription and
 * is otherwise a no-op, so a stray tap cannot destroy a typed number.
 */
export function tapSet(set: LoggedSet): LoggedSet {
  const target = wholeReps(set.prescribedReps)

  if (set.isAmrap) {
    // DECISION: the contract only names untouched -> done and done -> done for
    // an AMRAP. `skipped -> untouched` is kept in step with the cycle so a
    // mis-tapped Skip is recoverable with one tap instead of hunting for Clear.
    if (set.phase === 'untouched') return { ...set, phase: 'done', completedReps: target }
    if (set.phase === 'skipped') return { ...set, phase: 'untouched', completedReps: null }

    return { ...set }
  }

  if (set.phase === 'untouched') return { ...set, phase: 'done', completedReps: target }

  if (set.phase === 'done') {
    const current = wholeReps(set.completedReps)
    if (current > 0) return { ...set, phase: 'done', completedReps: current - 1 }

    return { ...set, phase: 'skipped', completedReps: null }
  }

  return { ...set, phase: 'untouched', completedReps: null }
}

/** The AMRAP stepper. Floors at 0, no upper bound, integers only, always confirms the set. */
export function setAmrapReps(set: LoggedSet, reps: number | null): LoggedSet {
  return { ...set, phase: 'done', completedReps: wholeReps(reps) }
}

export function skipSet(set: LoggedSet): LoggedSet {
  return { ...set, phase: 'skipped', completedReps: null }
}

export function resetSet(set: LoggedSet): LoggedSet {
  return { ...set, phase: 'untouched', completedReps: null }
}

/**
 * The ONLY rest-timer trigger: the first transition out of `untouched`.
 * Corrections of an already-finished set must never restart the clock.
 */
export function startsRest(before: LoggedSet, after: LoggedSet): boolean {
  return before.phase === 'untouched' && after.phase === 'done'
}

/** Skipped counts as logged — the athlete made a decision about it. */
export function isLogged(set: LoggedSet): boolean {
  return set.phase !== 'untouched'
}

export function loggedCount(sets: LoggedSet[]): number {
  return sets.reduce((count, set) => count + (isLogged(set) ? 1 : 0), 0)
}
