import { maxFromAge } from '@/training/zones'

import {
  clockFromMinutes,
  emptyZonesDraft,
  isZonesDraftEmpty,
  joinClock,
  minutesFromClock,
  paceFromDraft,
  splitClock,
  zonesDraftFrom,
  zonesFromDraft,
} from '../zonesDraft'

describe('emptyZonesDraft', () => {
  it('starts with every axis unset', () => {
    const draft = emptyZonesDraft()

    expect(draft.hrMode).toBe('none')
    expect(draft.pace.run).toEqual({ mode: 'none', threshold: null, distanceKm: null, minutes: null })
    expect(isZonesDraftEmpty(draft)).toBe(true)
  })
})

describe('zonesFromDraft', () => {
  it('returns undefined when nothing usable was entered', () => {
    expect(zonesFromDraft(emptyZonesDraft(), ['run'])).toBeUndefined()
  })

  it('folds an age into hr.max and never stores the age', () => {
    const draft = { ...emptyZonesDraft(), hrMode: 'age' as const, age: 37 }
    const zones = zonesFromDraft(draft, [])

    expect(zones).toEqual({ hr: { max: Math.round(maxFromAge(37)) } })
    expect(JSON.stringify(zones)).not.toContain('age')
  })

  it('ignores the max HR while the mode is age, and vice versa', () => {
    const base = { ...emptyZonesDraft(), maxHr: 190, age: 40 }

    expect(zonesFromDraft({ ...base, hrMode: 'max' }, [])).toEqual({ hr: { max: 190 } })
    expect(zonesFromDraft({ ...base, hrMode: 'age' }, [])).toEqual({ hr: { max: 180 } })
    expect(zonesFromDraft({ ...base, hrMode: 'none' }, [])).toBeUndefined()
  })

  it('keeps lthr independently of the max HR mode', () => {
    const draft = { ...emptyZonesDraft(), lthr: 162 }

    expect(zonesFromDraft(draft, [])).toEqual({ hr: { lthr: 162 } })
  })

  it('stores a threshold as-is and converts a recent effort', () => {
    const draft = emptyZonesDraft()

    draft.pace.run = { mode: 'threshold', threshold: 300, distanceKm: null, minutes: null }
    draft.pace.bike = { mode: 'recent', threshold: null, distanceKm: 40, minutes: 60 }
    draft.pace.swim = { mode: 'recent', threshold: null, distanceKm: 0.4, minutes: 8 }

    expect(zonesFromDraft(draft, ['run', 'bike', 'swim'])).toEqual({
      pace: { run: 300, bike: 40, swim: 120 },
    })
  })

  it('drops modalities that are not enabled and efforts that do not resolve', () => {
    const draft = emptyZonesDraft()

    draft.pace.run = { mode: 'threshold', threshold: 300, distanceKm: null, minutes: null }
    draft.pace.bike = { mode: 'recent', threshold: null, distanceKm: 40, minutes: null }

    expect(zonesFromDraft(draft, ['run', 'bike'])).toEqual({ pace: { run: 300 } })
    expect(zonesFromDraft(draft, ['bike'])).toBeUndefined()
  })

  it('prunes empty sub-objects rather than emitting a husk', () => {
    const draft = emptyZonesDraft()

    draft.pace.run = { mode: 'threshold', threshold: 300, distanceKm: null, minutes: null }

    const zones = zonesFromDraft(draft, ['run'])

    expect(zones).toEqual({ pace: { run: 300 } })
    expect(zones && 'hr' in zones).toBe(false)
  })

  it('rejects zero and negative values', () => {
    const draft = { ...emptyZonesDraft(), hrMode: 'max' as const, maxHr: 0, lthr: -1 }

    draft.pace.run = { mode: 'threshold', threshold: 0, distanceKm: null, minutes: null }

    expect(zonesFromDraft(draft, ['run'])).toBeUndefined()
  })
})

describe('zonesDraftFrom', () => {
  it('round-trips stored zones', () => {
    const zones = { hr: { max: 186, lthr: 162 }, pace: { run: 300, swim: 120 } }
    const draft = zonesDraftFrom(zones)

    expect(draft.hrMode).toBe('max')
    expect(draft.maxHr).toBe(186)
    expect(draft.lthr).toBe(162)
    expect(draft.pace.run.mode).toBe('threshold')
    expect(draft.pace.run.threshold).toBe(300)
    expect(draft.pace.bike.mode).toBe('none')
    expect(zonesFromDraft(draft, ['run', 'bike', 'swim'])).toEqual(zones)
  })

  it('handles an absent zones object', () => {
    expect(isZonesDraftEmpty(zonesDraftFrom(undefined))).toBe(true)
  })

  it('leaves the HR mode alone when only an LTHR was stored', () => {
    const draft = zonesDraftFrom({ hr: { lthr: 160 } })

    expect(draft.hrMode).toBe('none')
    expect(draft.lthr).toBe(160)
  })
})

describe('paceFromDraft', () => {
  it('returns null for the none mode even when numbers are present', () => {
    expect(paceFromDraft('run', { mode: 'none', threshold: 300, distanceKm: 5, minutes: 25 })).toBeNull()
  })
})

describe('clock helpers', () => {
  it('splits and rejoins seconds', () => {
    expect(splitClock(95)).toEqual({ minutes: 1, seconds: 35 })
    expect(joinClock({ minutes: 1, seconds: 35 })).toBe(95)
  })

  it('keeps a blank field blank', () => {
    expect(splitClock(null)).toEqual({ minutes: null, seconds: null })
    expect(joinClock({ minutes: null, seconds: null })).toBeNull()
  })

  it('accepts a half-typed pair', () => {
    expect(joinClock({ minutes: 5, seconds: null })).toBe(300)
    expect(joinClock({ minutes: null, seconds: 40 })).toBe(40)
  })

  it('converts a mm:ss duration to minutes and back', () => {
    expect(minutesFromClock({ minutes: 25, seconds: 30 })).toBe(25.5)
    expect(clockFromMinutes(25.5)).toEqual({ minutes: 25, seconds: 30 })
    expect(clockFromMinutes(null)).toEqual({ minutes: null, seconds: null })
  })
})
