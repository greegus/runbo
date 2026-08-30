/**
 * The shapes the chart builders produce and the chart components render.
 *
 * `role` is the only colour channel: a series says whether it is the point or
 * the context, and the palette lives in one CSS block in `ChartFigure.vue`. A
 * builder that emitted a hex would hand every future chart its own colour
 * scheme, and runbo has exactly one accent.
 */

import type { Frame } from './geometry'

export type SeriesRole = 'emphasis' | 'context'
export type SeriesShape = 'line' | 'dots'

/**
 * Everything `ChartFigure` needs. Both layouts satisfy it, so the frame
 * component never discriminates on chart kind — one place owns the a11y wiring
 * and the three charts cannot drift apart on it.
 */
export interface ChartFrameLayout {
  isEmpty: boolean
  emptyMessage: string
  /** Line charts always fit; only the bar chart can outgrow the viewport. */
  scrolls: boolean
  frame: Frame
  table: { columns: string[]; rows: string[][] }
  summary: string
}

export interface LegendKey {
  id: string
  label: string
  role: SeriesRole
  shape: SeriesShape | 'bar' | 'reference'
}

export interface LineSeriesInput {
  id: string
  label: string
  role: SeriesRole
  shape: SeriesShape
  /** `null` is a deliberate break in the series, not a missing value. */
  points: Array<{ date: string; value: number } | null>
  /** Preformatted, e.g. `102.5 kg`. */
  endLabel?: string
}

export interface LineChartInput {
  series: LineSeriesInput[]
  yUnit: string
  includeZero?: boolean
  formatValue: (value: number) => string
  formatDate: (iso: string) => string
  emptyMessage: string
}

export interface LineSeriesLayout {
  id: string
  label: string
  role: SeriesRole
  shape: SeriesShape
  path: string
  /**
   * `isolated` marks a point with a break on both sides: `linePath` drops a run
   * of one, so nothing at all would be drawn there unless the renderer puts a
   * dot on it — even on an emphasis line, which is otherwise dotless.
   */
  markers: { x: number; y: number; date: string; value: number; isolated: boolean }[]
  end: { x: number; y: number; label: string } | null
  /** Only when the all-time high is not already the end point. */
  peak: { x: number; y: number; label: string } | null
}

export interface LineChartLayout extends ChartFrameLayout {
  yTicks: { value: number; y: number; label: string }[]
  xTicks: { date: string; x: number; label: string }[]
  series: LineSeriesLayout[]
  legend: LegendKey[]
}

export interface BarChartInput {
  bars: { key: string; label: string; value: number | null; reference: number | null }[]
  formatValue: (value: number) => string
  referenceLabel: string
  emptyMessage: string
}

export interface BarLayout {
  index: number
  key: string
  label: string
  x: number
  y: number
  width: number
  height: number
  value: number | null
  missing: boolean
  isZero: boolean
  /** `roundedBarPath`; `''` when the height is 0. */
  path: string
  labelX: number
  showLabel: boolean
  /** The last bar carrying a real value. */
  endLabel: string | null
}

export interface BarChartLayout extends ChartFrameLayout {
  yTicks: { value: number; y: number; label: string }[]
  bars: BarLayout[]
  reference: { path: string; label: string; labelX: number; labelY: number } | null
  legend: LegendKey[]
}
