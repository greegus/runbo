import { addDays, daysBetween, formatHuman, parseIso, startOfWeekMonday, toIso, weekdayIndexMondayFirst } from '../date'

describe('toIso', () => {
  it('reads the local calendar day, not the UTC one', () => {
    // Late evening local time is already the next day in UTC east of Greenwich.
    expect(toIso(new Date(2026, 7, 24, 23, 30))).toBe('2026-08-24')
    expect(toIso(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01')
  })

  it('pads month and day', () => {
    expect(toIso(new Date(2026, 8, 5))).toBe('2026-09-05')
  })
})

describe('parseIso', () => {
  it('returns the UTC-midnight instant', () => {
    expect(parseIso('2026-08-24').toISOString()).toBe('2026-08-24T00:00:00.000Z')
  })

  it('rejects malformed and non-existent days', () => {
    expect(() => parseIso('2026-8-24')).toThrow()
    expect(() => parseIso('24.08.2026')).toThrow()
    expect(() => parseIso('2026-02-30')).toThrow()
    expect(() => parseIso('2026-13-01')).toThrow()
  })
})

describe('addDays', () => {
  it('crosses month boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('crosses year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('handles leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('is unaffected by DST switches', () => {
    // Europe/Bratislava springs forward on 2026-03-29 and falls back 2026-10-25.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
  })

  it('adds zero days', () => {
    expect(addDays('2026-08-24', 0)).toBe('2026-08-24')
  })
})

describe('weekdayIndexMondayFirst', () => {
  it('counts from Monday', () => {
    expect(weekdayIndexMondayFirst('2026-08-24')).toBe(0) // Monday
    expect(weekdayIndexMondayFirst('2026-08-29')).toBe(5) // Saturday
    expect(weekdayIndexMondayFirst('2026-08-30')).toBe(6) // Sunday
  })
})

describe('startOfWeekMonday', () => {
  it('returns the same day for a Monday', () => {
    expect(startOfWeekMonday('2026-08-24')).toBe('2026-08-24')
  })

  it('walks back to Monday from a Sunday', () => {
    expect(startOfWeekMonday('2026-08-30')).toBe('2026-08-24')
  })

  it('crosses a month and a year boundary', () => {
    expect(startOfWeekMonday('2026-09-02')).toBe('2026-08-31')
    expect(startOfWeekMonday('2027-01-01')).toBe('2026-12-28')
  })

  it('is stable across a DST switch', () => {
    expect(startOfWeekMonday('2026-03-29')).toBe('2026-03-23')
    expect(startOfWeekMonday('2026-10-25')).toBe('2026-10-19')
  })
})

describe('daysBetween', () => {
  it('counts forwards and backwards', () => {
    expect(daysBetween('2026-08-24', '2026-08-31')).toBe(7)
    expect(daysBetween('2026-08-31', '2026-08-24')).toBe(-7)
    expect(daysBetween('2026-08-24', '2026-08-24')).toBe(0)
  })

  it('counts across DST switches without rounding drift', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
  })

  it('counts across a leap day', () => {
    expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29)
    expect(daysBetween('2026-02-01', '2026-03-01')).toBe(28)
  })
})

describe('formatHuman', () => {
  it('formats independently of the host locale', () => {
    expect(formatHuman('2026-08-24')).toBe('Mon, 24 Aug 2026')
    expect(formatHuman('2027-01-01')).toBe('Fri, 1 Jan 2027')
  })
})
