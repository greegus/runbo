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

/** The paint on a plate — what the lifter looks for on the rack. */
export type PlateColor = 'red' | 'blue' | 'yellow' | 'green' | 'white' | 'silver' | 'black'

// DECISION: kg follows the IWF competition colours (25 red, 20 blue, 15 yellow,
// 10 green, 5 white, and the same five again for the 2.5–0.5 change plates);
// 1.25 is not an IWF size, and the gyms that have one have it in chrome. lb has
// no standard, so it takes the colour of the kg plate it stands in for on the
// rack — 45 lb is the "20", 55 lb the "25". Anything else is a black iron plate,
// which is what an unusual size almost always is.
const PLATE_COLORS: Record<GymSettings['units'], Record<number, PlateColor>> = {
  kg: {
    25: 'red',
    20: 'blue',
    15: 'yellow',
    10: 'green',
    5: 'white',
    2.5: 'red',
    2: 'blue',
    1.5: 'yellow',
    1.25: 'silver',
    1: 'green',
    0.5: 'white',
  },
  lb: {
    55: 'red',
    45: 'blue',
    35: 'yellow',
    25: 'green',
    10: 'white',
    5: 'red',
    2.5: 'silver',
  },
}

/** Colour of one plate of `weight` in `units`, by competition convention. */
export function plateColor(weight: number, units: GymSettings['units']): PlateColor {
  // Rounded like `formatPlateWeight`, so a weight that drifted to 2.4999999 in
  // arithmetic still finds its key — and gets the colour of the label it shows.
  return PLATE_COLORS[units][Math.round(weight * 100) / 100] ?? 'black'
}

// Trailing zeros read as noise on a plate hint: 2.50 is a plate nobody calls that.
export function formatPlateWeight(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** `'20 + 25/20/5'` — the bar, then the plates to hang on one side. */
export function formatPlateLoad(load: PlateLoad, settings: GymSettings): string {
  const bar = formatPlateWeight(settings.barbellWeight)
  if (load.perSide.length === 0) return bar

  return `${bar} + ${load.perSide.map(formatPlateWeight).join('/')}`
}

/** Convenience for the common "compute and print" call in a set row. */
export function formatPlatesForWeight(target: WeightValue, settings: GymSettings): string {
  return formatPlateLoad(platesForWeight(target, settings), settings)
}
