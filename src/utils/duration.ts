/**
 * Duration formatting for the session screens. Pure and clock-free: the caller
 * owns the wall clock, this only turns a number of seconds into digits.
 */

/**
 * `m:ss` for a rest countdown — 180 → '3:00', 65 → '1:05', 9 → '0:09'.
 *
 * Rounds UP, because a countdown that shows '0:00' while a second of rest is
 * still owed reads as a broken timer: the numerals must only reach zero when
 * the rest is genuinely over. Non-finite or negative input is a caller bug
 * mid-set, not a reason to render `NaN:NaN`, so it clamps to '0:00'.
 */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'

  const total = Math.ceil(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60

  return `${minutes}:${String(rest).padStart(2, '0')}`
}
