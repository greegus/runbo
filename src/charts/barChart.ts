/**
 * `BarChartInput` → `BarChartLayout`.
 *
 * One series of columns plus a reference step. Planned-versus-done as two bars
 * per week is a grouped bar chart restating a single ratio; the target is a
 * threshold, and a threshold is a rule across the plot, not a rival column.
 */

import {
  bandFrame,
  bandScale,
  barRects,
  CHART_WIDTH,
  linearScale,
  niceTicks,
  paddedExtent,
  pickLabelIndices,
  roundTo,
  roundedBarPath,
  stepPath,
} from './geometry'
import type { BarChartInput, BarChartLayout, BarLayout, LegendKey } from './types'

const MAX_BAR_LABELS = 6

function emptyLayout(input: BarChartInput): BarChartLayout {
  return {
    isEmpty: true,
    emptyMessage: input.emptyMessage,
    scrolls: false,
    frame: bandFrame(0),
    yTicks: [],
    bars: [],
    reference: null,
    legend: [],
    table: { columns: [], rows: [] },
    summary: input.emptyMessage,
  }
}

export function buildBarChart(input: BarChartInput): BarChartLayout {
  const hasValue = input.bars.some((bar) => bar.value !== null && Number.isFinite(bar.value))
  if (input.bars.length === 0 || !hasValue) return emptyLayout(input)

  const frame = bandFrame(input.bars.length)
  const band = bandScale(input.bars.length, frame.xRange)

  // The reference belongs in the domain: a target above every bar that fell
  // off the top of the plot would read as no target at all.
  const values = input.bars.flatMap((bar) => [bar.value, bar.reference]).filter((v): v is number => v !== null)
  const domain = paddedExtent(values, { includeZero: true })
  const y = linearScale(domain, frame.yRange)

  const yTicks = niceTicks(domain).map((value) => ({
    value,
    y: roundTo(y(value)),
    label: input.formatValue(value),
  }))

  const rects = barRects(
    input.bars.map((bar) => bar.value),
    y,
    band,
  )

  const labelled = new Set(pickLabelIndices(input.bars.length, MAX_BAR_LABELS))
  const lastRealIndex = rects.reduce((last, rect) => (rect.missing ? last : rect.index), -1)

  const bars: BarLayout[] = rects.map((rect) => {
    const source = input.bars[rect.index]

    return {
      index: rect.index,
      key: source.key,
      label: source.label,
      x: roundTo(rect.x),
      y: roundTo(rect.y),
      width: roundTo(rect.width),
      height: roundTo(rect.height),
      value: rect.value,
      missing: rect.missing,
      isZero: rect.isZero,
      path: roundedBarPath(rect),
      labelX: roundTo(band.center(rect.index)),
      showLabel: labelled.has(rect.index),
      endLabel: rect.index === lastRealIndex && rect.value !== null ? input.formatValue(rect.value) : null,
    }
  })

  const references = input.bars.map((bar) => bar.reference)
  const lastReference = [...references].reverse().find((value): value is number => value !== null) ?? null
  const reference =
    lastReference === null
      ? null
      : {
          path: stepPath(references, y, band),
          label: `${input.referenceLabel} ${input.formatValue(lastReference)}`,
          labelX: roundTo(frame.xRange[1]),
          labelY: roundTo(y(lastReference)),
        }

  const legend: LegendKey[] = reference
    ? [
        { id: 'value', label: 'Logged', role: 'emphasis', shape: 'bar' },
        { id: 'reference', label: input.referenceLabel, role: 'context', shape: 'reference' },
      ]
    : []

  const columns = ['Period', 'Logged', capitalise(input.referenceLabel)]
  const rows = input.bars.map((bar) => [
    bar.label,
    // A logged zero and a week that has not happened yet are different facts,
    // and the table has to keep them different too.
    bar.value === null ? '—' : input.formatValue(bar.value),
    bar.reference === null ? '—' : input.formatValue(bar.reference),
  ])

  return {
    isEmpty: false,
    emptyMessage: input.emptyMessage,
    scrolls: frame.width > CHART_WIDTH,
    frame,
    yTicks,
    bars,
    reference,
    legend,
    table: { columns, rows },
    summary: buildSummary(input, lastRealIndex),
  }
}

function capitalise(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`
}

function buildSummary(input: BarChartInput, lastRealIndex: number): string {
  const first = input.bars[0]
  const last = input.bars[input.bars.length - 1]
  const span = `${input.bars.length} ${input.bars.length === 1 ? 'period' : 'periods'} from ${first.label} to ${last.label}`

  const latest = lastRealIndex >= 0 ? input.bars[lastRealIndex] : null
  if (latest === null || latest.value === null) return `${span}.`

  const firstReal = input.bars.find((bar) => bar.value !== null && Number.isFinite(bar.value)) ?? null
  const value = `${latest.label} ${input.formatValue(latest.value)}`

  if (firstReal === null || firstReal === latest || firstReal.value === null) return `${span}. ${value}.`

  const delta = latest.value - firstReal.value
  if (delta === 0) return `${span}. ${value}, unchanged.`

  return `${span}. ${value}, ${delta > 0 ? 'up' : 'down'} ${input.formatValue(Math.abs(delta))}.`
}
