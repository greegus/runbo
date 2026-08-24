/**
 * Cardio mesocycle planner: one call per week produces that week's sessions and
 * the state the caller must persist for the next call.
 *
 * The module is a pure function of the stored track state — no dates, no
 * randomness — so a whole training block can be replayed in a test.
 *
 * `holdStreak` and `rotationCursor` come back in the result and MUST be written
 * back to `cardioTrack`, otherwise the adaptive step-back and the modality
 * rotation restart every week.
 */

import type { CardioPrescription, Modality, Profile } from '@/types'

/**
 * The track state the planner reads. An alias rather than a separate shape: the
 * planner reads exactly what the profile stores. Kept as a name because the
 * planner is the only place that gives `holdStreak`/`rotationCursor` meaning.
 */
export type CardioTrackState = Profile['cardioTrack']

export interface CardioWeekPlan {
  sessions: CardioPrescription[]
  weeklyMinutes: number
  isDeload: boolean
  /** Persist to `cardioTrack.mesoWeek`. */
  nextMesoWeek: number
  /** Persist to `cardioTrack.weeklyMinutes` (the mesocycle baseline). */
  nextBaseline: number
  /** Persist to `cardioTrack.holdStreak`. */
  holdStreak: number
  /** Persist to `cardioTrack.rotationCursor`. */
  rotationCursor: number
  /**
   * Target minutes that did not fit under the per-session ceiling. Non-zero
   * means the week is deliberately short: too few cardio days for the volume,
   * given how long the athlete's longest session has actually been. The UI
   * surfaces it as "add a cardio day", it is never silently absorbed.
   */
  shortfallMinutes: number
}

/** Weekly volume ramp inside a mesocycle, and the week-4 deload. */
const WEEKLY_RAMP = 1.08
const DELOAD_FACTOR = 0.6

/** Under this share of the prescribed minutes the week does not count as done. */
const HOLD_THRESHOLD = 0.7
const STEP_BACK_FACTOR = 0.9

const LONG_SHARE = 0.4
const LONG_CAP_FACTOR = 1.1
const INTERVALS_SHARE = 0.25
const INTERVALS_MIN_WEEKLY = 120
const MIN_EASY_MINUTES = 20

/** 6x3min at Z4 — the plan's one interval template. */
const INTERVAL_STRUCTURE = { reps: 6, workMinutes: 3, restMinutes: 2 }

/** Rotation order; disabled modalities are skipped, the order never changes. */
const MODALITY_ORDER: Modality[] = ['run', 'bike', 'swim']

type SessionKindPlan = CardioPrescription['kind']

function clampMesoWeek(week: number): number {
  return Math.min(4, Math.max(1, Math.round(week || 1)))
}

/**
 * A non-negative, finite number. A profile field that arrived as `NaN` (an
 * empty form input, a bad import) must not turn into `targetMinutes: NaN` on a
 * prescription that gets stored and rendered.
 */
function positive(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/** Volume of a given mesocycle week off a baseline. Week 4 is the deload. */
function volumeFor(baseline: number, mesoWeek: number): number {
  const raw = mesoWeek >= 4 ? baseline * DELOAD_FACTOR : baseline * WEEKLY_RAMP ** (mesoWeek - 1)

  return Math.round(raw)
}

/**
 * Plans one cardio week.
 *
 * `lastWeekCompletionRatio` is completed / prescribed minutes for the week just
 * finished (1 for a fresh start). `cardioDays` is how many days the composer can
 * give cardio this week.
 */
export function planCardioWeek(
  cardioTrack: CardioTrackState,
  lastWeekCompletionRatio: number,
  cardioDays: number,
): CardioWeekPlan {
  const storedWeek = clampMesoWeek(cardioTrack.mesoWeek)
  const holdStreakBefore = Math.max(0, Math.round(cardioTrack.holdStreak ?? 0))
  const missed = lastWeekCompletionRatio < HOLD_THRESHOLD

  let baseline = Math.round(positive(cardioTrack.weeklyMinutes))
  let effectiveWeek = storedWeek
  let holdStreak = 0
  let isHold = false

  if (missed && holdStreakBefore + 1 >= 2) {
    // Second miss in a row: the baseline itself was too high. Step it back and
    // restart the mesocycle from the week we are on rather than from week 1 —
    // the ramp is not the problem, the absolute volume is.
    baseline = Math.round(baseline * STEP_BACK_FACTOR)
  } else if (missed) {
    // First miss: repeat last week's volume. `storedWeek` is the week we WOULD
    // have run, so stepping one back reproduces the volume just missed.
    effectiveWeek = Math.max(1, storedWeek - 1)
    holdStreak = holdStreakBefore + 1
    isHold = true
  }

  // A hold repeats what was actually prescribed. Deriving it from the mesocycle
  // week instead only works while the weeks run in order: after a deload
  // `storedWeek` is already back at 1, so `storedWeek - 1` clamps to 1 and a
  // skipped deload would be "held" at the full week-1 volume of the new,
  // higher baseline — twice what the athlete just failed to do.
  const held = isHold ? Math.round(positive(cardioTrack.lastPlannedMinutes)) : 0
  const weeklyMinutes = held > 0 ? held : volumeFor(baseline, effectiveWeek)
  const isDeload = effectiveWeek >= 4

  // A hold does not consume a mesocycle week; everything else advances, and the
  // deload week rolls week 3's volume in as the next baseline.
  const nextMesoWeek = isHold ? storedWeek : isDeload ? 1 : effectiveWeek + 1
  const nextBaseline = isDeload && !isHold ? volumeFor(baseline, 3) : baseline

  const { sessions, rotationCursor, shortfallMinutes } = buildSessions(cardioTrack, weeklyMinutes, cardioDays)

  return {
    sessions,
    weeklyMinutes: sessions.reduce((sum, session) => sum + session.targetMinutes, 0),
    isDeload,
    nextMesoWeek,
    nextBaseline,
    holdStreak,
    rotationCursor,
    shortfallMinutes,
  }
}

function buildSessions(
  cardioTrack: CardioTrackState,
  weeklyMinutes: number,
  cardioDays: number,
): { sessions: CardioPrescription[]; rotationCursor: number; shortfallMinutes: number } {
  const enabled = MODALITY_ORDER.filter((modality) => cardioTrack.modalities.includes(modality))
  const cursorBefore = normalizeCursor(cardioTrack.rotationCursor, enabled.length)
  const days = Math.floor(positive(cardioDays))

  // Nothing to place: report an honest zero rather than minutes nobody will run.
  if (enabled.length === 0 || days === 0 || weeklyMinutes <= 0) {
    return { sessions: [], rotationCursor: cursorBefore, shortfallMinutes: Math.max(0, weeklyMinutes) }
  }

  const { kinds, minutes, shortfallMinutes } = splitSessions(weeklyMinutes, days, cardioTrack.longestSessionMinutes)

  return { ...assignModalities(kinds, minutes, enabled, cursorBefore), shortfallMinutes }
}

function normalizeCursor(cursor: number | undefined, length: number): number {
  if (length === 0) return 0

  const value = Math.round(cursor ?? 0)

  return ((value % length) + length) % length
}

/**
 * Spreads `remainder` a minute at a time over `indexes`, round robin, never
 * past `ceiling`. Returns what did not fit.
 */
function pour(minutes: number[], indexes: number[], remainder: number, ceiling: number): number {
  let left = remainder
  let placed = true

  while (left > 0 && placed) {
    placed = false

    for (const index of indexes) {
      if (left === 0) break
      if (minutes[index] >= ceiling) continue

      minutes[index] += 1
      left -= 1
      placed = true
    }
  }

  return left
}

/**
 * Kinds and minute budgets in one pass: one long session, one intervals session
 * once the week is big enough, the remainder split into easy Z2 sessions.
 *
 * NO session may run past `ceiling` — 110 % of the longest session the athlete
 * has actually done. Capping only the session labelled `long` (which is what
 * the plan literally says) is not enough: the week has to add up exactly, so
 * every leftover minute lands on whichever session is allowed to grow, and with
 * two cardio days that produced a 112-minute "long" run for someone whose
 * longest ever session is 60. Leftovers therefore spill across every session
 * that still has room.
 *
 * When the week's volume cannot fit under the ceiling at all — 150 minutes with
 * one cardio day for someone who has never run past an hour — the week comes up
 * SHORT rather than prescribing the jump. Reporting a shortfall the athlete can
 * act on ("add a cardio day") is honest; a 150-minute session is how people get
 * hurt, and the target is only a target. `longestSessionMinutes` grows as longer
 * sessions actually get logged, so the ceiling lifts with real fitness.
 */
function splitSessions(
  weeklyMinutes: number,
  days: number,
  longestSessionMinutes: number,
): { kinds: SessionKindPlan[]; minutes: number[]; shortfallMinutes: number } {
  const hasIntervals = weeklyMinutes >= INTERVALS_MIN_WEEKLY && days >= 2
  const kinds: SessionKindPlan[] = ['long']

  const idealLong = Math.round(weeklyMinutes * LONG_SHARE)
  const idealIntervals = hasIntervals ? Math.round(weeklyMinutes * INTERVALS_SHARE) : 0
  if (hasIntervals) kinds.push('intervals')

  const rest = weeklyMinutes - idealLong - idealIntervals
  let easyCount = days - kinds.length

  // Sub-20-minute easy sessions are not worth the shoes: merge them away.
  while (easyCount > 0 && rest / easyCount < MIN_EASY_MINUTES) {
    easyCount -= 1
  }

  for (let index = 0; index < easyCount; index += 1) kinds.push('easy')

  const ceiling = Math.floor(Math.max(MIN_EASY_MINUTES, positive(longestSessionMinutes)) * LONG_CAP_FACTOR)
  // What the available sessions can hold without any of them exceeding the
  // ceiling. Anything above this is the shortfall, reported rather than poured
  // into a session the athlete is not trained for.
  const capacity = ceiling * kinds.length
  const target = Math.min(weeklyMinutes, capacity)
  const shortfallMinutes = weeklyMinutes - target
  const evenShare = Math.ceil(target / kinds.length)

  // The long session is the week's longest by construction — at least the even
  // share — so the deload week can no longer come out as `long 36, easy 54`.
  const minutes = kinds.map((kind, index) => {
    if (index === 0) return Math.min(Math.max(Math.min(idealLong, target), evenShare), ceiling)

    return kind === 'intervals' ? Math.min(idealIntervals, ceiling) : 0
  })

  // Easy sessions are where spare volume belongs. With none of them — a two-day
  // week is long + intervals and nothing else — the leftover goes round robin
  // over every session instead of filling the long one to the ceiling first,
  // which is how a 150-minute fortnight used to come out as 99 + 51.
  const allIndexes = kinds.map((_, index) => index)
  const sinks = easyCount > 0 ? allIndexes.filter((index) => kinds[index] === 'easy') : allIndexes

  // Whole minutes only, and the sum must land exactly on `target`.
  const remainder = target - minutes.reduce((sum, value) => sum + value, 0)
  const left = pour(minutes, sinks, remainder, ceiling)
  if (left > 0) {
    pour(
      minutes,
      minutes.map((_, index) => index),
      left,
      ceiling,
    )
  }

  return { kinds, minutes, shortfallMinutes }
}

const ZONE_BY_KIND: Record<SessionKindPlan, CardioPrescription['zone']> = {
  easy: 2,
  long: 2,
  tempo: 3,
  intervals: 4,
}

/**
 * Deterministic rotation: walk the enabled modalities in a fixed order, carrying
 * the cursor across weeks. Because the cursor always advances, two sessions
 * inside a week never share a modality when more than one is enabled.
 *
 * Across the week boundary the two rules can genuinely conflict: with `run` and
 * `swim` enabled and an odd number of sessions a week, the cursor lands on swim
 * for the next long session, the veto below skips it, and the week opens on the
 * modality the last one closed with. The veto wins — a long swim is a different
 * sport, while a Saturday long run and a Tuesday easy run are three days apart.
 */
function assignModalities(
  kinds: SessionKindPlan[],
  minutes: number[],
  enabled: Modality[],
  cursorBefore: number,
): { sessions: CardioPrescription[]; rotationCursor: number } {
  const sessions: CardioPrescription[] = []
  let cursor = cursorBefore
  let previous: Modality | undefined

  for (let index = 0; index < kinds.length; index += 1) {
    const kind = kinds[index]
    let modality = enabled[cursor % enabled.length]

    // Swimming a "long" session is a different sport than a long run/ride, so
    // swim yields the long slot unless it is all the user has.
    for (let guard = 0; guard < enabled.length && enabled.length > 1; guard += 1) {
      const rejected = (kind === 'long' && modality === 'swim') || modality === previous

      if (!rejected) break

      cursor += 1
      modality = enabled[cursor % enabled.length]
    }

    sessions.push({
      modality,
      kind,
      targetMinutes: minutes[index],
      zone: ZONE_BY_KIND[kind],
      ...(kind === 'intervals' ? { structure: { ...INTERVAL_STRUCTURE } } : {}),
    })

    previous = modality
    cursor += 1
  }

  return { sessions, rotationCursor: normalizeCursor(cursor, enabled.length) }
}

/**
 * The new `longestSessionMinutes` after a cardio session is logged.
 *
 * Without this the per-session ceiling is frozen at whatever onboarding was
 * told, so an athlete who has been running 90 minutes for a month would still
 * be capped at their original hour and the week would report a shortfall
 * forever. It only ever grows, and only from what was actually completed.
 */
export function growLongestSession(current: number, completedMinutes: number): number {
  return Math.max(positive(current), Math.round(positive(completedMinutes)))
}
