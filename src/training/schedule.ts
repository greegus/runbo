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

import { blockRatio } from './cardioBlock'
import { type CardioWeekPlan, planCardioWeek } from './cardioPlan'
import { type ComebackProposal, daysSinceLastSession, proposeComeback } from './comeback'
import { claimToday, type ComposedWeekPlan, type ComposeWeekInput, composeWeek, weeklyTrackBudget } from './composer'
import { isHeavyLowerDay } from './gzclp'
import { rotationDays } from './rotation'

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
 * How many days of a full week the composer will hand to cardio.
 *
 * Exported because the block rollover needs the count without going anywhere
 * near a composed week. `WEEK_LENGTH` as the cardio-session count is not a week
 * length: it is an upper bound high enough that the budget's `Math.min` never
 * bites.
 */
export function plannedCardioDays(availability: Profile['availability']): number {
  return weeklyTrackBudget(availability, WEEK_LENGTH).cardioDays
}

/**
 * Composes the week `anchorIso` falls in.
 *
 * `fromDate` marks the frontier: days before it that hold no logged session
 * cannot happen any more and their work rolls forward. Omit it to plan a whole
 * week (the onboarding preview, PlanView of a past week).
 *
 * When the frontier lies in an EARLIER week than the anchor, the strength days
 * between the two have not happened yet but will — so the rotation cursor is
 * projected across them before the anchor week is composed. Without that, next
 * week opened on Wednesday with B1 while this Wednesday also said B1: the stored
 * cursor only moves when a session is logged, and a week composed straight off
 * it repeats whatever this week still has to do. A day that is already logged
 * is not counted — the stored cursor already carries it.
 */
export function planWeek(profile: Profile, sessions: Session[], anchorIso: string, fromDate?: string): WeekPlan {
  const weekStart = startOfWeekMonday(anchorIso)

  // The cardio planner needs to know how many days it will get before the
  // composer knows which prescriptions exist, so ask the budget for the day
  // count first; `composeWeek` re-derives it from the real session list.
  //
  // The adaptive input comes off the stored BLOCK, never off `anchorIso`: the
  // composing window below is still the calendar week the anchor falls in, but
  // the mesocycle is not, and measuring the seven days before the anchor made a
  // preview of next week score this half-logged one and come back held.
  const cardio = planCardioWeek(
    profile.cardioTrack,
    blockRatio(profile.cardioTrack, sessions),
    plannedCardioDays(profile.availability),
  )

  // Parsed here rather than passed in: `planWeek` takes a Profile, and the day
  // list is a property of the program that profile carries.
  const { program, diagnostics } = parseProgram(profile.strengthTrack.programText)
  const programDays = diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? [] : rotationDays(program)
  const heavyLowerDays = (programDay: string) => isHeavyLowerDay(programDay, program)

  const compose = (start: string, rotationCursor: number): { input: ComposeWeekInput; week: ComposedWeekPlan } => {
    const input: ComposeWeekInput = {
      weekStart: start,
      availability: profile.availability,
      rotationCursor,
      programDays,
      cardioSessions: cardio.sessions,
      heavyLowerDays,
      completedSessions: sessions.filter((session) => session.status === 'done' && inWeek(session.date, start)),
      ...(fromDate ? { fromDate } : {}),
    }

    return { input, week: composeWeek(input) }
  }

  let cursor = profile.strengthTrack.rotationCursor

  if (fromDate && programDays.length > 0) {
    for (let start = startOfWeekMonday(fromDate); start < weekStart; start = addDays(start, WEEK_LENGTH)) {
      const between = compose(start, cursor)
      const toCome = between.week.days.filter(
        (day) =>
          day.planned?.kind === 'strength' &&
          !between.input.completedSessions.some((session) => session.date === day.date && session.kind === 'strength'),
      ).length

      cursor = (cursor + toCome) % programDays.length
    }
  }

  const { input, week } = compose(weekStart, cursor)

  return { week, cardio, isDeloadWeek: cardio.isDeload, input }
}

/**
 * The frontier a day is composed behind when it is not today.
 *
 * Today and every day after it are planned AS OF NOW — the frontier is today, so
 * a Thursday looked at on Tuesday shows the same B1 the Plan tab shows, not the
 * A1 it would get if Tuesday and Wednesday were skipped.
 *
 * A past day is REPLAYED — the frontier is the day itself, so it shows what the
 * app offered that morning: the work that was outstanding as of that day. This
 * is what makes backfilling safe under a cursor-driven rotation. Composing the
 * whole week instead would label a missed Monday A1 and a missed Wednesday B1,
 * and logging the Wednesday would step the cursor past an A1 that never
 * happened; with the frontier on the day, whichever past day is filled in is
 * offered the outstanding A1, and nothing is skipped.
 */
export function frontierFor(dateIso: string, todayIso: string): string {
  return dateIso < todayIso ? dateIso : todayIso
}

/**
 * Today's card: the planned item, or — on a rest day the week is behind on —
 * the session claiming today would offer.
 */
export function resolveToday(profile: Profile, sessions: Session[], todayIso: string): TodayResolution {
  return resolveDay(profile, sessions, todayIso, todayIso)
}

/**
 * `resolveToday` for any day: what `dateIso` asks of the athlete, seen from
 * `todayIso`. The frontier follows `frontierFor`; the comeback and the gap are
 * about now, whichever day is on screen, so they are always measured to today.
 */
export function resolveDay(profile: Profile, sessions: Session[], dateIso: string, todayIso: string): TodayResolution {
  const plan = planWeek(profile, sessions, dateIso, frontierFor(dateIso, todayIso))
  const item = plan.week.days.find((day) => day.date === dateIso)?.planned ?? null

  return {
    item,
    isRestDay: item === null,
    isDeloadWeek: plan.isDeloadWeek,
    catchUp: item === null ? catchUpFor(profile, plan, dateIso) : null,
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
