/**
 * `LineChartInput` → `LineChartLayout`. Every coordinate the renderer will put
 * in the DOM is produced here, so the untestable half of a chart is also the
 * trivial half.
 */

import {
  dayScale,
  frame as buildFrame,
  linePath,
  linearScale,
  niceTicks,
  paddedExtent,
  pickLabelIndices,
  roundTo,
} from './geometry'
import type { LegendKey, LineChartInput, LineChartLayout, LineSeriesLayout } from './types'

const MAX_X_LABELS = 4

/**
 * Minimum horizontal distance between two x labels, in viewBox units. `3 Jun`
 * at font-size 11 is roughly 30 units wide and centred on its tick.
 */
const MIN_X_LABEL_GAP = 34

function emptyLayout(input: LineChartInput): LineChartLayout {
  // No invented ticks: a frame with an axis and no data is a lie about having
  // data. The component renders the message instead.
  return {
    isEmpty: true,
    emptyMessage: input.emptyMessage,
    scrolls: false,
    frame: buildFrame(),
    yTicks: [],
    xTicks: [],
    series: [],
    legend: [],
    table: { columns: [], rows: [] },
    summary: input.emptyMessage,
  }
}

export function buildLineChart(input: LineChartInput): LineChartLayout {
  const drawn = input.series.flatMap((series) =>
    series.points.filter(
      (point): point is { date: string; value: number } => point !== null && Number.isFinite(point.value),
    ),
  )

  if (drawn.length === 0) return emptyLayout(input)

  const frame = buildFrame()

  // Every series shares one x scale built from every date any of them carries,
  // otherwise two series on the same chart would sit on two different calendars.
  const dates = [...new Set(drawn.map((point) => point.date))].sort()
  const x = dayScale(dates, frame.xRange)

  const domain = paddedExtent(
    drawn.map((point) => point.value),
    { includeZero: input.includeZero ?? false },
  )
  const y = linearScale(domain, frame.yRange)

  const yTicks = niceTicks(domain).map((value) => ({
    value,
    y: roundTo(y(value)),
    label: input.formatValue(value),
  }))

  // Labels are picked evenly by INDEX but placed by TIME, so a cluster of three
  // days followed by a seven-month gap would stack three dates inside two units
  // of each other. Spacing is therefore enforced in x, not in index, and the
  // last date always survives — it is the one the athlete came for.
  const candidates = pickLabelIndices(dates.length, MAX_X_LABELS).map((index) => ({
    date: dates[index],
    x: roundTo(x.x(dates[index])),
    label: input.formatDate(dates[index]),
  }))

  const xTicks: typeof candidates = []
  candidates.forEach((candidate, index) => {
    const kept = xTicks[xTicks.length - 1]
    const isLast = index === candidates.length - 1

    if (kept === undefined || candidate.x - kept.x >= MIN_X_LABEL_GAP) {
      xTicks.push(candidate)
      return
    }

    // The endpoint outranks a middle label it would collide with. Nothing else
    // is lost: every date is in the numbers table.
    if (isLast && xTicks.length > 1) xTicks[xTicks.length - 1] = candidate
    else if (isLast) xTicks.push(candidate)
  })

  const series: LineSeriesLayout[] = input.series.map((input_series) => {
    const points = input_series.points.map((point) =>
      point === null || !Number.isFinite(point.value)
        ? null
        : { x: roundTo(x.x(point.date)), y: roundTo(y(point.value)), date: point.date, value: point.value },
    )
    // A point with no neighbour on either side sits in no sub-path at all —
    // `linePath` drops runs of one — so the renderer has to be told to put a dot
    // on it, or a session either side of a layoff draws as nothing.
    const isolated = new Set<number>()
    points.forEach((point, index) => {
      if (point === null) return
      const before = index > 0 ? points[index - 1] : null
      const after = index < points.length - 1 ? points[index + 1] : null
      if (before === null && after === null) isolated.add(index)
    })

    const markers = points.flatMap((point, index) =>
      point === null
        ? []
        : [{ x: point.x, y: point.y, date: point.date, value: point.value, isolated: isolated.has(index) }],
    )

    type Marker = { x: number; y: number; date: string; value: number; isolated: boolean }

    const last: Marker | null = markers[markers.length - 1] ?? null
    // Direct labels are for the endpoint and the extreme only. Labelling every
    // point is how a 320-unit chart turns into a wall of overlapping numbers.
    const highest = markers.reduce<Marker | null>(
      (best, point) => (best === null || point.value > best.value ? point : best),
      null,
    )

    return {
      id: input_series.id,
      label: input_series.label,
      role: input_series.role,
      shape: input_series.shape,
      // Dots are noisy daily readings, not a trend — connecting them would
      // claim a continuity the numbers do not have.
      path: input_series.shape === 'dots' ? '' : linePath(points),
      markers,
      end:
        last === null ? null : { x: last.x, y: last.y, label: input_series.endLabel ?? input.formatValue(last.value) },
      peak:
        highest === null || last === null || highest.date === last.date
          ? null
          : { x: highest.x, y: highest.y, label: input.formatValue(highest.value) },
    }
  })

  const unitSuffix = input.yUnit ? ` (${input.yUnit})` : ''
  const columns = ['Date', ...input.series.map((s) => `${s.label}${unitSuffix}`)]
  const rows = dates.map((date) => [
    input.formatDate(date),
    ...input.series.map((s) => {
      const point = s.points.find((candidate) => candidate !== null && candidate.date === date)

      return point ? input.formatValue(point.value) : '—'
    }),
  ])

  const legend: LegendKey[] =
    input.series.length > 1 ? input.series.map((s) => ({ id: s.id, label: s.label, role: s.role, shape: s.shape })) : []

  return {
    isEmpty: false,
    emptyMessage: input.emptyMessage,
    scrolls: false,
    frame,
    yTicks,
    xTicks,
    series,
    legend,
    table: { columns, rows },
    summary: buildSummary(input, series, dates),
  }
}

/**
 * The `<desc>` sentence, and the only thing a screen reader hears before the
 * numbers table. It names the span, the latest value and the change, because
 * "a line chart" tells a blind athlete nothing they did not already assume.
 */
function buildSummary(input: LineChartInput, series: LineSeriesLayout[], dates: string[]): string {
  const primary = series.find((s) => s.role === 'emphasis' && s.markers.length > 0) ?? series[0]
  const markers = primary?.markers ?? []
  const first = markers[0]
  const last = markers[markers.length - 1]

  const span = `${dates.length} ${dates.length === 1 ? 'day' : 'days'} from ${input.formatDate(dates[0])} to ${input.formatDate(dates[dates.length - 1])}`

  if (!primary || !first || !last) return `${span}.`

  const unit = input.yUnit ? ` ${input.yUnit}` : ''
  const latest = `${primary.label} ${input.formatValue(last.value)}${unit}`

  if (first.date === last.date) return `${span}. ${latest}.`

  const delta = last.value - first.value
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'unchanged'

  if (delta === 0) return `${span}. ${latest}, unchanged.`

  return `${span}. ${latest}, ${direction} ${input.formatValue(Math.abs(delta))}${unit}.`
}
