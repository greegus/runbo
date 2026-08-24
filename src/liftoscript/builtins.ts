/**
 * The script language's builtin functions.
 *
 * Everything weight-aware is delegated to `weight.ts` — a builtin only coerces
 * arguments, spreads itself over arrays and fails loudly. Failing loudly
 * matters: the evaluator turns the throw into a diagnostic carrying the call's
 * `loc`, so a script that asks for something impossible stops the progression
 * instead of silently prescribing the wrong training.
 */

import { BUILTIN_FUNCTIONS, type BuiltinName, type EvalContext, type ScriptScalar, type ScriptValue } from './types'
import {
  calculate1RM as epley,
  compare,
  convert,
  decrement as decrementWeight,
  increment as incrementWeight,
  isPercent,
  isWeight,
  percent,
  roundWeight as roundToLoadable,
  weight,
  type Weight,
} from './weight'

/** Whether `name` is a builtin — used by the parser to reject unknown calls early. */
export function isBuiltin(name: string): name is BuiltinName {
  return (BUILTIN_FUNCTIONS as readonly string[]).includes(name)
}

/**
 * Ordering across the scalar kinds a script can produce. A plain number
 * compared against a weight is read in that weight's unit, which is what makes
 * `weights[1] > 100` behave the way a lifter expects. Percentages are resolved
 * against `rm1` by the evaluator before they ever reach here.
 */
export function compareScalars(a: ScriptScalar, b: ScriptScalar): -1 | 0 | 1 {
  if (isWeight(a) && isWeight(b)) return compare(a, b)
  if (isWeight(a) && typeof b === 'number') return compare(a, weight(b, a.unit))
  if (typeof a === 'number' && isWeight(b)) return compare(weight(a, b.unit), b)
  if (isWeight(a) || isWeight(b)) throw new Error('cannot compare a weight with a percentage')

  const left = isPercent(a) ? a.value : a
  const right = isPercent(b) ? b.value : b
  if (left === right) return 0
  return left < right ? -1 : 1
}

function isArray(value: ScriptValue): value is ScriptScalar[] {
  return Array.isArray(value)
}

function flatten(args: ScriptValue[]): ScriptScalar[] {
  return args.flatMap((arg) => (isArray(arg) ? arg : [arg]))
}

function expectArgs(name: string, args: ScriptValue[], count: number): void {
  if (args.length !== count) {
    throw new Error(`${name}() expects ${String(count)} argument${count === 1 ? '' : 's'}, got ${String(args.length)}`)
  }
}

function expectNumber(name: string, value: ScriptValue): number {
  if (typeof value !== 'number') throw new Error(`${name}() expects a number`)
  return value
}

/** Anything the plate math can work on: a weight, or a number read as `ctx.units`. */
function asWeight(name: string, value: ScriptScalar, ctx: EvalContext): Weight {
  if (isWeight(value)) return value
  if (typeof value === 'number') return weight(value, ctx.units)
  throw new Error(`${name}() expects a weight`)
}

/** Applies a scalar function element-wise so `round(weights)` works like `round(weights[1])`. */
function spread(value: ScriptValue, fn: (scalar: ScriptScalar) => ScriptScalar): ScriptValue {
  return isArray(value) ? value.map(fn) : fn(value)
}

function mapNumeric(name: string, value: ScriptValue, fn: (n: number) => number): ScriptValue {
  return spread(value, (scalar) => {
    if (typeof scalar === 'number') return fn(scalar)
    if (isWeight(scalar)) return weight(fn(scalar.value), scalar.unit)
    if (isPercent(scalar)) return percent(fn(scalar.value))
    throw new Error(`${name}() expects a number or a weight`)
  })
}

function sumScalars(name: string, values: ScriptScalar[]): ScriptScalar {
  if (values.length === 0) return 0

  const first = values[0]
  if (isWeight(first)) {
    return values.reduce<Weight>(
      (total, value) => {
        if (!isWeight(value)) throw new Error(`${name}() cannot mix weights with plain numbers`)
        return weight(total.value + convert(value, total.unit).value, total.unit)
      },
      weight(0, first.unit),
    )
  }

  return values.reduce<number>((total, value) => {
    if (typeof value !== 'number') throw new Error(`${name}() cannot mix numbers with weights`)
    return total + value
  }, 0)
}

function pick(name: string, values: ScriptScalar[], direction: -1 | 1): ScriptScalar {
  if (values.length === 0) throw new Error(`${name}() needs at least one value`)
  return values.reduce((best, value) => (compareScalars(value, best) === direction ? value : best))
}

function lengthOf(value: ScriptValue): number {
  return isArray(value) ? value.length : 1
}

function elementAt(value: ScriptValue, index: number): ScriptScalar | undefined {
  return isArray(value) ? value[index] : value
}

function isZero(value: ScriptScalar): boolean {
  if (typeof value === 'number') return value === 0
  return value.value === 0
}

/**
 * A set that was never performed does not count as a miss — that is the whole
 * point of the function: an athlete who skipped the last set has not failed the
 * stage, but one who hit 2 reps out of 3 has.
 */
function zeroOrGte(completed: ScriptValue, target: ScriptValue): number {
  const length = Math.max(lengthOf(completed), lengthOf(target))
  for (let index = 0; index < length; index++) {
    const done = elementAt(completed, index)
    const goal = elementAt(target, index)
    if (done === undefined || goal === undefined) continue
    if (isZero(done)) continue
    if (compareScalars(done, goal) < 0) return 0
  }
  return 1
}

/**
 * Linear RPE chart: every rep below one and every RPE point below ten costs
 * about 3.33 % of the 1RM. `rpeMultiplier(1, 10)` is 1 by definition.
 */
export function rpeMultiplier(reps: number, rpe: number): number {
  if (reps < 1) throw new Error('rpeMultiplier() expects at least one rep')
  if (rpe <= 0 || rpe > 10) throw new Error('rpeMultiplier() expects an RPE between 1 and 10')
  const value = 1 - 0.0333 * (reps - 1 + (10 - rpe))
  return Math.max(0, Math.round(value * 1e4) / 1e4)
}

export function callBuiltin(name: string, args: ScriptValue[], ctx: EvalContext): ScriptValue {
  switch (name) {
    case 'floor':
      expectArgs(name, args, 1)
      return mapNumeric(name, args[0], Math.floor)

    case 'ceil':
      expectArgs(name, args, 1)
      return mapNumeric(name, args[0], Math.ceil)

    case 'round':
      expectArgs(name, args, 1)
      return mapNumeric(name, args[0], Math.round)

    case 'sum':
      if (args.length === 0) throw new Error('sum() needs at least one argument')
      return sumScalars(name, flatten(args))

    case 'min':
      return pick(name, flatten(args), -1)

    case 'max':
      return pick(name, flatten(args), 1)

    case 'increment':
      expectArgs(name, args, 1)
      return spread(args[0], (scalar) => incrementWeight(asWeight(name, scalar, ctx), ctx))

    case 'decrement':
      expectArgs(name, args, 1)
      return spread(args[0], (scalar) => decrementWeight(asWeight(name, scalar, ctx), ctx))

    case 'roundWeight':
      expectArgs(name, args, 1)
      return spread(args[0], (scalar) => roundToLoadable(asWeight(name, scalar, ctx), ctx))

    case 'calculate1RM': {
      expectArgs(name, args, 2)
      const reps = expectNumber(name, args[1])
      return spread(args[0], (scalar) => epley(asWeight(name, scalar, ctx), reps))
    }

    case 'zeroOrGte':
      expectArgs(name, args, 2)
      return zeroOrGte(args[0], args[1])

    case 'rpeMultiplier':
      expectArgs(name, args, 2)
      return rpeMultiplier(expectNumber(name, args[0]), expectNumber(name, args[1]))

    default:
      throw new Error(`unknown function ${name}()`)
  }
}
