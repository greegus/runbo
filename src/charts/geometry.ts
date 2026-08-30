/**
 * Chart geometry — plain numbers in, plain numbers out.
 *
 * Nothing here knows what a weight, a session or a week is, and nothing here
 * reads a clock. That is deliberate: the `.vue` files in this app have no test
 * harness, so every number that ends up in the DOM has to be computed in a
 * module a spec can pin. A renderer that does arithmetic is a renderer nobody
 * can check.
 *
 * The awkward cases all live here rather than in three copies at the call
 * sites: an empty series, a single point, a series where every value is
 * identical, a zero next to a missing value. Naive scaling divides by zero on
 * half of those and paints `NaN` into the path, which renders as nothing at all
 * — a chart that silently shows less than the athlete logged.
 *
 * What geometry deliberately does NOT do: sort, de-duplicate or sanitise its
 * input. The adapters own that, and `geometry.spec.ts` asserts the absence, so
 * nobody later drops a sort into a function called once per point.
 */

import { daysBetween } from '@/utils/date'

export interface Point {
  x: number
  y: number
}

export interface Extent {
  min: number
  max: number
}

export interface Padding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface Frame {
  width: number
  height: number
  padding: Padding
  innerWidth: number
  innerHeight: number
  xRange: [number, number]
  /** `[bottom, top]` — inverted, because SVG y grows downward. */
  yRange: [number, number]
  viewBox: string
}

/** viewBox units, not pixels: the SVG scales, the numbers below never change. */
export const CHART_WIDTH = 320
export const CHART_HEIGHT = 180

/**
 * Right padding is the widest of the four because the end-label ("102.5 kg")
 * hangs outside the plot; bottom carries the x-axis band, which a fixed card
 * height would otherwise clip into a nested scrollbar.
 */
export const DEFAULT_PADDING: Padding = { top: 16, right: 44, bottom: 26, left: 34 }

function mergePadding(padding?: Partial<Padding>): Padding {
  return { ...DEFAULT_PADDING, ...padding }
}

function buildFrame(width: number, height: number, padding: Padding): Frame {
  const innerWidth = Math.max(0, width - padding.left - padding.right)
  const innerHeight = Math.max(0, height - padding.top - padding.bottom)

  return {
    width,
    height,
    padding,
    innerWidth,
    innerHeight,
    xRange: [padding.left, padding.left + innerWidth],
    yRange: [padding.top + innerHeight, padding.top],
    viewBox: `0 0 ${width} ${height}`,
  }
}

/** Frame at an explicit width, never narrower than `CHART_WIDTH`. */
export function frame(options?: { width?: number; height?: number; padding?: Partial<Padding> }): Frame {
  const padding = mergePadding(options?.padding)

  return buildFrame(Math.max(CHART_WIDTH, options?.width ?? CHART_WIDTH), options?.height ?? CHART_HEIGHT, padding)
}

/**
 * Frame wide enough for `count` bands. This is what makes the bar chart scroll
 * sideways inside its own container instead of squashing twelve weeks into
 * hairlines — a squashed bar is not a smaller bar, it is an unreadable one.
 */
export function bandFrame(
  count: number,
  options?: { bandWidth?: number; height?: number; padding?: Partial<Padding> },
): Frame {
  const padding = mergePadding(options?.padding)
  const bandWidth = options?.bandWidth ?? 32
  const needed = padding.left + padding.right + Math.max(0, count) * bandWidth

  return buildFrame(Math.max(CHART_WIDTH, needed), options?.height ?? CHART_HEIGHT, padding)
}

/** `null` for an empty list. Non-finite values are ignored, never propagated. */
export function extent(values: number[]): Extent | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let seen = false

  for (const value of values) {
    if (!Number.isFinite(value)) continue
    seen = true
    if (value < min) min = value
    if (value > max) max = value
  }

  return seen ? { min, max } : null
}

/**
 * The y-domain rule, and the home of the two cases that break naive scaling.
 *
 * `includeZero` is a per-chart decision, not a default: bars are quantities and
 * must start at zero, but a bodyweight axis from zero flattens the only signal
 * there is.
 */
export function paddedExtent(
  values: number[],
  options?: { includeZero?: boolean; padRatio?: number; minSpan?: number; fallbackSpan?: number },
): Extent {
  const includeZero = options?.includeZero ?? false
  const padRatio = options?.padRatio ?? 0.08
  const minSpan = options?.minSpan ?? 1
  const fallbackSpan = options?.fallbackSpan ?? 1

  const raw = extent(values)
  if (raw === null) return { min: 0, max: fallbackSpan }

  let { min, max } = raw

  if (max - min === 0) {
    // Every value identical. A zero-height range makes the line vanish and the
    // tick generator loop, so it is opened symmetrically around the value.
    const half = Math.max(minSpan / 2, Math.abs(min) * 0.02, 0.5)
    min -= half
    max += half
  } else {
    const pad = (max - min) * padRatio
    min -= pad
    max += pad
  }

  if (includeZero) {
    // The baseline sits exactly on zero rather than on a padded negative:
    // "minus eight minutes of cardio" is not a quantity, and a bar hanging
    // below the axis would be the chart inventing one.
    min = raw.min >= 0 ? 0 : Math.min(min, 0)
    if (max <= 0) max = fallbackSpan
  }

  return { min, max }
}

// 2.5 is in the family on purpose: without it a span of ~97 with a hint of 3
// jumps straight to a step of 50 and the axis carries two ticks.
const TICK_STEPS = [1, 2, 2.5, 5, 10]

function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1

  const exponent = Math.floor(Math.log10(rough))
  const magnitude = Math.pow(10, exponent)
  const fraction = rough / magnitude

  // Nearest in log space, so 3.2 picks 2.5 rather than rounding up to 5 and
  // halving the tick count.
  let best = TICK_STEPS[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of TICK_STEPS) {
    const distance = Math.abs(Math.log(fraction / candidate))
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }

  return best * magnitude
}

/**
 * 1 / 2 / 2.5 / 5 × 10^k ticks inside `domain`. `count` is a hint, not a
 * promise: the values are chosen for readability at arm's length, and a
 * rounder number with one tick fewer wins.
 */
export function niceTicks(domain: Extent, count: number = 3): number[] {
  const span = domain.max - domain.min
  if (!Number.isFinite(span) || span <= 0) return [domain.min]

  const step = niceStep(span / Math.max(1, count))
  const first = Math.ceil(roundTo(domain.min / step, 6)) * step

  const ticks: number[] = []
  for (let value = first; value <= domain.max + step * 1e-9; value += step) {
    ticks.push(roundTo(value, 6))
    if (ticks.length > 40) break // step underflow guard; never reached in practice
  }

  return ticks.length > 0 ? ticks : [domain.min]
}

/**
 * Linear map. A zero-span domain maps EVERY input to the midpoint of `range` —
 * never `NaN`, never `Infinity`. This one guard covers "all values equal" and
 * "exactly one point" for both axes, which is why neither case needs a branch
 * anywhere above.
 */
export function linearScale(domain: Extent, range: [number, number]): (value: number) => number {
  const span = domain.max - domain.min
  const midpoint = (range[0] + range[1]) / 2

  if (!Number.isFinite(span) || span === 0) return () => midpoint

  const scale = (range[1] - range[0]) / span

  return (value: number) => {
    if (!Number.isFinite(value)) return midpoint
    return range[0] + (value - domain.min) * scale
  }
}

/**
 * x positions for an ISO-day series, **linear in real time, not in index**.
 * Three sessions on the 1st, the 8th and the 29th sit 7 and 21 days apart, and
 * the chart has to say so: index-linear spacing would draw a three-week layoff
 * as one more even step and turn a comeback into steady training.
 *
 * Throws on a malformed ISO day, loudly, the way `parseIso` does.
 */
export function dayScale(
  dates: string[],
  range: [number, number],
): { x: (iso: string) => number; first: string | null; last: string | null; spanDays: number } {
  const midpoint = (range[0] + range[1]) / 2

  if (dates.length === 0) {
    return { x: () => midpoint, first: null, last: null, spanDays: 0 }
  }

  const first = dates[0]
  const last = dates[dates.length - 1]
  const spanDays = daysBetween(first, last)
  const scale = linearScale({ min: 0, max: spanDays }, range)

  return { x: (iso: string) => scale(daysBetween(first, iso)), first, last, spanDays }
}

/**
 * Band layout for the bar chart. `barWidth` is capped so a two-week chart does
 * not render two 120-unit slabs.
 */
export function bandScale(
  count: number,
  range: [number, number],
  options?: { maxBarWidth?: number; gap?: number },
): { bandWidth: number; barWidth: number; center: (index: number) => number; start: (index: number) => number } {
  const maxBarWidth = options?.maxBarWidth ?? 24
  const gap = options?.gap ?? 2
  const width = range[1] - range[0]
  const bandWidth = count > 0 ? width / count : 0
  const barWidth = count > 0 ? Math.max(1, Math.min(bandWidth - gap, maxBarWidth)) : 0

  return {
    bandWidth,
    barWidth,
    start: (index: number) => range[0] + index * bandWidth,
    center: (index: number) => range[0] + index * bandWidth + bandWidth / 2,
  }
}

/**
 * `M x y L x y …`, rounded to 2 decimals so a spec can assert the exact string.
 *
 * A `null` ends the current sub-path and the next value starts a new `M`; a run
 * of one point between two nulls emits nothing, because a one-point line is
 * invisible and the caller draws a marker there anyway.
 */
export function linePath(points: Array<Point | null>): string {
  const runs: Point[][] = []
  let current: Point[] = []

  for (const point of points) {
    if (point === null) {
      if (current.length > 0) runs.push(current)
      current = []
      continue
    }
    current.push(point)
  }
  if (current.length > 0) runs.push(current)

  return runs
    .filter((run) => run.length >= 2)
    .map((run) => run.map((p, i) => `${i === 0 ? 'M' : 'L'} ${roundTo(p.x)} ${roundTo(p.y)}`).join(' '))
    .join(' ')
}

export interface BarRect {
  index: number
  x: number
  y: number
  width: number
  height: number
  value: number | null
  missing: boolean
  isZero: boolean
}

/**
 * Rects from a baseline.
 *
 * `null` → `missing`, and the renderer draws nothing. `0` → `isZero`, and the
 * renderer draws a 2px stub. That distinction is the whole point of this
 * function: "no cardio logged that week" and "that week has not happened yet"
 * must not look the same, and both have height 0.
 */
export function barRects(
  values: Array<number | null>,
  y: (value: number) => number,
  band: ReturnType<typeof bandScale>,
  options?: { baseline?: number },
): BarRect[] {
  const baseline = options?.baseline ?? y(0)

  return values.map((value, index) => {
    const x = band.center(index) - band.barWidth / 2

    if (value === null || !Number.isFinite(value)) {
      return { index, x, y: baseline, width: band.barWidth, height: 0, value: null, missing: true, isZero: false }
    }

    const top = y(value)
    const height = Math.abs(baseline - top)

    return {
      index,
      x,
      y: Math.min(baseline, top),
      width: band.barWidth,
      height,
      value,
      missing: false,
      isZero: value === 0,
    }
  })
}

/** Top-rounded, square at the baseline. `height 0` → `''`. */
export function roundedBarPath(
  rect: { x: number; y: number; width: number; height: number },
  radius: number = 4,
): string {
  const { x, y, width, height } = rect
  if (height <= 0 || width <= 0) return ''

  const r = Math.max(0, Math.min(radius, width / 2, height))
  const right = x + width
  const bottom = y + height

  if (r === 0) {
    return `M ${roundTo(x)} ${roundTo(y)} L ${roundTo(right)} ${roundTo(y)} L ${roundTo(right)} ${roundTo(bottom)} L ${roundTo(x)} ${roundTo(bottom)} Z`
  }

  return [
    `M ${roundTo(x)} ${roundTo(bottom)}`,
    `L ${roundTo(x)} ${roundTo(y + r)}`,
    `A ${roundTo(r)} ${roundTo(r)} 0 0 1 ${roundTo(x + r)} ${roundTo(y)}`,
    `L ${roundTo(right - r)} ${roundTo(y)}`,
    `A ${roundTo(r)} ${roundTo(r)} 0 0 1 ${roundTo(right)} ${roundTo(y + r)}`,
    `L ${roundTo(right)} ${roundTo(bottom)}`,
    'Z',
  ].join(' ')
}

/**
 * Step path for a per-period reference value (the cardio target).
 *
 * A target that changes week to week is drawn as a step, not as a single
 * horizontal rule: averaging it into one line would claim a threshold the
 * athlete was never actually held to. Equal consecutive values produce one
 * straight run, so a stable target still reads as a stable target.
 */
export function stepPath(
  values: Array<number | null>,
  y: (value: number) => number,
  band: ReturnType<typeof bandScale>,
): string {
  interface Run {
    startX: number
    endX: number
    y: number
    startIndex: number
    endIndex: number
  }

  const runs: Run[] = []

  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) return

    const at = y(value)
    const startX = band.start(index)
    const endX = startX + band.bandWidth
    const previous = runs[runs.length - 1]

    if (previous && previous.endIndex === index - 1 && roundTo(previous.y) === roundTo(at)) {
      previous.endX = endX
      previous.endIndex = index
      return
    }

    runs.push({ startX, endX, y: at, startIndex: index, endIndex: index })
  })

  let path = ''
  runs.forEach((run, i) => {
    const previous = runs[i - 1]
    const contiguous = previous !== undefined && previous.endIndex === run.startIndex - 1

    // Contiguous runs stay in one sub-path so the vertical riser is drawn; a
    // gap starts a new `M`, because there was no target in between.
    path += `${path === '' ? '' : ' '}${contiguous ? 'L' : 'M'} ${roundTo(run.startX)} ${roundTo(run.y)}`
    path += ` L ${roundTo(run.endX)} ${roundTo(run.y)}`
  })

  return path
}

/**
 * At most `max` indices, always including the first and the last, evenly
 * spaced. Twelve x labels on a 320-unit chart collide into a smear; five do
 * not, and the rest of the dates live in the numbers table.
 */
export function pickLabelIndices(count: number, max: number = 5): number[] {
  if (count <= 0) return []
  if (count === 1) return [0]
  if (count <= max) return Array.from({ length: count }, (_, index) => index)

  const picked = new Set<number>([0, count - 1])
  const steps = Math.max(1, max - 1)
  for (let i = 1; i < steps; i++) {
    picked.add(Math.round((i * (count - 1)) / steps))
  }

  return [...picked].sort((a, b) => a - b)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function roundTo(value: number, decimals: number = 2): number {
  if (!Number.isFinite(value)) return value
  const factor = Math.pow(10, decimals)

  return Math.round(value * factor) / factor
}
