/**
 * The rotation: which program day comes next.
 *
 * `Profile.strengthTrack.rotationCursor` is an INDEX, so it means nothing without
 * the list it indexes. That list is the athlete's own program — GZCLP's
 * `A1, B1, A2, B2` is just what the built-in happens to contain, not a law. An
 * athlete who pastes a three-day program cycles three days; one who writes six
 * cycles six.
 *
 * Everything here is a pure function of a day list, so the same helpers serve
 * the planner, the session store and the importer without any of them holding a
 * private copy of the wrap arithmetic.
 */

import type { Program } from '@/liftoscript/types'

/**
 * Every day of the program, in the order the athlete trains them, flattened
 * across weeks: the cursor walks days, not weeks, because a strength session
 * advances by one day whenever it happens.
 *
 * Duplicate names are kept. A program that names two days the same is the
 * athlete's business, and dropping one would silently shorten their cycle.
 */
export function rotationDays(program: Program): string[] {
  return program.weeks.flatMap((week) => week.days.map((day) => day.name))
}

/** Where a day sits in the rotation, or `null` when the program has no such day. */
export function cursorOfDay(days: string[], programDay: string | undefined): number | null {
  if (programDay === undefined) return null

  const index = days.indexOf(programDay)
  return index >= 0 ? index : null
}

/** Wraps into range, so a cursor left behind by a shorter program still resolves. */
function wrap(cursor: number, length: number): number {
  if (length <= 0) return 0

  return ((Math.trunc(cursor) % length) + length) % length
}

/** The day a cursor points at, or `undefined` when the program has no days. */
export function dayAtCursor(days: string[], cursor: number): string | undefined {
  if (days.length === 0) return undefined

  return days[wrap(cursor, days.length)]
}

/** The cursor after one finished strength session. */
export function nextCursor(days: string[], cursor: number): number {
  return wrap(cursor + 1, days.length)
}
