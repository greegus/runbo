/**
 * Calendar-day helpers over ISO `YYYY-MM-DD` strings. No date library.
 *
 * All arithmetic runs on UTC-midnight instants: doing it in local time would
 * silently gain or lose an hour across a DST switch and turn `addDays(iso, 1)`
 * into the same day again. Only `toIso` reads local fields, because its job is
 * to answer "which calendar day is this wall-clock moment on for the user".
 */

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

/**
 * Days in a week. Exported so the planner, the stores and the views all measure
 * the same window: five private copies of `7` had drifted apart in meaning —
 * some counted days in a window, some counted weekdays — and only the name says
 * which is which.
 */
export const WEEK_LENGTH = 7

/**
 * Monday-first labels, index-aligned with `weekdayIndexMondayFirst` and with
 * `availability.preferredDays` / `longSessionDay`. Exported because the day
 * picker and the week preview must not each invent their own order — an
 * off-by-one here silently schedules the long session on the wrong day.
 */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

function fromUtc(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** The calendar day a wall-clock `Date` falls on, in the runtime's local zone. */
export function toIso(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** UTC-midnight instant of an ISO day. Throws on malformed or non-existent days. */
export function parseIso(iso: string): Date {
  if (!ISO_PATTERN.test(iso)) {
    throw new Error(`Invalid ISO date: ${iso}`)
  }

  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  // Date.UTC happily rolls 2026-02-30 over into March — reject instead.
  if (fromUtc(date) !== iso) {
    throw new Error(`Invalid ISO date: ${iso}`)
  }

  return date
}

export function addDays(iso: string, days: number): string {
  return fromUtc(new Date(parseIso(iso).getTime() + days * MS_PER_DAY))
}

/** 0 = Monday … 6 = Sunday — the week starts on Monday everywhere in runbo. */
export function weekdayIndexMondayFirst(iso: string): number {
  return (parseIso(iso).getUTCDay() + 6) % 7
}

export function startOfWeekMonday(iso: string): string {
  return addDays(iso, -weekdayIndexMondayFirst(iso))
}

/** Whole days from `isoA` to `isoB`; negative when `isoB` is earlier. */
export function daysBetween(isoA: string, isoB: string): number {
  return Math.round((parseIso(isoB).getTime() - parseIso(isoA).getTime()) / MS_PER_DAY)
}

/**
 * Is `iso` inside the `length`-day window that opens on `startIso`?
 *
 * Offset arithmetic rather than a string comparison against `addDays(start,
 * length)`: the two agree for every well-formed ISO day, but only this one
 * rejects a malformed `iso` loudly instead of silently sorting it lexically
 * into or out of the window. Session dates come off the wire, so the loud
 * version is the one worth keeping.
 */
export function inWeek(iso: string, startIso: string, length: number = WEEK_LENGTH): boolean {
  const offset = daysBetween(startIso, iso)

  return offset >= 0 && offset < length
}

/** Hand-rolled instead of Intl so the output never depends on the host locale. */
export function formatHuman(iso: string): string {
  const date = parseIso(iso)

  return `${WEEKDAY_LABELS[weekdayIndexMondayFirst(iso)]}, ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}
