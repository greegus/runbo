/**
 * Comeback mode: what to offer after a long gap without training.
 *
 * The proposal is a plain value — TodayView shows it, and only an explicit
 * accept runs `applyComeback`. Nothing in here mutates a profile or auto-applies
 * anything: a user who just took a holiday may well want to carry straight on.
 */

import { multiply, roundWeight } from '@/liftoscript/weight'
import type { ExerciseState, Profile, Session, WeightValue } from '@/types'
import { addDays, daysBetween, startOfWeekMonday } from '@/utils/date'

import { blockAnchorOf } from './cardioBlock'
import { evalContextFromSettings } from './plates'
import { weeklyCardioMinutes } from './stats'

/** Working weights drop to this share of current; stages are kept. */
export const STRENGTH_FACTOR = 0.9
/** Cardio drops to this share of the last completed week's minutes. */
export const CARDIO_FACTOR = 0.7
/** Week 1 runs at the factors, week 2 halfway back, week 3 normal. */
export const RAMP_WEEKS = 2
/** Used when the profile has no `comebackGapDays`. */
export const DEFAULT_GAP_DAYS = 10

export interface ComebackWeightChange {
  exerciseKey: string
  from: WeightValue
  to: WeightValue
  /** Kept as-is — a comeback lowers the bar, never the GZCLP stage. */
  setVariationIndex: number
}

export interface ComebackProposal {
  /** The day the proposal was computed for. */
  date: string
  lastSessionDate: string | null
  daysSinceLastSession: number
  strengthFactor: number
  cardioFactor: number
  rampWeeks: number
  strength: ComebackWeightChange[]
  cardio: { fromWeeklyMinutes: number; toWeeklyMinutes: number }
  /** Human lines for the proposal card. */
  summary: string[]
}

/** How far back the search for "the last week that actually happened" goes. */
const CARDIO_LOOKBACK_WEEKS = 8

/** Days since the most recent completed session; `null` when there is none. */
export function daysSinceLastSession(sessions: Session[], todayIso: string): number | null {
  const dates = sessions
    .filter((session) => session.status === 'done' && session.date <= todayIso)
    .map((session) => session.date)
  if (dates.length === 0) return null

  return daysBetween(
    dates.reduce((latest, date) => (date > latest ? date : latest)),
    todayIso,
  )
}

/**
 * Ramp factors for week `week` of the comeback (1-based): week 1 runs at the
 * full reduction, every following week closes half the remaining distance in
 * one step, and from `RAMP_WEEKS + 1` on everything is normal again.
 */
export function comebackFactorsForWeek(week: number): { strength: number; cardio: number } {
  if (week <= 1) return { strength: STRENGTH_FACTOR, cardio: CARDIO_FACTOR }
  if (week > RAMP_WEEKS) return { strength: 1, cardio: 1 }

  const halfway = (factor: number) => factor + (1 - factor) / 2
  return { strength: halfway(STRENGTH_FACTOR), cardio: halfway(CARDIO_FACTOR) }
}

/** Minutes of the most recent week that had any cardio at all. */
function lastCompletedCardioMinutes(sessions: Session[], todayIso: string): number {
  let cursor = startOfWeekMonday(todayIso)

  for (let index = 0; index <= CARDIO_LOOKBACK_WEEKS; index++) {
    const minutes = weeklyCardioMinutes(sessions, cursor)
    if (minutes > 0) return minutes
    cursor = addDays(cursor, -7)
  }

  return 0
}

/**
 * The comeback offer, or `null` when the gap is shorter than the profile's
 * threshold (or when there is nothing to come back from).
 */
export function proposeComeback(profile: Profile, sessions: Session[], todayIso: string): ComebackProposal | null {
  const gap = daysSinceLastSession(sessions, todayIso)
  const threshold = profile.settings.comebackGapDays || DEFAULT_GAP_DAYS
  if (gap === null || gap < threshold) return null

  const ctx = evalContextFromSettings(profile.settings)
  const strength: ComebackWeightChange[] = []

  for (const [key, state] of Object.entries(profile.strengthTrack.programState)) {
    const current = state.weights[0]
    if (state.askWeight || !current) continue

    const reduced = roundWeight(multiply(current, STRENGTH_FACTOR), ctx)
    strength.push({ exerciseKey: key, from: current, to: reduced, setVariationIndex: state.setVariationIndex })
  }

  // Falls back to the planned baseline when nothing was logged recently — the
  // proposal must still be a concrete number the user can accept.
  const lastCardio = lastCompletedCardioMinutes(sessions, todayIso) || profile.cardioTrack.weeklyMinutes
  const toWeeklyMinutes = Math.round(lastCardio * CARDIO_FACTOR)

  const lastDate = sessions
    .filter((session) => session.status === 'done' && session.date <= todayIso)
    .map((session) => session.date)
    .reduce<string | null>((latest, date) => (latest === null || date > latest ? date : latest), null)

  return {
    date: todayIso,
    lastSessionDate: lastDate,
    daysSinceLastSession: gap,
    strengthFactor: STRENGTH_FACTOR,
    cardioFactor: CARDIO_FACTOR,
    rampWeeks: RAMP_WEEKS,
    strength,
    cardio: { fromWeeklyMinutes: lastCardio, toWeeklyMinutes },
    summary: [
      `${gap} days since the last session.`,
      `Strength back to ${Math.round(STRENGTH_FACTOR * 100)}% of your working weights, stages kept.`,
      `Cardio back to ${toWeeklyMinutes} min this week (${Math.round(CARDIO_FACTOR * 100)}% of ${lastCardio} min).`,
      `Normal load again in ${RAMP_WEEKS + 1} weeks.`,
    ],
  }
}

/**
 * The values an accepted proposal writes back. Pure: the profile is untouched,
 * the caller persists the result.
 *
 * The mesocycle restarts at week 1 from this week's Monday — ramping back up is
 * a fresh block, not the middle of the one that was interrupted.
 */
export function applyComeback(
  profile: Profile,
  proposal: ComebackProposal,
): { programState: Record<string, ExerciseState>; cardioTrack: Profile['cardioTrack'] } {
  const changes = new Map(proposal.strength.map((change) => [change.exerciseKey, change]))
  const programState: Record<string, ExerciseState> = {}

  for (const [key, state] of Object.entries(profile.strengthTrack.programState)) {
    const change = changes.get(key)
    programState[key] = {
      ...state,
      state: { ...state.state },
      // Only the first entry is the progression's working weight; any further
      // per-variation weights are left as the program wrote them.
      weights: state.weights.map((item, index) => (change && index === 0 ? change.to : { ...item })),
    }
  }

  return {
    programState,
    cardioTrack: {
      ...profile.cardioTrack,
      weeklyMinutes: proposal.cardio.toWeeklyMinutes,
      mesoWeek: 1,
      // A fresh block, anchored the way every block is: the Monday of the week
      // the athlete came back in. `mesoStartDate` is deliberately left as the
      // interrupted block wrote it — nothing reads it once `blockStartDate` is
      // set, and it goes away with the field.
      blockStartDate: blockAnchorOf(proposal.date),
      // The gap guarantees the next planned week reads as missed, and the
      // adaptive branch then works off these two. Left as the interrupted block
      // wrote them, they would hold the first week back at the pre-gap volume
      // and step the baseline back another 10 % on top of the comeback's 70 %.
      lastPlannedMinutes: proposal.cardio.toWeeklyMinutes,
      holdStreak: 0,
    },
  }
}
