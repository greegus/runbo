/**
 * The read model behind the week strip: a composed week, cross-referenced with
 * what was actually logged.
 *
 * `composeWeek` answers "what does this week ask for"; it deliberately keeps
 * `planned` set on a day that already holds a done session, so it cannot answer
 * "what happened". That second question is what this module adds, and it is
 * answered from the session list alone — never from `planned === null`, which
 * means "rest day", not "already trained".
 *
 * Pure and date-free: `todayIso` comes in from the caller, so a whole week of
 * screen states can be replayed for any day in a test.
 */

import { coerceProfileForPreview } from '@/onboarding/previewProfile'
import { planWeek } from '@/training/schedule'
import { describePrescription } from '@/training/zones'
import type { PlannedItem, Profile, Session } from '@/types'
import {
  addDays,
  daysBetween,
  formatHuman,
  startOfWeekMonday,
  WEEKDAY_LABELS,
  weekdayIndexMondayFirst,
} from '@/utils/date'

export type DayStatus = 'planned' | 'done' | 'missed' | 'rest' | 'future'

export interface WeekGridDay {
  date: string
  /** `WEEKDAY_LABELS` entry — 'Mon'. */
  label: string
  human: string
  isToday: boolean
  kind: 'strength' | 'cardio' | null
  title: string
  /** What was logged, when something was; `null` for a day that only holds a plan. */
  detail: string | null
  status: DayStatus
  /** Set when a done or active session sits on that day, so the row can link to it. */
  sessionId: string | null
}

export interface WeekGridModel {
  weekStart: string
  /** '25 Aug – 31 Aug'. */
  weekLabel: string
  isDeloadWeek: boolean
  shortfallMinutes: number
  explanations: string[]
  /** Exactly 7, Monday first. */
  days: WeekGridDay[]
}

/** The window of weeks the live session listener can actually describe. */
export interface WeekWindow {
  earliest: string
  latest: string
}

const WEEKS_BEFORE = 3
const WEEKS_AFTER = 1

/** 'Mon, 25 Aug 2026' → '25 Aug'. One formatter, so the strip and the range agree. */
function dayAndMonth(iso: string): string {
  const parts = formatHuman(iso).split(' ')

  return `${parts[1]} ${parts[2]}`
}

/** The range a week covers, for a heading: '25 Aug – 31 Aug'. */
export function weekRangeLabel(weekStart: string): string {
  return `${dayAndMonth(weekStart)} – ${dayAndMonth(addDays(weekStart, 6))}`
}

/**
 * Where a week sits relative to today, in words.
 *
 * A date range alone does not tell the athlete whether they are looking at the
 * week they are in — the range is the detail, this is the answer.
 */
export function weekOffsetLabel(weekStart: string, todayIso: string): string {
  const offset = daysBetween(startOfWeekMonday(todayIso), startOfWeekMonday(weekStart)) / 7

  if (offset === 0) return 'This week'
  if (offset === -1) return 'Last week'
  if (offset === 1) return 'Next week'

  return offset < 0 ? `${-offset} weeks ago` : `In ${offset} weeks`
}

/**
 * The weeks the live session listener covers — the only weeks a view may offer.
 *
 * Outside it the loaded session list holds nothing, and a week composed against
 * nothing renders a confident "0 done" for a week that may have been trained.
 * Refusing to navigate there is the honest answer.
 */
export function liveWeekWindow(todayIso: string, weeksBefore = WEEKS_BEFORE, weeksAfter = WEEKS_AFTER): WeekWindow {
  const thisWeek = startOfWeekMonday(todayIso)

  return { earliest: addDays(thisWeek, -7 * weeksBefore), latest: addDays(thisWeek, 7 * weeksAfter) }
}

/** The week `delta` steps away, or `null` when that would leave the window. */
export function stepWeek(weekStart: string, delta: number, window: WeekWindow): string | null {
  const next = addDays(startOfWeekMonday(weekStart), 7 * delta)

  if (next < window.earliest || next > window.latest) return null

  return next
}

function titleOf(planned: PlannedItem | null, session: Session | null, profile: Profile): string {
  if (planned?.kind === 'strength') return `Strength ${planned.programDay}`
  // One phrasing of a cardio prescription in the whole app: this one.
  if (planned?.kind === 'cardio') return describePrescription(planned.prescription, profile.cardioTrack.zones)

  // Nothing planned but something logged: an unplanned session the athlete
  // chose to do. It is still their week, so name it from what they did.
  if (session?.kind === 'strength') return session.programDay ? `Strength ${session.programDay}` : 'Strength session'
  if (session?.kind === 'cardio') {
    return session.prescription ? describePrescription(session.prescription, profile.cardioTrack.zones) : 'Cardio'
  }

  return 'Rest'
}

/** What was logged, in the fewest words that are still true. `null` for a plan. */
function detailOf(session: Session | null): string | null {
  if (!session) return null
  if (session.status === 'active') return 'In progress'

  if (session.kind === 'strength') {
    const sets = (session.exercises ?? []).reduce(
      (count, exercise) => count + exercise.sets.filter((set) => (set.completedReps ?? 0) > 0).length,
      0,
    )

    return sets > 0 ? `${sets} ${sets === 1 ? 'set' : 'sets'} logged` : 'Logged'
  }

  const parts: string[] = []
  if (typeof session.minutes === 'number' && Number.isFinite(session.minutes)) parts.push(`${session.minutes} min`)
  if (typeof session.distanceKm === 'number' && Number.isFinite(session.distanceKm)) {
    parts.push(`${session.distanceKm} km`)
  }

  return parts.length > 0 ? parts.join(' · ') : 'Logged'
}

/**
 * One day of the strip: what was planned on it, cross-referenced with what was
 * logged. Exported because the day picker builds its rows from the same
 * function — a day must read the same in the calendar as it does in the week
 * strip, whichever frontier its item was composed behind.
 *
 * `profile` is expected already coerced (`coerceProfileForPreview`); the callers
 * do that once per model rather than once per day.
 */
export function describeDay(
  date: string,
  planned: PlannedItem | null,
  sessions: Session[],
  todayIso: string,
  profile: Profile,
): WeekGridDay {
  const onDay = sessions.filter((session) => session.date === date)
  // A done session on a day the planner still calls "strength" is the case
  // `planned === null` cannot see: composeWeek keeps the plan on a trained
  // day, so "done" is decided here, from the session list.
  const done =
    onDay.find((session) => session.status === 'done' && planned !== null && session.kind === planned.kind) ??
    onDay.find((session) => session.status === 'done') ??
    null
  const active = onDay.find((session) => session.status === 'active') ?? null
  const session = done ?? active

  let status: DayStatus
  if (done) status = 'done'
  else if (active) status = 'planned'
  else if (planned === null) status = 'rest'
  else if (date > todayIso) status = 'future'
  else if (date < todayIso) status = 'missed'
  else status = 'planned'

  return {
    date,
    label: WEEKDAY_LABELS[weekdayIndexMondayFirst(date)],
    human: formatHuman(date),
    isToday: date === todayIso,
    kind: session?.kind ?? planned?.kind ?? null,
    title: titleOf(planned, session, profile),
    detail: detailOf(session),
    status,
    sessionId: session?.id ?? null,
  }
}

/**
 * One week, planned and done.
 *
 * `options.fromDate` is the frontier `planWeek` takes: pass `todayIso` for the
 * current week's day grid so it agrees with the Today card, and nothing for a
 * past or future week — a frontier of today would free a whole past week and
 * show an athlete an empty version of a week they trained.
 *
 * The profile is coerced the way the onboarding preview coerces it: harmless
 * for a live profile, and required for a half-filled wizard draft, which is the
 * other caller of this model.
 */
export function buildWeekGrid(
  profile: Profile,
  sessions: Session[],
  anchorIso: string,
  todayIso: string,
  options?: { fromDate?: string | null },
): WeekGridModel {
  const safeProfile = coerceProfileForPreview(profile)
  const fromDate = options?.fromDate ?? undefined
  const plan = planWeek(safeProfile, sessions, anchorIso, fromDate)

  const days = plan.week.days.map((day) => describeDay(day.date, day.planned, sessions, todayIso, safeProfile))

  return {
    weekStart: plan.week.weekStart,
    weekLabel: weekRangeLabel(plan.week.weekStart),
    isDeloadWeek: plan.isDeloadWeek,
    shortfallMinutes: plan.cardio.shortfallMinutes,
    explanations: plan.week.explanations,
    days,
  }
}
