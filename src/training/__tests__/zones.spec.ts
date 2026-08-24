import type { CardioPrescription } from '@/types'

import { describePrescription, formatPaceZone, hrZones, maxFromAge, paceZones, thresholdPace } from '../zones'

describe('maxFromAge', () => {
  it('uses 208 - 0.7 x age', () => {
    expect(maxFromAge(40)).toBeCloseTo(180, 6)
    expect(maxFromAge(30)).toBeCloseTo(187, 6)
  })
})

describe('hrZones', () => {
  it('prefers LTHR over max HR', () => {
    const zones = hrZones({ lthr: 160, max: 190 })!

    expect(zones.map((zone) => [zone.min, zone.max])).toEqual([
      [80, 108], // <68 %
      [109, 133], // 68-83 %
      [134, 151], // 84-94 %
      [152, 167], // 95-105 %
      [168, 184], // >105 %
    ])
  })

  it('falls back to the %maxHR ladder', () => {
    const zones = hrZones({ max: 190 })!

    expect(zones.map((zone) => [zone.min, zone.max])).toEqual([
      [95, 113],
      [114, 132],
      [133, 151],
      [152, 170],
      [171, 190],
    ])
  })

  it('estimates max HR from age when no max is given', () => {
    expect(hrZones({ age: 40 })).toEqual(hrZones({ max: 180 }))
  })

  it('produces contiguous, non-overlapping ranges', () => {
    const zones = hrZones({ lthr: 173 })!

    for (let index = 1; index < zones.length; index += 1) {
      expect(zones[index].min).toBe(zones[index - 1].max + 1)
    }
  })

  it('returns null when nothing is configured', () => {
    expect(hrZones(undefined)).toBeNull()
    expect(hrZones({})).toBeNull()
    expect(hrZones({ max: 0 })).toBeNull()
  })
})

describe('thresholdPace', () => {
  it('derives seconds per km for running', () => {
    expect(thresholdPace('run', { distanceKm: 5, minutes: 22.5 })).toBe(270)
  })

  it('derives km/h for the bike', () => {
    expect(thresholdPace('bike', { distanceKm: 40, minutes: 60 })).toBe(40)
    expect(thresholdPace('bike', { distanceKm: 20, minutes: 40 })).toBe(30)
  })

  it('derives seconds per 100 m for swimming', () => {
    expect(thresholdPace('swim', { distanceKm: 1.5, minutes: 27 })).toBe(108)
  })

  it('passes a stored threshold through', () => {
    expect(thresholdPace('run', 300)).toBe(300)
    expect(thresholdPace('run', undefined)).toBeNull()
    expect(thresholdPace('run', { distanceKm: 0, minutes: 20 })).toBeNull()
  })
})

describe('paceZones', () => {
  it('turns a slower speed fraction into MORE seconds per km', () => {
    const zones = paceZones('run', { distanceKm: 5, minutes: 22.5 })!

    // 270 s/km threshold: Z2 = 75-84 % of speed -> 270/0.84 .. 270/0.75
    expect(zones[1]).toEqual({ zone: 2, min: 321, max: 360, unit: 'sec/km' })
    expect(zones[3]).toEqual({ zone: 4, min: 257, max: 284, unit: 'sec/km' })
    expect(zones.every((zone) => zone.min <= zone.max)).toBe(true)
  })

  it('scales bike speed directly', () => {
    const zones = paceZones('bike', 40)!

    expect(zones[1]).toEqual({ zone: 2, min: 30, max: 33.6, unit: 'km/h' })
    expect(zones[3]).toEqual({ zone: 4, min: 38, max: 42, unit: 'km/h' })
  })

  it('works in seconds per 100 m for swimming', () => {
    const zones = paceZones('swim', { distanceKm: 1.5, minutes: 27 })!

    expect(zones[1]).toEqual({ zone: 2, min: 129, max: 144, unit: 'sec/100m' })
    expect(formatPaceZone(zones[1])).toBe('2:09-2:24 /100m')
  })

  it('returns null without a benchmark', () => {
    expect(paceZones('run', undefined)).toBeNull()
  })
})

describe('formatPaceZone', () => {
  it('formats each unit', () => {
    expect(formatPaceZone({ zone: 2, min: 340, max: 370, unit: 'sec/km' })).toBe('5:40-6:10 /km')
    expect(formatPaceZone({ zone: 2, min: 28, max: 31.5, unit: 'km/h' })).toBe('28-31.5 km/h')
  })
})

const easyRun: CardioPrescription = { modality: 'run', kind: 'easy', targetMinutes: 40, zone: 2 }

describe('describePrescription', () => {
  it('shows HR and pace when both are configured', () => {
    const line = describePrescription(easyRun, { hr: { lthr: 160 }, pace: { run: 270 } })

    expect(line).toBe('40 min easy - 109-133 bpm - 5:21-6:00 /km')
  })

  it('degrades to HR only', () => {
    expect(describePrescription(easyRun, { hr: { lthr: 160 } })).toBe('40 min easy - 109-133 bpm')
  })

  it('degrades to pace only', () => {
    expect(describePrescription(easyRun, { pace: { run: 270 } })).toBe('40 min easy - 5:21-6:00 /km')
  })

  it('always falls back to RPE plus a verbal cue', () => {
    expect(describePrescription(easyRun, undefined)).toBe('40 min easy - RPE 3-4 - conversational')
    expect(describePrescription(easyRun, {})).toBe('40 min easy - RPE 3-4 - conversational')
    // A pace configured for another modality does not help this one.
    expect(describePrescription(easyRun, { pace: { bike: 30 } })).toBe('40 min easy - RPE 3-4 - conversational')
  })

  it('spells out the interval structure', () => {
    const intervals: CardioPrescription = {
      modality: 'run',
      kind: 'intervals',
      targetMinutes: 38,
      zone: 4,
      structure: { reps: 6, workMinutes: 3, restMinutes: 2 },
    }

    expect(describePrescription(intervals, undefined)).toBe(
      '38 min intervals - 6x3min work / 2min rest - RPE 7-8 - hard, short sentences only',
    )
  })
})
