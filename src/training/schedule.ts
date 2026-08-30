/**
 * The read model TodayView and PlanView sit on: compose the week the two
 * planners describe, then answer "what about today".
 *
 * Pure and date-free — `todayIso` comes in from the caller, so the whole screen
 * can be replayed for any day in a test.
 *
 * The rotation is the ATHLETE'S. GZCLP is the program the MVP ships, not the
 * shape the app assumes: the day list and the heavy-lower rule are both read off
 * whatever program the profile carries, so a pasted three-day split cycles three
 * days. A program that does not parse schedules no strength — the session screen
 * is where that is explained, with the parser's own diagnostics.
 */

import { parseProgram } from '@/liftoscript/parser'
import type { CardioPrescription, ComposedWeek, PlannedItem, Profile, Session } from '@/types'
import { addDays, inWeek, startOfWeekMonday, WEEK_LENGTH } from '@/utils/date'

import { type CardioWeekPlan, planCardioWeek } from './cardioPlan'
import { type ComebackProposal, daysSinceLastSession, proposeComeback } from './comeback'
import { claimToday, type ComposedWeekPlan, type ComposeWeekInput, composeWeek, weeklyTrackBudget } from './composer'
import { isHeavyLowerDay } from './gzclp'
import { rotationDays } from './rotation'
import { cardioCompletionRatio } from './stats'

/** Everything one week needs, kept together so callers can re-run an override. */
export interface WeekPlan {
  week: ComposedWeekPlan
  cardio: CardioWeekPlan
  isDeloadWeek: boolean
  /** The exact input the week was composed from — `claimToday`/`swapToday` need it. */
  input: ComposeWeekInput
}

export interface TodayResolution {
  /** What is planned for today, or `null` on a rest day. */
  item: PlannedItem | null
  isRestDay: boolean
  isDeloadWeek: boolean
  /** What claiming today would offer — only set on a rest day with work outstanding. */
  catchUp: PlannedItem | null
  comebackProposal: ComebackProposal | null
  /** `0` when nothing was ever logged: a fresh profile has no gap to report. */
  daysSinceLastSession: number
}

function countKind(week: ComposedWeek, kind: PlannedItem['kind']): number {
  return week.days.filter((day) => day.planned?.kind === kind).length
}

/**
 * How much of last week's cardio actually happened, as the adaptive planner's
 * input.
 *
 * A profile with nothing logged before this week counts as fully done: the
 * adaptive hold exists for someone who trained and fell short, and holding a
 * brand-new user's very first week back would be nonsense.
 *
 * The divisor is `lastPlannedMinutes` — what last week was actually prescribed —
 * and NOT the mesocycle baseline: a deload week prescribes 60 % of the baseline,
 * so measuring a completed deload against the baseline would score it at ~0.5
 * and hold the following week for no reason. The baseline is only the fallback
 * for a profile written before the field existed.
 */
function lastWeekRatio(profile: Profile, sessions: Session[], weekStart: string): number {
  const hasHistory = sessions.some((session) => session.status === 'done' && session.date < weekStart)
  if (!hasHistory) return 1

  const prescribed = profile.cardioTrack.lastPlannedMinutes || profile.cardioTrack.weeklyMinutes

  return cardioCompletionRatio(sessions, addDays(weekStart, -WEEK_LENGTH), prescribed)
}

/**
 * Composes the week `anchorIso` falls in.
 *
 * `fromDate` marks the frontier: days before it that hold no logged session
 * cannot happen any more and their work rolls forward. Omit it to plan a whole
 * week (the onboarding preview, PlanView of a future week).
 */
export function planWeek(profile: Profile, sessions: Session[], anchorIso: string, fromDate?: string): WeekPlan {
  const weekStart = startOfWeekMonday(anchorIso)

  // The cardio planner needs to know how many days it will get before the
  // composer knows which prescriptions exist, so ask the budget for the day
  // count first; `composeWeek` re-derives it from the real session list.
  // WEEK_LENGTH as the cardio-session count is not a week length: it is an
  // upper bound high enough that the budget's `Math.min` never bites here.
  const cardioDays = weeklyTrackBudget(profile.availability, WEEK_LENGTH).cardioDays
  const cardio = planCardioWeek(profile.cardioTrack, lastWeekRatio(profile, sessions, weekStart), cardioDays)

  // Parsed here rather than passed in: `planWeek` takes a Profile, and the day
  // list is a property of the program that profile carries.
  const { program, diagnostics } = parseProgram(profile.strengthTrack.programText)
  const programDays = diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? [] : rotationDays(program)

  const input: ComposeWeekInput = {
    weekStart,
    availability: profile.availability,
    rotationCursor: profile.strengthTrack.rotationCursor,
    programDays,
    cardioSessions: cardio.sessions,
    heavyLowerDays: (programDay: string) => isHeavyLowerDay(programDay, program),
    completedSessions: sessions.filter((session) => session.status === 'done' && inWeek(session.date, weekStart)),
    ...(fromDate ? { fromDate } : {}),
  }

  return { week: composeWeek(input), cardio, isDeloadWeek: cardio.isDeload, input }
}

/**
 * Today's card: the planned item, or — on a rest day the week is behind on —
 * the session claiming today would offer.
 */
export function resolveToday(profile: Profile, sessions: Session[], todayIso: string): TodayResolution {
  const plan = planWeek(profile, sessions, todayIso, todayIso)
  const item = plan.week.days.find((day) => day.date === todayIso)?.planned ?? null

  return {
    item,
    isRestDay: item === null,
    isDeloadWeek: plan.isDeloadWeek,
    catchUp: item === null ? catchUpFor(profile, plan, todayIso) : null,
    comebackProposal: proposeComeback(profile, sessions, todayIso),
    daysSinceLastSession: daysSinceLastSession(sessions, todayIso) ?? 0,
  }
}

/**
 * What an unplanned day is worth. `null` when the week's budget is already
 * covered by what is planned or logged — offering a bonus session to someone
 * who is on track is how overtraining starts.
 */
function catchUpFor(profile: Profile, plan: WeekPlan, todayIso: string): PlannedItem | null {
  const budget = weeklyTrackBudget(profile.availability, plan.cardio.sessions.length)
  const behind =
    countKind(plan.week, 'strength') < budget.strengthDays || countKind(plan.week, 'cardio') < budget.cardioDays

  if (!behind) return null

  return claimToday(plan.week, todayIso, plan.input).days.find((day) => day.date === todayIso)?.planned ?? null
}

/** The cardio prescriptions of a week, in calendar order — for PlanView and the weekly totals. */
export function cardioOf(week: ComposedWeek): CardioPrescription[] {
  return week.days.flatMap((day) => (day.planned?.kind === 'cardio' ? [day.planned.prescription] : []))
}
