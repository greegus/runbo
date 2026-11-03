/**
 * Sauna suggestions on rest days.
 *
 * Sauna is not a track and not a planned item: it is read off a week that is
 * already composed, after the fact, so the strength rotation, the cardio budget,
 * the streak and the week's counts never see it. A rest day with a suggestion is
 * still a rest day. See docs/proposals/sauna-on-rest-days.md.
 */

import type { Session, TrainingKind } from '@/types'
import { addDays } from '@/utils/date'

export function isSauna(session: Session): boolean {
  return session.kind === 'sauna'
}

/**
 * The sessions that are training. Every planner, stat and gap check takes its
 * list through here, so a claimed sauna never makes a rest day a training day,
 * never fills a slot, never extends a streak and never closes a gap.
 */
export function trainingSessions(sessions: Session[]): (Session & { kind: TrainingKind })[] {
  return sessions.filter((session): session is Session & { kind: TrainingKind } => !isSauna(session))
}

/** One a week: a nudge towards a habit, not a second schedule to keep up with. */
export const SAUNA_PER_WEEK = 1

/** One day of a composed week, as much of it as the suggestion needs. */
export interface SaunaDay {
  date: string
  /** Nothing planned and nothing logged that day. */
  isRest: boolean
  /** A session was done that day, or one is still planned for it. */
  trained: boolean
}

/**
 * The dates that get a sauna suggestion: rest days from `fromDate` on, at most
 * `max`, never two in a row, the day after a training day first and earlier
 * days first among equals. A past rest day gets none — a suggestion for a day
 * that is over is noise.
 */
export function saunaDates(days: SaunaDay[], fromDate: string, max = SAUNA_PER_WEEK): Set<string> {
  const byDate = new Map(days.map((day) => [day.date, day]))
  const afterTraining = (date: string): boolean => byDate.get(addDays(date, -1))?.trained ?? false

  const candidates = days
    .filter((day) => day.isRest && day.date >= fromDate)
    .sort((a, b) => {
      const preference = Number(afterTraining(b.date)) - Number(afterTraining(a.date))
      return preference !== 0 ? preference : a.date < b.date ? -1 : a.date > b.date ? 1 : 0
    })

  const picked = new Set<string>()

  for (const day of candidates) {
    if (picked.size >= max) break
    if (picked.has(addDays(day.date, -1)) || picked.has(addDays(day.date, 1))) continue
    picked.add(day.date)
  }

  return picked
}
