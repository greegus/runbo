/**
 * Domain series → chart input.
 *
 * This is the layer that owns everything `geometry.ts` refuses to do: sorting,
 * dropping non-finite values, collapsing two entries on one day, converting to
 * one unit, and formatting labels. Keeping it here means the hot path stays a
 * hot path and the sort happens exactly once, where a spec can see it.
 *
 * It is also where roles are decided. A role is a story — "this is the number
 * you act on, that one is context" — and it is fixed per chart here so no view
 * can hand a series a colour.
 */

import { convert, format } from '@/liftoscript/weight'
import type { Unit } from '@/liftoscript/weight'
import type { LiftProgressPoint, WeeklySeriesPoint } from '@/training/progressStats'
import type { BodyweightPoint } from '@/training/stats'
import type { WeightValue } from '@/types'
import { daysBetween, parseIso } from '@/utils/date'

import type { BarChartInput, LineChartInput, LineSeriesInput } from './types'

/**
 * A three-month layoff drawn as a straight line claims steady training that
 * never happened. Past this many days the path breaks and both ends keep their
 * marker.
 */
const DEFAULT_MAX_GAP_DAYS = 21

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `3 Jun` — short enough that four of them fit under a 320-unit plot. */
export function shortDate(iso: string): string {
  const date = parseIso(iso)

  return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`
}

/** Plain number, no unit: the unit is named once on the axis, not on every tick. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'

  return String(Math.round(value * 10) / 10)
}

/** Ascending by date, last entry wins a duplicate day. */
function byDate<T extends { date: string }>(entries: T[]): T[] {
  const collapsed = new Map<string, T>()
  for (const entry of entries) collapsed.set(entry.date, entry)

  return [...collapsed.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Indices after which the series has to break. */
function gapAfter(dates: string[], maxGapDays: number): Set<number> {
  const gaps = new Set<number>()
  for (let i = 1; i < dates.length; i++) {
    if (daysBetween(dates[i - 1], dates[i]) > maxGapDays) gaps.add(i - 1)
  }

  return gaps
}

function withGaps(values: Array<{ date: string; value: number }>, gaps: Set<number>): LineSeriesInput['points'] {
  const points: LineSeriesInput['points'] = []
  values.forEach((point, index) => {
    points.push(point)
    if (gaps.has(index)) points.push(null)
  })

  return points
}

export function liftChartInput(
  points: LiftProgressPoint[],
  unit: Unit,
  options?: { maxGapDays?: number },
): LineChartInput {
  const maxGapDays = options?.maxGapDays ?? DEFAULT_MAX_GAP_DAYS

  const clean = byDate(points).filter(
    (point) => Number.isFinite(point.workingWeight.value) && Number.isFinite(point.e1rm.value),
  )
  const dates = clean.map((point) => point.date)
  const gaps = gapAfter(dates, maxGapDays)

  const working = clean.map((point) => ({ date: point.date, value: toUnit(point.workingWeight, unit) }))
  const estimated = clean.map((point) => ({ date: point.date, value: toUnit(point.e1rm, unit) }))

  return {
    // The working weight is the number the athlete loads on the bar, so it
    // carries the emphasis; the estimate is derived and reads quieter.
    series: [
      {
        id: 'working',
        label: 'Working weight',
        role: 'emphasis',
        shape: 'line',
        points: withGaps(working, gaps),
        endLabel: endLabel(working, unit),
      },
      {
        id: 'e1rm',
        label: 'Est. 1RM',
        role: 'context',
        shape: 'line',
        points: withGaps(estimated, gaps),
        endLabel: endLabel(estimated, unit),
      },
    ],
    yUnit: unit,
    // A lift axis from zero squashes every session into the top fifth of the
    // plot; the interesting range is the one the athlete actually lifted in.
    includeZero: false,
    formatValue: formatNumber,
    formatDate: shortDate,
    emptyMessage: 'No sets logged for this lift yet.',
  }
}

export function bodyweightChartInput(
  points: BodyweightPoint[],
  unit: Unit,
  options?: { maxGapDays?: number },
): LineChartInput {
  const maxGapDays = options?.maxGapDays ?? DEFAULT_MAX_GAP_DAYS

  const clean = byDate(points).filter((point) => Number.isFinite(point.weight) && Number.isFinite(point.average))
  const gaps = gapAfter(
    clean.map((point) => point.date),
    maxGapDays,
  )

  const raw = clean.map((point) => ({ date: point.date, value: point.weight }))
  const average = clean.map((point) => ({ date: point.date, value: point.average }))

  return {
    // Raw weigh-ins are noise around a trend: they are dots, never a line, and
    // the rolling average — already computed by `bodyweightTrend` — is the
    // series that gets to make a claim.
    series: [
      { id: 'raw', label: 'Weigh-ins', role: 'context', shape: 'dots', points: withGaps(raw, gaps) },
      {
        id: 'average',
        label: '7-day average',
        role: 'emphasis',
        shape: 'line',
        points: withGaps(average, gaps),
        endLabel: endLabel(average, unit),
      },
    ],
    yUnit: unit,
    includeZero: false,
    formatValue: formatNumber,
    formatDate: shortDate,
    emptyMessage: 'No weigh-ins yet.',
  }
}

/**
 * Weekly cardio minutes against the composed week's target.
 *
 * `doneMinutes` of 0 is a real zero — a week that was planned and missed — and
 * stays a bar of height zero rather than a hole. Weeks the caller has not
 * reached yet simply are not passed in.
 */
export function cardioChartInput(weeks: WeeklySeriesPoint[]): BarChartInput {
  return {
    bars: byDate(weeks.map((week) => ({ ...week, date: week.weekStart }))).map((week) => ({
      key: week.weekStart,
      label: shortDate(week.weekStart),
      value: Number.isFinite(week.doneMinutes) ? week.doneMinutes : null,
      reference: Number.isFinite(week.plannedMinutes) ? week.plannedMinutes : null,
    })),
    formatValue: formatNumber,
    referenceLabel: 'target',
    emptyMessage: 'No cardio logged in the last 12 weeks.',
  }
}

function toUnit(value: WeightValue, unit: Unit): number {
  return convert(value, unit).value
}

function endLabel(points: Array<{ value: number }>, unit: Unit): string | undefined {
  if (points.length === 0) return undefined

  return format({ value: points[points.length - 1].value, unit })
}
