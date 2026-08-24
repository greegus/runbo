/**
 * App-facing plate maths.
 *
 * Every calculation lives in `liftoscript/weight.ts` — this module only builds
 * an `EvalContext` out of the profile settings and formats the result, so there
 * is exactly one implementation of "what can this bar actually be loaded to".
 */

import type { EvalContext } from '@/liftoscript/types'
import { compare, decrement, increment, platesFor, roundWeight, type Weight } from '@/liftoscript/weight'
import type { Profile, WeightValue } from '@/types'

/** The gym half of the profile — units, barbell and plate inventory. */
export type GymSettings = Profile['settings']

export interface PlateLoad {
  /** One entry per physical plate on ONE side, heaviest first. */
  perSide: number[]
  /** What that load really weighs — equals the target when `exact`. */
  achievable: Weight
  /** False when the inventory cannot hit the target exactly. */
  exact: boolean
}

/**
 * The engine context the weight helpers need. `week`/`day` only matter for
 * program lookups, so plate maths defaults them to the first slot.
 */
export function evalContextFromSettings(
  settings: GymSettings,
  slot: { week?: number; day?: number } = {},
): EvalContext {
  return {
    units: settings.units,
    plates: settings.plates,
    barbellWeight: settings.barbellWeight,
    week: slot.week ?? 1,
    day: slot.day ?? 1,
  }
}

/** Per-side plate breakdown for a prescribed weight. */
export function platesForWeight(target: WeightValue, settings: GymSettings): PlateLoad {
  const { plates, achievable } = platesFor(target, evalContextFromSettings(settings))

  return { perSide: plates, achievable, exact: compare(achievable, target) === 0 }
}

/** Nearest weight the inventory can actually load. */
export function roundToLoadable(target: WeightValue, settings: GymSettings): Weight {
  return roundWeight(target, evalContextFromSettings(settings))
}

/** Next loadable weight above / below — for the "+ / −" buttons on a weight field. */
export function nextLoadableUp(target: WeightValue, settings: GymSettings): Weight {
  return increment(target, evalContextFromSettings(settings))
}

export function nextLoadableDown(target: WeightValue, settings: GymSettings): Weight {
  return decrement(target, evalContextFromSettings(settings))
}

// Trailing zeros read as noise on a plate hint: 2.50 is a plate nobody calls that.
function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** `'20 + 25/20/5'` — the bar, then the plates to hang on one side. */
export function formatPlateLoad(load: PlateLoad, settings: GymSettings): string {
  const bar = formatNumber(settings.barbellWeight)
  if (load.perSide.length === 0) return bar

  return `${bar} + ${load.perSide.map(formatNumber).join('/')}`
}

/** Convenience for the common "compute and print" call in a set row. */
export function formatPlatesForWeight(target: WeightValue, settings: GymSettings): string {
  return formatPlateLoad(platesForWeight(target, settings), settings)
}
