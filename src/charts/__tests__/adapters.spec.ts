import { describe, expect, it } from 'vitest'

import type { LiftProgressPoint, WeeklySeriesPoint } from '@/training/progressStats'
import type { BodyweightPoint } from '@/training/stats'

import { bodyweightChartInput, cardioChartInput, formatNumber, liftChartInput, shortDate } from '../adapters'

function lift(date: string, working: number, e1rm: number, unit: 'kg' | 'lb' = 'kg'): LiftProgressPoint {
  return {
    date,
    workingWeight: { value: working, unit },
    e1rm: { value: e1rm, unit },
    reps: 5,
  }
}

function week(weekStart: string, doneMinutes: number, plannedMinutes: number): WeeklySeriesPoint {
  return {
    weekStart,
    doneMinutes,
    plannedMinutes,
    strengthDone: 0,
    strengthPlanned: 0,
    tonnage: { value: 0, unit: 'kg' },
  }
}

function bodyweight(date: string, weight: number, average: number): BodyweightPoint {
  return { date, weight, average }
}

function dates(points: Array<{ date: string } | null>): string[] {
  return points.flatMap((point) => (point === null ? [] : [point.date]))
}

describe('shortDate and formatNumber', () => {
  it('formats without a locale and without a unit', () => {
    expect(shortDate('2026-06-03')).toBe('3 Jun')
    expect(formatNumber(102.5)).toBe('102.5')
    expect(formatNumber(100)).toBe('100')
    expect(formatNumber(Number.NaN)).toBe('—')
  })
})

describe('liftChartInput', () => {
  it('sorts ascending regardless of input order', () => {
    const input = liftChartInput([lift('2026-08-08', 100, 115), lift('2026-08-01', 95, 110)], 'kg')

    expect(dates(input.series[0].points)).toEqual(['2026-08-01', '2026-08-08'])
  })

  it('collapses duplicate dates, last wins', () => {
    const input = liftChartInput([lift('2026-08-01', 95, 110), lift('2026-08-01', 100, 115)], 'kg')

    expect(input.series[0].points).toHaveLength(1)
    expect(input.series[0].points[0]).toEqual({ date: '2026-08-01', value: 100 })
  })

  it('converts a mixed-unit log onto one axis', () => {
    const input = liftChartInput([lift('2026-08-01', 100, 110, 'kg'), lift('2026-08-08', 225, 250, 'lb')], 'kg')

    const values = input.series[0].points.map((point) => point?.value ?? null)
    expect(values[0]).toBe(100)
    expect(values[1]).toBeCloseTo(102.06, 1)
    expect(input.yUnit).toBe('kg')
  })

  it('drops a non-finite weight rather than painting NaN into the path', () => {
    const input = liftChartInput([lift('2026-08-01', Number.NaN, 110), lift('2026-08-08', 100, 115)], 'kg')

    expect(dates(input.series[0].points)).toEqual(['2026-08-08'])
  })

  it('breaks the series across a 90-day layoff', () => {
    const input = liftChartInput([lift('2026-01-05', 90, 100), lift('2026-08-01', 100, 115)], 'kg')

    expect(input.series[0].points).toEqual([
      { date: '2026-01-05', value: 90 },
      null,
      { date: '2026-08-01', value: 100 },
    ])
    // Both series break at the same place, or the two lines disagree about
    // which weeks the athlete trained.
    expect(input.series[1].points[1]).toBeNull()
  })

  it('fixes the roles here, so no view can hand a series a colour', () => {
    const input = liftChartInput([lift('2026-08-01', 100, 115)], 'kg')

    expect(input.series[0]).toMatchObject({ id: 'working', role: 'emphasis', shape: 'line' })
    expect(input.series[1]).toMatchObject({ id: 'e1rm', role: 'context', shape: 'line' })
    expect(input.includeZero).toBe(false)
    expect(input.series[0].endLabel).toBe('100 kg')
  })

  it('survives an empty series', () => {
    const input = liftChartInput([], 'kg')

    expect(input.series[0].points).toEqual([])
    expect(input.series[0].endLabel).toBeUndefined()
  })
})

describe('bodyweightChartInput', () => {
  it('makes the raw readings dots and the rolling average the line', () => {
    const input = bodyweightChartInput([bodyweight('2026-08-01', 82, 82), bodyweight('2026-08-02', 80.5, 81.25)], 'kg')

    expect(input.series[0]).toMatchObject({ id: 'raw', role: 'context', shape: 'dots' })
    expect(input.series[1]).toMatchObject({ id: 'average', role: 'emphasis', shape: 'line' })
    expect(input.series[1].endLabel).toBe('81.25 kg')
    // A bodyweight axis from zero flattens the only signal there is.
    expect(input.includeZero).toBe(false)
  })

  it('sorts, de-duplicates and breaks on a long gap', () => {
    const input = bodyweightChartInput(
      [bodyweight('2026-08-01', 82, 82), bodyweight('2026-01-01', 90, 90), bodyweight('2026-01-01', 91, 91)],
      'kg',
    )

    expect(input.series[0].points).toEqual([{ date: '2026-01-01', value: 91 }, null, { date: '2026-08-01', value: 82 }])
  })
})

describe('cardioChartInput', () => {
  it('turns weeks into bars with the composed target as the reference', () => {
    const input = cardioChartInput([week('2026-08-17', 120, 150), week('2026-08-10', 0, 150)])

    expect(input.bars.map((entry) => entry.key)).toEqual(['2026-08-10', '2026-08-17'])
    expect(input.bars[0].value).toBe(0)
    expect(input.bars[1]).toMatchObject({ value: 120, reference: 150, label: '17 Aug' })
    expect(input.referenceLabel).toBe('target')
  })

  it('keeps a logged zero a zero and only nulls a value it cannot use', () => {
    const input = cardioChartInput([week('2026-08-17', 0, 150), week('2026-08-24', Number.NaN, 150)])

    expect(input.bars[0].value).toBe(0)
    expect(input.bars[1].value).toBeNull()
  })
})
