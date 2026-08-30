import { formatClock } from '../duration'

describe('formatClock', () => {
  it('formats whole minutes and seconds', () => {
    expect(formatClock(180)).toBe('3:00')
    expect(formatClock(120)).toBe('2:00')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(9)).toBe('0:09')
    expect(formatClock(0)).toBe('0:00')
  })

  it('pads the seconds to two digits', () => {
    expect(formatClock(61)).toBe('1:01')
    expect(formatClock(70)).toBe('1:10')
  })

  it('does not wrap minutes at 60', () => {
    expect(formatClock(3600)).toBe('60:00')
    expect(formatClock(3661)).toBe('61:01')
  })

  it('rounds up, so it only reads 0:00 when the rest is really over', () => {
    expect(formatClock(0.1)).toBe('0:01')
    expect(formatClock(59.4)).toBe('1:00')
    expect(formatClock(119.001)).toBe('2:00')
  })

  it('clamps nonsense to 0:00 instead of rendering NaN', () => {
    expect(formatClock(-1)).toBe('0:00')
    expect(formatClock(-180)).toBe('0:00')
    expect(formatClock(Number.NaN)).toBe('0:00')
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00')
  })
})
