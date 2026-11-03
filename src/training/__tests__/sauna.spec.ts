import type { Session } from '@/types'

import { saunaDate, type SaunaDay, trainingSessions } from '../sauna'

// Mon 2026-08-24 .. Sun 2026-08-30.
const WEEK = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']

/** 'T' = trained or planned, 'R' = rest, '-' = neither (a missed day). */
function week(pattern: string): SaunaDay[] {
  return [...pattern].map((mark, index) => ({ date: WEEK[index], isRest: mark === 'R', trained: mark === 'T' }))
}

describe('saunaDate', () => {
  it('suggests one rest day a week', () => {
    expect(saunaDate(week('RRRRRRR'), WEEK[0])).toBe(WEEK[0])
  })

  it('prefers the rest day right after a training day over an earlier one', () => {
    // Mon rest, Tue train, Wed rest: Wed, although Mon comes first.
    expect(saunaDate(week('RTRTTRR'), WEEK[0])).toBe(WEEK[2])
  })

  it('falls back to the earliest rest day when none follows training', () => {
    expect(saunaDate(week('RRTTTTT'), WEEK[0])).toBe(WEEK[0])
  })

  it('suggests nothing on a day that is already past', () => {
    expect(saunaDate(week('RTRTRTR'), WEEK[3])).toBe(WEEK[4])
  })

  it('suggests nothing on a training day, and nothing in a week without rest days', () => {
    expect(saunaDate(week('TTTTTTT'), WEEK[0])).toBeNull()
  })

  it('does not count a missed day as training', () => {
    // Tue was planned but missed, so Wed is not "the day after training"; Fri is.
    expect(saunaDate(week('T-RTRRR'), WEEK[0])).toBe(WEEK[4])
  })
})

describe('trainingSessions', () => {
  it('drops claimed saunas and keeps every training session', () => {
    const sessions: Session[] = [
      { id: 'a', uid: 'u', date: WEEK[0], kind: 'strength', status: 'done' },
      { id: 'b', uid: 'u', date: WEEK[1], kind: 'sauna', status: 'done', minutes: 20 },
      { id: 'c', uid: 'u', date: WEEK[2], kind: 'cardio', status: 'active' },
    ]

    expect(trainingSessions(sessions).map((session) => session.id)).toEqual(['a', 'c'])
  })
})
