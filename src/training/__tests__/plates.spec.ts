import type { Profile } from '@/types'

import {
  evalContextFromSettings,
  formatPlateLoad,
  formatPlatesForWeight,
  formatPlateWeight,
  nextLoadableDown,
  nextLoadableUp,
  plateColor,
  platesForWeight,
  roundToLoadable,
} from '../plates'

const settings: Profile['settings'] = {
  units: 'kg',
  barbellWeight: 20,
  plates: [
    { weight: 25, count: 2 },
    { weight: 20, count: 2 },
    { weight: 15, count: 2 },
    { weight: 10, count: 2 },
    { weight: 5, count: 2 },
    { weight: 2.5, count: 2 },
    { weight: 1.25, count: 2 },
  ],
  restTimers: { t1: 180, t2: 120, t3: 60 },
  comebackGapDays: 10,
  notifications: { daily: true, gapNudge: true },
  fcmTokens: [],
}

describe('evalContextFromSettings', () => {
  it('mirrors the gym settings and defaults to the first program slot', () => {
    expect(evalContextFromSettings(settings)).toEqual({
      units: 'kg',
      plates: settings.plates,
      barbellWeight: 20,
      week: 1,
      day: 1,
    })
    expect(evalContextFromSettings(settings, { week: 2, day: 3 })).toMatchObject({ week: 2, day: 3 })
  })
})

describe('platesForWeight', () => {
  it('breaks an exactly loadable weight down per side', () => {
    const load = platesForWeight({ value: 102.5, unit: 'kg' }, settings)

    expect(load.perSide).toEqual([25, 15, 1.25])
    expect(load.achievable).toEqual({ value: 102.5, unit: 'kg' })
    expect(load.exact).toBe(true)
  })

  it('reports the closest reachable load when the target is not loadable', () => {
    const load = platesForWeight({ value: 101, unit: 'kg' }, settings)

    expect(load.perSide).toEqual([25, 15])
    expect(load.achievable).toEqual({ value: 100, unit: 'kg' })
    expect(load.exact).toBe(false)
  })

  it('returns an empty bar for the barbell alone', () => {
    const load = platesForWeight({ value: 20, unit: 'kg' }, settings)

    expect(load.perSide).toEqual([])
    expect(load.exact).toBe(true)
  })
})

describe('formatting', () => {
  it('drops trailing zeros from a plate weight', () => {
    expect(formatPlateWeight(2.5)).toBe('2.5')
    expect(formatPlateWeight(20)).toBe('20')
    expect(formatPlateWeight(1.25)).toBe('1.25')
  })

  it('prints bar plus per-side plates', () => {
    expect(formatPlateLoad(platesForWeight({ value: 102.5, unit: 'kg' }, settings), settings)).toBe('20 + 25/15/1.25')
    expect(formatPlatesForWeight({ value: 60, unit: 'kg' }, settings)).toBe('20 + 20')
  })

  it('prints just the bar when nothing is loaded', () => {
    expect(formatPlatesForWeight({ value: 20, unit: 'kg' }, settings)).toBe('20')
  })
})

describe('rounding helpers delegate to the engine', () => {
  it('rounds to the nearest loadable weight', () => {
    expect(roundToLoadable({ value: 101, unit: 'kg' }, settings)).toEqual({ value: 100, unit: 'kg' })
  })

  it('steps to the neighbouring loadable weights', () => {
    expect(nextLoadableUp({ value: 100, unit: 'kg' }, settings)).toEqual({ value: 102.5, unit: 'kg' })
    expect(nextLoadableDown({ value: 100, unit: 'kg' }, settings)).toEqual({ value: 97.5, unit: 'kg' })
  })
})

describe('plateColor', () => {
  it('paints kg plates in the IWF competition colours', () => {
    expect([25, 20, 15, 10, 5].map((weight) => plateColor(weight, 'kg'))).toEqual([
      'red',
      'blue',
      'yellow',
      'green',
      'white',
    ])
    expect([2.5, 2, 1.5, 1, 0.5].map((weight) => plateColor(weight, 'kg'))).toEqual([
      'red',
      'blue',
      'yellow',
      'green',
      'white',
    ])
    expect(plateColor(1.25, 'kg')).toBe('silver')
  })

  it('gives an lb plate the colour of the kg plate it stands in for', () => {
    expect(plateColor(45, 'lb')).toBe('blue')
    expect(plateColor(55, 'lb')).toBe('red')
  })

  it('keys on the units, not the bare number', () => {
    expect(plateColor(25, 'kg')).toBe('red')
    expect(plateColor(25, 'lb')).toBe('green')
  })

  it('finds the colour of a weight that drifted in floating point', () => {
    expect(plateColor(2.4999999, 'kg')).toBe('red')
    expect(plateColor(1.2500001, 'kg')).toBe('silver')
  })

  it('falls back to black iron for a size with no convention', () => {
    expect(plateColor(7.5, 'kg')).toBe('black')
    expect(plateColor(100, 'lb')).toBe('black')
  })
})
