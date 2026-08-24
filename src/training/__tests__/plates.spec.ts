import type { Profile } from '@/types'

import {
  evalContextFromSettings,
  formatPlateLoad,
  formatPlatesForWeight,
  nextLoadableDown,
  nextLoadableUp,
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
