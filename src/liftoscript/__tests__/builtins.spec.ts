import { describe, expect, it } from 'vitest'

import { callBuiltin, compareScalars, isBuiltin, rpeMultiplier } from '../builtins'
import type { EvalContext } from '../types'
import { percent, weight } from '../weight'

const ctx: EvalContext = {
  units: 'kg',
  plates: [
    { weight: 25, count: 2 },
    { weight: 20, count: 2 },
    { weight: 15, count: 2 },
    { weight: 10, count: 2 },
    { weight: 5, count: 2 },
    { weight: 2.5, count: 2 },
    { weight: 1.25, count: 2 },
  ],
  barbellWeight: 20,
  week: 1,
  day: 1,
}

describe('isBuiltin', () => {
  it('recognises the documented functions and nothing else', () => {
    expect(isBuiltin('roundWeight')).toBe(true)
    expect(isBuiltin('zeroOrGte')).toBe(true)
    expect(isBuiltin('sqrt')).toBe(false)
  })
})

describe('rounding builtins', () => {
  it('rounds numbers', () => {
    expect(callBuiltin('floor', [2.9], ctx)).toBe(2)
    expect(callBuiltin('ceil', [2.1], ctx)).toBe(3)
    expect(callBuiltin('round', [2.5], ctx)).toBe(3)
  })

  it('keeps the unit when rounding a weight', () => {
    expect(callBuiltin('floor', [weight(102.5, 'kg')], ctx)).toEqual(weight(102, 'kg'))
  })

  it('spreads over a per-set list', () => {
    expect(callBuiltin('round', [[2.4, 2.6]], ctx)).toEqual([2, 3])
  })

  it('rejects a wrong argument count', () => {
    expect(() => callBuiltin('floor', [1, 2], ctx)).toThrow(/expects 1 argument/)
  })
})

describe('sum, min, max', () => {
  it('sums an array of numbers', () => {
    expect(callBuiltin('sum', [[10, 8, 7]], ctx)).toBe(25)
  })

  it('sums weights in the first element unit', () => {
    expect(callBuiltin('sum', [[weight(100, 'kg'), weight(2.5, 'kg')]], ctx)).toEqual(weight(102.5, 'kg'))
  })

  it('refuses to mix weights and numbers', () => {
    expect(() => callBuiltin('sum', [[weight(100, 'kg'), 5]], ctx)).toThrow(/cannot mix/)
  })

  it('takes min and max over an array or over the argument list', () => {
    expect(callBuiltin('min', [[3, 1, 2]], ctx)).toBe(1)
    expect(callBuiltin('max', [3, 1, 2], ctx)).toBe(3)
    expect(callBuiltin('max', [[weight(100, 'kg'), weight(105, 'kg')]], ctx)).toEqual(weight(105, 'kg'))
  })
})

describe('plate-aware builtins', () => {
  it('rounds to a loadable weight', () => {
    expect(callBuiltin('roundWeight', [weight(101, 'kg')], ctx)).toEqual(weight(100, 'kg'))
  })

  it('steps to the next and previous loadable weight', () => {
    expect(callBuiltin('increment', [weight(100, 'kg')], ctx)).toEqual(weight(102.5, 'kg'))
    expect(callBuiltin('decrement', [weight(100, 'kg')], ctx)).toEqual(weight(97.5, 'kg'))
  })

  it('reads a plain number in the context units', () => {
    expect(callBuiltin('roundWeight', [101], ctx)).toEqual(weight(100, 'kg'))
  })
})

describe('calculate1RM', () => {
  it('applies Epley', () => {
    const result = callBuiltin('calculate1RM', [weight(100, 'kg'), 5], ctx)
    expect(result).toEqual(weight(100 * (1 + 5 / 30), 'kg'))
  })

  it('leaves a single rep alone', () => {
    expect(callBuiltin('calculate1RM', [weight(100, 'kg'), 1], ctx)).toEqual(weight(100, 'kg'))
  })
})

describe('zeroOrGte', () => {
  it('is true when every set reached its target', () => {
    expect(
      callBuiltin(
        'zeroOrGte',
        [
          [3, 3, 3],
          [3, 3, 3],
        ],
        ctx,
      ),
    ).toBe(1)
  })

  it('is false when one set fell short', () => {
    expect(
      callBuiltin(
        'zeroOrGte',
        [
          [3, 2, 3],
          [3, 3, 3],
        ],
        ctx,
      ),
    ).toBe(0)
  })

  it('treats a skipped set as not a miss', () => {
    expect(
      callBuiltin(
        'zeroOrGte',
        [
          [3, 0, 3],
          [3, 3, 3],
        ],
        ctx,
      ),
    ).toBe(1)
  })

  it('broadcasts a scalar target over every set', () => {
    expect(callBuiltin('zeroOrGte', [[5, 5, 4], 5], ctx)).toBe(0)
    expect(callBuiltin('zeroOrGte', [6, 5], ctx)).toBe(1)
  })
})

describe('rpeMultiplier', () => {
  it('is 1 for a single rep at RPE 10', () => {
    expect(rpeMultiplier(1, 10)).toBe(1)
  })

  it('drops for extra reps and for reps left in the tank', () => {
    expect(rpeMultiplier(5, 8)).toBeCloseTo(0.8002, 4)
    expect(callBuiltin('rpeMultiplier', [5, 10], ctx)).toBeCloseTo(0.8668, 4)
  })

  it('rejects an impossible RPE', () => {
    expect(() => rpeMultiplier(5, 12)).toThrow(/RPE between/)
  })
})

describe('compareScalars', () => {
  it('reads a plain number in the unit of the weight it is compared with', () => {
    expect(compareScalars(weight(100, 'kg'), 100)).toBe(0)
    expect(compareScalars(100, weight(102.5, 'kg'))).toBe(-1)
  })

  it('compares percentages by value', () => {
    expect(compareScalars(percent(85), percent(90))).toBe(-1)
  })

  it('refuses a weight against a percentage', () => {
    expect(() => compareScalars(weight(100, 'kg'), percent(85))).toThrow(/percentage/)
  })
})

describe('unknown functions', () => {
  it('throws with the name', () => {
    expect(() => callBuiltin('sqrt', [4], ctx)).toThrow(/unknown function sqrt/)
  })
})
