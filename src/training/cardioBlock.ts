/**
 * The training block: the seven-day window the cardio mesocycle actually walks
 * through, and the one decision that moves it.
 *
 * A block is NOT a calendar week. The calendar week is still where availability
 * lives — "I train Monday, Wednesday, Friday" is a fact about the athlete's
 * life — but the mesocycle must not advance because a Sunday went by. A block
 * ends when seven days of it have passed AND something was trained in it;
 * otherwise it is re-anchored onto the window we are actually in, leaving the
 * mesocycle exactly where the athlete left it. Time alone can never push anyone
 * into a deload.
 *
 * The gate is ANY completed session, not a cardio one. An athlete who lifted
 * three times and skipped every run genuinely missed their cardio, and the
 * volume SHOULD hold. An athlete who did nothing at all has not failed a week —
 * they were away, and `comeback.ts` owns long absences. Today those two
 * mechanisms fight over the same event: the mesocycle quietly steps the
 * baseline back 10 % while the comeback card offers 70 %.
 *
 * Pure, and date-free in the sense the house rules mean it: `todayIso` comes in
 * from the caller, so a whole block can be replayed for any day in a test.
 */

import type { Profile, Session } from '@/types'
import { addDays, daysBetween, startOfWeekMonday } from '@/utils/date'

import { cardioCompletionRatio } from './stats'

/** Days in a block. Deliberately its own constant: this is not a week length. */
export const BLOCK_LENGTH = 7

/**
 * A block is anchored on the MONDAY of the week its first session fell in, not
 * on the session's own date.
 *
 * The progress gate above is what stops time from advancing the mesocycle;
 * given that, a Monday anchor buys the same behaviour without splitting the
 * athlete's week across two blocks — a Saturday long run and the Monday after
 * it belong to the same window, whichever day the athlete happened to start on.
 */
export const blockAnchorOf = startOfWeekMonday

type CardioTrack = Profile['cardioTrack']

export type CardioBlockAction =
  /** Nothing to persist: the block is still running, or has not begun. */
  | { kind: 'idle' }
  /** The first session ever — open a block on the week it fell in. */
  | { kind: 'start'; from: null; to: string }
  /** Nothing was trained in the window that ended: re-anchor, change nothing else. */
  | { kind: 'skip'; from: string; to: string }
  /** The window that ended was trained in: persist the plan it ran and open the next. */
  | { kind: 'advance'; from: string; to: string; ratio: number }

/**
 * The start of the block the stored state describes, or `null` when no block
 * has ever been opened.
 *
 * `blockStartDate` is the field; the fallback is the derivation the profile
 * store used to do inline (`mesoStartDate` is block 1's Monday and `mesoWeek`
 * counts from there), so a profile written before the field existed translates
 * losslessly and needs no migration. The first write of `cardioTrack` stores
 * `blockStartDate` and the legacy branch never runs for that profile again.
 */
export function blockWindowStart(cardioTrack: CardioTrack): string | null {
  if (cardioTrack.blockStartDate) return cardioTrack.blockStartDate
  if (!cardioTrack.mesoStartDate) return null

  return addDays(cardioTrack.mesoStartDate, BLOCK_LENGTH * (Math.max(1, cardioTrack.mesoWeek) - 1))
}

function isDone(session: Session): boolean {
  return session.status === 'done'
}

/** Was anything at all — strength or cardio — completed inside this window? */
function trainedIn(sessions: Session[], windowStart: string): boolean {
  const end = addDays(windowStart, BLOCK_LENGTH)

  return sessions.some((session) => isDone(session) && session.date >= windowStart && session.date < end)
}

function firstCompletedDate(sessions: Session[], todayIso: string): string | null {
  let earliest: string | null = null

  for (const session of sessions) {
    if (!isDone(session) || session.date > todayIso) continue
    if (earliest === null || session.date < earliest) earliest = session.date
  }

  return earliest
}

/**
 * How the block BEFORE the current one went, as `planCardioWeek`'s adaptive
 * input.
 *
 * Anchored on the stored block and not on the day being planned, which is what
 * makes the cardio plan independent of `anchorIso`: asking for next week used to
 * measure THIS — partially logged — week, score it under 70 % and hand back a
 * held plan for a week that has not happened yet.
 *
 * Two windows count as fully done rather than missed:
 *
 * - nothing was ever logged before the block: the adaptive hold exists for
 *   someone who trained and fell short, not for a brand-new profile;
 * - the previous window holds no session of any kind. That is an absence, not a
 *   failed week — the same call that returns `skip` refuses to move the block
 *   for it, and scoring it as a miss here is exactly the double punishment
 *   (hold, then a 10 % step back, on top of the comeback's 70 %) this module
 *   exists to end.
 *
 * The divisor is `lastPlannedMinutes` — what that window was actually
 * prescribed — and NOT the baseline: a deload prescribes 60 % of the baseline,
 * so measuring a completed deload against the baseline would score it at ~0.5
 * and hold the block after it for no reason.
 */
export function blockRatio(cardioTrack: CardioTrack, sessions: Session[]): number {
  const start = blockWindowStart(cardioTrack)
  if (start === null) return 1

  const previous = addDays(start, -BLOCK_LENGTH)
  const hasHistory = sessions.some((session) => isDone(session) && session.date < start)
  if (!hasHistory || !trainedIn(sessions, previous)) return 1

  return cardioCompletionRatio(sessions, previous, cardioTrack.lastPlannedMinutes || cardioTrack.weeklyMinutes)
}

/**
 * What the stored block owes reality on `todayIso` — the whole rollover rule in
 * one pure function, so the store only has to decide WHEN it is safe to write.
 *
 * A long absence produces exactly ONE `skip`, whatever its length: the window is
 * re-anchored onto the one we are in now rather than stepped through the weeks
 * that were missed, so three months away is a single write and the athlete comes
 * back to the same mesocycle week they left.
 *
 * Applying the action and asking again yields `idle` — that idempotence is what
 * lets a second tab, a reload or a duplicated snapshot re-run this safely.
 */
export function cardioBlockAction(cardioTrack: CardioTrack, sessions: Session[], todayIso: string): CardioBlockAction {
  const start = blockWindowStart(cardioTrack)

  if (start === null) {
    const first = firstCompletedDate(sessions, todayIso)

    return first === null ? { kind: 'idle' } : { kind: 'start', from: null, to: blockAnchorOf(first) }
  }

  // Negative when the stored block is somehow in the future — a clock that went
  // backwards, an imported document. Nothing to do either way.
  const elapsed = daysBetween(start, todayIso)
  if (elapsed < BLOCK_LENGTH) return { kind: 'idle' }

  if (!trainedIn(sessions, start)) {
    return { kind: 'skip', from: start, to: addDays(start, BLOCK_LENGTH * Math.floor(elapsed / BLOCK_LENGTH)) }
  }

  return {
    kind: 'advance',
    from: start,
    to: addDays(start, BLOCK_LENGTH),
    // The ratio the block that is ending was PLANNED from, not its own
    // completion: the write persists the plan that was in force during it, and
    // that plan read the window before it. The block's own completion becomes
    // this same number one window later, once the anchor has moved.
    ratio: blockRatio(cardioTrack, sessions),
  }
}
