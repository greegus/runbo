import { saunaDates, type SaunaDay } from '../sauna'

// Mon 2026-08-24 .. Sun 2026-08-30.
const WEEK = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']

/** 'T' = trained or planned, 'R' = rest, '-' = neither (a missed day). */
function week(pattern: string): SaunaDay[] {
  return [...pattern].map((mark, index) => ({ date: WEEK[index], isRest: mark === 'R', trained: mark === 'T' }))
}

describe('saunaDates', () => {
  it('suggests at most two rest days a week', () => {
    expect(saunaDates(week('RRRRRRR'), WEEK[0]).size).toBe(2)
  })

  it('never suggests two days in a row', () => {
    const picked = [...saunaDates(week('TRRRTRR'), WEEK[0])].sort()

    expect(picked).toHaveLength(2)
    expect(picked[0]).not.toBe(WEEK[WEEK.indexOf(picked[1]) - 1])
  })

  it('prefers the day after a training day, then the earlier day', () => {
    // Mon rest, Tue train, Wed rest, Thu train, Fri train, Sat rest, Sun rest.
    expect([...saunaDates(week('RTRTTRR'), WEEK[0])].sort()).toEqual([WEEK[2], WEEK[5]])
  })

  it('suggests nothing on a day that is already past', () => {
    expect([...saunaDates(week('RTRTRTR'), WEEK[3])].sort()).toEqual([WEEK[4], WEEK[6]])
  })

  it('suggests nothing on a training day, and nothing in a week without rest days', () => {
    expect(saunaDates(week('TTTTTTT'), WEEK[0]).size).toBe(0)
  })

  it('does not count a missed day as training', () => {
    // Tue was planned but missed, so Wed is not "the day after training"; Fri is.
    expect([...saunaDates(week('T-RTRRR'), WEEK[0], 1)]).toEqual([WEEK[4]])
  })
})
