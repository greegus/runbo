import type { EvalContext } from '../types'
import {
  add,
  applyPercent,
  calculate1RM,
  compare,
  convert,
  decrement,
  divide,
  equals,
  format,
  increment,
  isPercent,
  isWeight,
  multiply,
  percent,
  platesFor,
  ratio,
  roundToStep,
  roundWeight,
  smallestStep,
  subtract,
  weight,
} from '../weight'

const KG_PLATES = [
  { weight: 25, count: 2 },
  { weight: 20, count: 2 },
  { weight: 15, count: 2 },
  { weight: 10, count: 2 },
  { weight: 5, count: 2 },
  { weight: 2.5, count: 2 },
  { weight: 1.25, count: 2 },
]

function context(overrides: Partial<EvalContext> = {}): EvalContext {
  return { units: 'kg', plates: KG_PLATES, barbellWeight: 20, week: 1, day: 1, ...overrides }
}

describe('constructors and guards', () => {
  it('tells weights and percentages apart', () => {
    expect(isWeight(weight(100, 'kg'))).toBe(true)
    expect(isWeight(percent(85))).toBe(false)
    expect(isPercent(percent(85))).toBe(true)
    expect(isPercent(100)).toBe(false)
    expect(isWeight(null)).toBe(false)
  })
})

describe('mixed-unit arithmetic', () => {
  it("converts the right operand into the left one's unit", () => {
    const sum = add(weight(100, 'kg'), weight(10, 'lb'))
    expect(sum.unit).toBe('kg')
    expect(sum.value).toBeCloseTo(104.5359, 4)

    const inPounds = add(weight(100, 'lb'), weight(10, 'kg'))
    expect(inPounds.unit).toBe('lb')
    expect(inPounds.value).toBeCloseTo(122.0462, 4)
  })

  it('subtracts across units', () => {
    const difference = subtract(weight(100, 'kg'), weight(22.0462262, 'lb'))
    expect(difference.value).toBeCloseTo(90, 6)
    expect(difference.unit).toBe('kg')
  })

  it('scales, divides and takes ratios', () => {
    expect(multiply(weight(100, 'kg'), 0.85)).toEqual(weight(85, 'kg'))
    expect(divide(weight(100, 'kg'), 4)).toEqual(weight(25, 'kg'))
    expect(ratio(weight(90, 'kg'), weight(100, 'kg'))).toBeCloseTo(0.9, 6)
    expect(() => divide(weight(100, 'kg'), 0)).toThrow()
  })

  it('applies percentages to a base weight', () => {
    expect(applyPercent(weight(100, 'kg'), percent(75))).toEqual(weight(75, 'kg'))
  })

  it('compares equal weights written in different units', () => {
    expect(equals(weight(100, 'kg'), weight(220.462262, 'lb'))).toBe(true)
    expect(compare(weight(100, 'kg'), weight(100, 'lb'))).toBe(1)
    expect(compare(weight(100, 'lb'), weight(100, 'kg'))).toBe(-1)
  })

  it('converts both ways without drift', () => {
    expect(convert(convert(weight(102.5, 'kg'), 'lb'), 'kg').value).toBeCloseTo(102.5, 6)
  })

  it('formats without trailing zeros', () => {
    expect(format(weight(100, 'kg'))).toBe('100 kg')
    expect(format(weight(102.5, 'kg'))).toBe('102.5 kg')
    expect(format(weight(45, 'lb'))).toBe('45 lb')
  })
})

describe('roundToStep', () => {
  it('rounds to the nearest 2.5 kg', () => {
    expect(roundToStep(weight(101.3, 'kg'), 2.5)).toEqual(weight(102.5, 'kg'))
    expect(roundToStep(weight(101.2, 'kg'), 2.5)).toEqual(weight(100, 'kg'))
    expect(roundToStep(weight(100, 'kg'), 2.5)).toEqual(weight(100, 'kg'))
  })

  it('leaves the weight alone for a non-positive step', () => {
    expect(roundToStep(weight(101.3, 'kg'), 0)).toEqual(weight(101.3, 'kg'))
  })
})

describe('smallestStep', () => {
  it('is two of the smallest plate', () => {
    expect(smallestStep(KG_PLATES)).toBe(2.5)
    expect(
      smallestStep(
        [
          { weight: 45, count: 2 },
          { weight: 2.5, count: 2 },
        ],
        'lb',
      ),
    ).toBe(5)
  })

  it('falls back to the unit default without plates', () => {
    expect(smallestStep([], 'kg')).toBe(2.5)
    expect(smallestStep([{ weight: 20, count: 0 }], 'lb')).toBe(5)
  })
})

describe('platesFor', () => {
  it('breaks 102.5 kg down per side', () => {
    const result = platesFor(weight(102.5, 'kg'), context())
    expect(result.plates).toEqual([25, 15, 1.25])
    expect(result.achievable).toEqual(weight(102.5, 'kg'))
  })

  it('uses the heaviest plates first and respects how many exist', () => {
    expect(platesFor(weight(100, 'kg'), context()).plates).toEqual([25, 15])
    expect(platesFor(weight(140, 'kg'), context()).plates).toEqual([25, 25, 10])
  })

  it('returns the bare bar below the barbell weight', () => {
    const result = platesFor(weight(15, 'kg'), context())
    expect(result.plates).toEqual([])
    expect(result.achievable).toEqual(weight(20, 'kg'))
  })

  it('reports what is reachable when the inventory runs out', () => {
    const result = platesFor(weight(500, 'kg'), context())
    expect(result.achievable).toEqual(weight(335, 'kg'))
  })

  it('converts the target into the context units first', () => {
    const result = platesFor(weight(220.462262, 'lb'), context())
    expect(result.achievable).toEqual(weight(100, 'kg'))
  })
})

describe('increment / decrement', () => {
  it('steps to the next loadable weight', () => {
    expect(increment(weight(102.5, 'kg'), context())).toEqual(weight(105, 'kg'))
    expect(decrement(weight(102.5, 'kg'), context())).toEqual(weight(100, 'kg'))
    expect(increment(weight(20, 'kg'), context())).toEqual(weight(22.5, 'kg'))
  })

  it('never goes below the bare bar', () => {
    expect(decrement(weight(20, 'kg'), context())).toEqual(weight(20, 'kg'))
  })

  it('jumps across the gap a sparse plate set leaves', () => {
    // Only one 20 kg and one 5 kg plate per side: 20, 30, 60, 70 kg are loadable.
    const sparse = context({
      plates: [
        { weight: 20, count: 1 },
        { weight: 5, count: 1 },
      ],
    })
    expect(increment(weight(30, 'kg'), sparse)).toEqual(weight(60, 'kg'))
    expect(decrement(weight(60, 'kg'), sparse)).toEqual(weight(30, 'kg'))
    expect(increment(weight(70, 'kg'), sparse)).toEqual(weight(80, 'kg')) // inventory exhausted, falls back to the step
  })

  it('works from a weight that is not loadable itself', () => {
    expect(increment(weight(101, 'kg'), context())).toEqual(weight(102.5, 'kg'))
    expect(decrement(weight(101, 'kg'), context())).toEqual(weight(100, 'kg'))
  })
})

describe('roundWeight', () => {
  it('snaps to the nearest loadable weight', () => {
    expect(roundWeight(weight(101.3, 'kg'), context())).toEqual(weight(102.5, 'kg'))
    expect(roundWeight(weight(101.2, 'kg'), context())).toEqual(weight(100, 'kg'))
  })

  it('rounds a tie down', () => {
    expect(roundWeight(weight(101.25, 'kg'), context())).toEqual(weight(100, 'kg'))
  })

  it('rounds the 85 % reset of 100 kg to 85 kg', () => {
    expect(roundWeight(multiply(weight(100, 'kg'), 0.85), context())).toEqual(weight(85, 'kg'))
  })

  it('never returns less than the bare bar', () => {
    expect(roundWeight(weight(5, 'kg'), context())).toEqual(weight(20, 'kg'))
  })

  it('answers in the context units', () => {
    expect(roundWeight(weight(225, 'lb'), context())).toEqual(weight(102.5, 'kg'))
  })
})

describe('calculate1RM', () => {
  it('uses Epley', () => {
    expect(calculate1RM(weight(100, 'kg'), 5).value).toBeCloseTo(116.6667, 4)
    expect(calculate1RM(weight(60, 'kg'), 10).value).toBeCloseTo(80, 6)
  })

  it('treats a single rep as the 1RM already', () => {
    expect(calculate1RM(weight(140, 'kg'), 1)).toEqual(weight(140, 'kg'))
  })
})
