import { describe, expect, it } from 'vitest'

import {
  defaultPlateRows,
  normalizePlates,
  sortPlatesDesc,
  validateBarbell,
  validatePlates,
} from '@/onboarding/plateInventory'

describe('normalizePlates', () => {
  it('sorts heaviest first', () => {
    expect(
      normalizePlates([
        { weight: 5, count: 2 },
        { weight: 20, count: 2 },
        { weight: 10, count: 1 },
      ]),
    ).toEqual([
      { weight: 20, count: 2 },
      { weight: 10, count: 1 },
      { weight: 5, count: 2 },
    ])
  })

  it('drops non-finite, zero and negative weights and counts', () => {
    expect(
      normalizePlates([
        { weight: Number.NaN, count: 2 },
        { weight: 0, count: 2 },
        { weight: -5, count: 2 },
        { weight: 10, count: 0 },
        { weight: 20, count: Number.NaN },
        { weight: 25, count: 2 },
      ]),
    ).toEqual([{ weight: 25, count: 2 }])
  })

  it('merges duplicate weights onto the larger count', () => {
    expect(
      normalizePlates([
        { weight: 20, count: 1 },
        { weight: 20, count: 4 },
      ]),
    ).toEqual([{ weight: 20, count: 4 }])
  })

  it('floors a fractional count', () => {
    expect(normalizePlates([{ weight: 20, count: 2.7 }])).toEqual([{ weight: 20, count: 2 }])
  })

  it('never mutates its argument', () => {
    const rows = [
      { weight: 5, count: 2 },
      { weight: 20, count: 2 },
    ]
    normalizePlates(rows)
    expect(rows[0]).toEqual({ weight: 5, count: 2 })
  })
})

describe('sortPlatesDesc', () => {
  it('orders heaviest first without merging or dropping', () => {
    expect(
      sortPlatesDesc([
        { weight: 5, count: 2 },
        { weight: 20, count: 1 },
        { weight: 20, count: 3 },
      ]),
    ).toEqual([
      { weight: 20, count: 1 },
      { weight: 20, count: 3 },
      { weight: 5, count: 2 },
    ])
  })
})

describe('validatePlates', () => {
  it('accepts a sane inventory', () => {
    expect(validatePlates(defaultPlateRows('kg'))).toEqual([])
  })

  it('flags an empty inventory as a whole', () => {
    expect(validatePlates([])).toEqual([
      { index: -1, message: 'Add at least one plate size — the app cannot load a bar without plates.' },
    ])
  })

  it('blames the second occurrence of a duplicate weight', () => {
    const errors = validatePlates([
      { weight: 20, count: 2 },
      { weight: 20, count: 2 },
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0].index).toBe(1)
  })

  it('rejects a non-positive weight and a fractional or zero count', () => {
    const errors = validatePlates([
      { weight: 0, count: 2 },
      { weight: 10, count: 0 },
      { weight: 5, count: 1.5 },
    ])
    expect(errors.filter((error) => error.index === 0)).toHaveLength(1)
    expect(errors.filter((error) => error.index === 1)).toHaveLength(1)
    expect(errors.filter((error) => error.index === 2)).toHaveLength(1)
  })
})

describe('defaultPlateRows', () => {
  it('returns the kg inventory createDefaultProfile writes', () => {
    expect(defaultPlateRows('kg')).toEqual([
      { weight: 25, count: 2 },
      { weight: 20, count: 2 },
      { weight: 15, count: 2 },
      { weight: 10, count: 2 },
      { weight: 5, count: 2 },
      { weight: 2.5, count: 2 },
      { weight: 1.25, count: 2 },
    ])
  })

  it('returns a standard lb rack', () => {
    expect(defaultPlateRows('lb').map((row) => row.weight)).toEqual([45, 35, 25, 10, 5, 2.5])
  })

  it('hands out fresh objects so an edit cannot reach the constant', () => {
    const rows = defaultPlateRows('kg')
    rows[0].count = 9
    expect(defaultPlateRows('kg')[0].count).toBe(2)
  })
})

describe('validateBarbell', () => {
  it('accepts a positive weight', () => {
    expect(validateBarbell(20)).toBeNull()
  })

  it('rejects zero, negatives and NaN', () => {
    expect(validateBarbell(0)).not.toBeNull()
    expect(validateBarbell(-20)).not.toBeNull()
    expect(validateBarbell(Number.NaN)).not.toBeNull()
  })
})
