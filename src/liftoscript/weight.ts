/**
 * The `Weight` value type and every arithmetic operation the engine needs.
 *
 * Domain code never passes bare numbers around: a number without a unit cannot
 * be rounded onto a barbell, compared against another profile's log, or printed.
 * Mixed-unit operations always convert to the LEFT operand's unit, so the unit
 * of a result is predictable from the expression alone.
 */

import type { EvalContext } from './types'

export type Unit = 'kg' | 'lb'

/** A weight with its unit. The only weight representation in domain code. */
export interface Weight {
  value: number
  unit: Unit
}

/** A percentage literal (`85%`) — resolved against a base weight by `applyPercent`. */
export interface Percent {
  value: number // 85 means 85 %
  unit: '%'
}

/** One plate size in the user's inventory. `count` is how many are available PER SIDE. */
export interface Plate {
  weight: number // in the profile's units
  count: number
}

/** Exact-enough conversion factor; Liftosaur uses the same constant. */
export const LB_PER_KG = 2.20462262

/** Fallback loadable step when the plate inventory is empty. */
export const DEFAULT_STEP: Record<Unit, number> = { kg: 2.5, lb: 5 }

// Weights are multiples of 1.25 kg in practice, so float noise from repeated
// conversions is the only source of inequality we ever see.
const EPSILON = 1e-6

/** Kills accumulated float noise (`0.1 + 0.2`) without changing real precision. */
function normalize(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/** Constructs a weight. */
export function weight(value: number, unit: Unit): Weight {
  return { value: normalize(value), unit }
}

/** Constructs a percentage value (`percent(85)` === `85%`). */
export function percent(value: number): Percent {
  return { value: normalize(value), unit: '%' }
}

export function isWeight(value: unknown): value is Weight {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Weight>
  return typeof candidate.value === 'number' && (candidate.unit === 'kg' || candidate.unit === 'lb')
}

export function isPercent(value: unknown): value is Percent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Percent>
  return typeof candidate.value === 'number' && candidate.unit === '%'
}

/** Converts to `unit`; a no-op when the weight is already in that unit. */
export function convert(w: Weight, unit: Unit): Weight {
  if (w.unit === unit) return { ...w }
  return weight(unit === 'lb' ? w.value * LB_PER_KG : w.value / LB_PER_KG, unit)
}

/** Sum, in the unit of `a`. */
export function add(a: Weight, b: Weight): Weight {
  return weight(a.value + convert(b, a.unit).value, a.unit)
}

/** Difference, in the unit of `a`. */
export function subtract(a: Weight, b: Weight): Weight {
  return weight(a.value - convert(b, a.unit).value, a.unit)
}

/** Scales a weight by a plain number. */
export function multiply(w: Weight, scalar: number): Weight {
  return weight(w.value * scalar, w.unit)
}

/** Divides a weight by a plain number. */
export function divide(w: Weight, scalar: number): Weight {
  if (scalar === 0) throw new Error('division by zero')
  return weight(w.value / scalar, w.unit)
}

/** Dimensionless ratio `a / b`, e.g. for `completedWeights[1] / weights[1]`. */
export function ratio(a: Weight, b: Weight): number {
  const divisor = convert(b, a.unit).value
  if (divisor === 0) throw new Error('division by zero')
  return normalize(a.value / divisor)
}

/** Applies a percentage to a base weight: `applyPercent(100kg, 85%) === 85kg`. */
export function applyPercent(base: Weight, p: Percent): Weight {
  return multiply(base, p.value / 100)
}

/** `-1 | 0 | 1`, comparing `b` in the unit of `a`. */
export function compare(a: Weight, b: Weight): -1 | 0 | 1 {
  const difference = a.value - convert(b, a.unit).value
  if (Math.abs(difference) < EPSILON) return 0
  return difference < 0 ? -1 : 1
}

export function equals(a: Weight, b: Weight): boolean {
  return compare(a, b) === 0
}

/** Display form: `102.5 kg`, `100 kg` (no trailing zeros). */
export function format(w: Weight): string {
  const rounded = Math.round(w.value * 100) / 100
  return `${String(rounded)} ${w.unit}`
}

/** Rounds to the nearest multiple of `step` (in the weight's own unit). */
export function roundToStep(w: Weight, step: number): Weight {
  if (step <= 0) return { ...w }
  return weight(Math.round(w.value / step) * step, w.unit)
}

/**
 * Smallest weight change a barbell can actually take: two of the smallest plate,
 * one per side. Falls back to 2.5 kg / 5 lb when no plates are configured.
 */
export function smallestStep(plates: Plate[], unit: Unit = 'kg'): number {
  const usable = plates.filter((plate) => plate.weight > 0 && plate.count > 0)
  if (usable.length === 0) return DEFAULT_STEP[unit]
  return normalize(2 * Math.min(...usable.map((plate) => plate.weight)))
}

// Enumerating every loadable per-side sum is cheap because duplicate sums
// collapse at each step, and it is exact where a "round to the smallest step"
// approximation would happily prescribe a weight the user cannot load.
const sumsCache = new Map<string, number[]>()

function loadableSums(plates: Plate[]): number[] {
  const usable = plates.filter((plate) => plate.weight > 0 && plate.count > 0)
  const key = usable.map((plate) => `${plate.weight}x${plate.count}`).join('|')
  const cached = sumsCache.get(key)
  if (cached) return cached

  let sums = new Set<number>([0])
  for (const plate of usable) {
    const next = new Set<number>()
    for (const sum of sums) {
      for (let n = 0; n <= plate.count; n++) next.add(normalize(sum + n * plate.weight))
    }
    sums = next
  }

  const sorted = [...sums].sort((a, b) => a - b)
  sumsCache.set(key, sorted)
  return sorted
}

/** Every weight the bar can be loaded to with the inventory, ascending, in `ctx.units`. */
function loadableWeights(ctx: EvalContext): number[] {
  return loadableSums(ctx.plates).map((sum) => normalize(ctx.barbellWeight + 2 * sum))
}

/**
 * Nearest loadable weight, in `ctx.units`. Ties round DOWN — an unreachable
 * prescription is worse than a marginally light one. Never returns less than
 * the bare barbell.
 */
export function roundWeight(w: Weight, ctx: EvalContext): Weight {
  const target = convert(w, ctx.units).value
  const candidates = loadableWeights(ctx)
  if (candidates.length === 0) return roundToStep(convert(w, ctx.units), smallestStep(ctx.plates, ctx.units))

  let best = candidates[0]
  for (const candidate of candidates) {
    if (Math.abs(candidate - target) < Math.abs(best - target) - EPSILON) best = candidate
  }
  return weight(Math.max(best, ctx.barbellWeight), ctx.units)
}

/**
 * Next loadable weight strictly above `w`. When the inventory is exhausted the
 * step is used instead, so a program never stalls on a missing plate.
 */
export function increment(w: Weight, ctx: EvalContext): Weight {
  const current = convert(w, ctx.units).value
  const next = loadableWeights(ctx).find((candidate) => candidate > current + EPSILON)
  if (next === undefined) return weight(current + smallestStep(ctx.plates, ctx.units), ctx.units)
  return weight(next, ctx.units)
}

/** Next loadable weight strictly below `w`, never below the bare barbell. */
export function decrement(w: Weight, ctx: EvalContext): Weight {
  const current = convert(w, ctx.units).value
  const below = loadableWeights(ctx).filter((candidate) => candidate < current - EPSILON)
  if (below.length === 0)
    return weight(Math.max(ctx.barbellWeight, current - smallestStep(ctx.plates, ctx.units)), ctx.units)
  return weight(below[below.length - 1], ctx.units)
}

/**
 * Greedy per-side plate breakdown from the barbell upward, honouring how many
 * of each plate the user owns. `plates` is descending and lists one entry per
 * physical plate on ONE side; `achievable` is what that load actually weighs
 * (equal to the target whenever the target is loadable).
 */
export function platesFor(target: Weight, ctx: EvalContext): { plates: number[]; achievable: Weight } {
  const goal = convert(target, ctx.units).value
  if (goal <= ctx.barbellWeight + EPSILON) return { plates: [], achievable: weight(ctx.barbellWeight, ctx.units) }

  const inventory = ctx.plates
    .filter((plate) => plate.weight > 0 && plate.count > 0)
    .sort((a, b) => b.weight - a.weight)

  let remaining = normalize((goal - ctx.barbellWeight) / 2)
  const used: number[] = []
  for (const plate of inventory) {
    const n = Math.min(plate.count, Math.floor(normalize(remaining / plate.weight) + EPSILON))
    for (let i = 0; i < n; i++) used.push(plate.weight)
    remaining = normalize(remaining - n * plate.weight)
  }

  const perSide = used.reduce((sum, plate) => sum + plate, 0)
  return { plates: used, achievable: weight(ctx.barbellWeight + 2 * perSide, ctx.units) }
}

/** Epley: `w × (1 + reps / 30)`. A single rep is already the 1RM. */
export function calculate1RM(w: Weight, reps: number): Weight {
  if (reps <= 1) return { ...w }
  return multiply(w, 1 + reps / 30)
}
