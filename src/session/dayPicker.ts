/**
 * The read model behind the day picker on the Today screen: every day the
 * athlete may open as "the day" — to backfill a session they trained but never
 * logged, or to train a planned day ahead of time.
 *
 * Pure and date-free, like `today.ts`: `todayIso` comes in from the caller.
 *
 * The range is not a design choice, it is what the data can honestly describe:
 * `sessionsStore` keeps a live window of three weeks back and one ahead, and a
 * day composed against a window that does not cover it renders a confident
 * "missed" for a day that may well have been trained. So the picker opens on
 * the same Monday the live window opens on, and closes a week from today.
 *
 * Each day is composed behind the frontier `frontierFor` picks (see
 * `schedule.ts`): today and the future as of now, a past day as a replay of that
 * day. The past therefore costs one composition per day, not per week — a
 * missed Monday and a missed Wednesday are both offered the same outstanding
 * A1, because under a cursor rotation that IS what either day would have been.
 * It is also why the picker and the Plan tab can disagree on a missed day: the
 * Plan tab says what the week asked for, the picker says what can still be
 * started, and only the second one is safe to act on.
 */

import { coerceProfileForPreview } from '@/onboarding/previewProfile'
import { frontierFor, planWeek, type WeekPlan } from '@/training/schedule'
import type { Profile, Session } from '@/types'
import { addDays, daysBetween, formatHuman, startOfWeekMonday } from '@/utils/date'

import { describeDay, liveWeekWindow, type WeekGridDay, weekOffsetLabel, weekRangeLabel } from './weekGrid'

/** How far ahead of today a day may be started — "a week forward". */
export const DAYS_AHEAD = 7

export interface PickerDay extends WeekGridDay {
  /**
   * A day with something on it — a plan, a logged session, or both. A rest day
   * with nothing logged has nothing to open: claiming one is today-only, and
   * the picker is not the place to invent a session.
   */
  selectable: boolean
}

export interface PickerWeek {
  weekStart: string
  /** 'This week', 'Last week', '2 weeks ago', 'Next week'. */
  label: string
  /** '25 Aug – 31 Aug'. */
  range: string
  /** Only the days inside the picker's range — next week is cut at `latest`. */
  days: PickerDay[]
}

export interface DayPickerModel {
  earliest: string
  latest: string
  /** Oldest week first — the athlete scrolls down towards the future. */
  weeks: PickerWeek[]
}

/** The first and the last day the picker offers, inclusive. */
export function pickerRange(todayIso: string): { earliest: string; latest: string } {
  return { earliest: liveWeekWindow(todayIso).earliest, latest: addDays(todayIso, DAYS_AHEAD) }
}

/**
 * How the day reads in a heading: 'Today', 'Yesterday', 'Tomorrow', otherwise
 * 'Mon, 31 Aug' — the year is noise inside a five-week window.
 */
export function relativeDayLabel(dateIso: string, todayIso: string): string {
  const offset = daysBetween(todayIso, dateIso)

  if (offset === 0) return 'Today'
  if (offset === -1) return 'Yesterday'
  if (offset === 1) return 'Tomorrow'

  return formatHuman(dateIso).replace(/ \d{4}$/, '')
}

export function buildDayPicker(profile: Profile, sessions: Session[], todayIso: string): DayPickerModel {
  const safeProfile = coerceProfileForPreview(profile)
  const { earliest, latest } = pickerRange(todayIso)

  // Today and every future day share one frontier, so they share one
  // composition per week; every past day gets its own. Keyed on both so the two
  // never collide inside the current week.
  const plans = new Map<string, WeekPlan>()
  const planFor = (dateIso: string): WeekPlan => {
    const frontier = frontierFor(dateIso, todayIso)
    const key = `${startOfWeekMonday(dateIso)}|${frontier}`
    let plan = plans.get(key)
    if (!plan) {
      plan = planWeek(safeProfile, sessions, dateIso, frontier)
      plans.set(key, plan)
    }

    return plan
  }

  const weeks: PickerWeek[] = []

  for (let weekStart = startOfWeekMonday(earliest); weekStart <= latest; weekStart = addDays(weekStart, 7)) {
    const days: PickerDay[] = []

    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(weekStart, offset)
      if (date < earliest || date > latest) continue

      const planned = planFor(date).week.days.find((day) => day.date === date)?.planned ?? null
      const day = describeDay(date, planned, sessions, todayIso, safeProfile)

      days.push({ ...day, selectable: day.kind !== null })
    }

    weeks.push({ weekStart, label: weekOffsetLabel(weekStart, todayIso), range: weekRangeLabel(weekStart), days })
  }

  return { earliest, latest, weeks }
}
