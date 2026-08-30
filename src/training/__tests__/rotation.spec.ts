import { parseProgramOrThrow } from '@/liftoscript/parser'

import { GZCLP_PROGRAM_SOURCE } from '../gzclp'
import { cursorOfDay, dayAtCursor, nextCursor, rotationDays } from '../rotation'

const gzclp = ['A1', 'B1', 'A2', 'B2']

describe('rotationDays', () => {
  it('reads the built-in program as its four days', () => {
    expect(rotationDays(parseProgramOrThrow(GZCLP_PROGRAM_SOURCE))).toEqual(gzclp)
  })

  it('follows whatever days the athlete wrote, in order, across weeks', () => {
    const program = parseProgramOrThrow(`# Week 1
## Push
T1: Bench Press / 5x3 / 60kg
## Pull
T1: Bent Over Row / 5x3 / 50kg
# Week 2
## Legs
T1: Squat / 5x3 / 100kg
`)

    // Flattened across weeks: the cursor walks days, because a session advances
    // by one day whenever it happens, not by one week.
    expect(rotationDays(program)).toEqual(['Push', 'Pull', 'Legs'])
  })

  it('keeps a repeated day name rather than shortening the cycle', () => {
    const program = parseProgramOrThrow(`# Week 1
## Full Body
T1: Squat / 5x3 / 100kg
## Full Body
T1: Deadlift / 5x3 / 120kg
`)

    expect(rotationDays(program)).toEqual(['Full Body', 'Full Body'])
  })

  it('is empty for a program with no days at all', () => {
    expect(rotationDays({ weeks: [] })).toEqual([])
  })
})

describe('cursorOfDay', () => {
  it('finds the day', () => {
    expect(cursorOfDay(gzclp, 'A2')).toBe(2)
  })

  it('is null for a day the program does not have, and for none at all', () => {
    // The caller falls back to the stored cursor: a session logged under another
    // program's day name must not silently reset the athlete to the start.
    expect(cursorOfDay(gzclp, 'Day 1')).toBeNull()
    expect(cursorOfDay(gzclp, undefined)).toBeNull()
  })
})

describe('dayAtCursor', () => {
  it('reads the day at the cursor', () => {
    expect(dayAtCursor(gzclp, 0)).toBe('A1')
    expect(dayAtCursor(gzclp, 3)).toBe('B2')
  })

  it('wraps a cursor left behind by a longer program', () => {
    // Switching to a shorter program leaves a cursor past the end. Wrapping is
    // what keeps that athlete training instead of crashing on their next session.
    expect(dayAtCursor(gzclp, 4)).toBe('A1')
    expect(dayAtCursor(gzclp, 9)).toBe('B1')
    expect(dayAtCursor(['Push', 'Pull'], 7)).toBe('Pull')
  })

  it('handles a negative cursor', () => {
    expect(dayAtCursor(gzclp, -1)).toBe('B2')
  })

  it('is undefined when there are no days', () => {
    expect(dayAtCursor([], 0)).toBeUndefined()
  })
})

describe('nextCursor', () => {
  it('advances and wraps', () => {
    expect(nextCursor(gzclp, 0)).toBe(1)
    expect(nextCursor(gzclp, 3)).toBe(0)
  })

  it("follows the length of the athlete's own rotation", () => {
    expect(nextCursor(['Push', 'Pull', 'Legs'], 2)).toBe(0)
    expect(nextCursor(['Full Body'], 0)).toBe(0)
  })

  it('stays at zero when there is nothing to rotate through', () => {
    expect(nextCursor([], 3)).toBe(0)
  })
})
