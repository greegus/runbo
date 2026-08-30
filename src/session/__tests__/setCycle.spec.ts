import { describe, expect, it } from 'vitest'

import type { PrescribedSet } from '@/liftoscript/types'
import type { SetLog } from '@/types'

import {
  fromSetLog,
  isLogged,
  loggedCount,
  resetSet,
  setAmrapReps,
  skipSet,
  startsRest,
  tapSet,
  toLoggedSet,
  toSetLog,
} from '../setCycle'
import type { LoggedSet, SetPhase } from '../types'

const kg = (value: number) => ({ value, unit: 'kg' as const })

function prescribed(overrides: Partial<PrescribedSet> = {}): PrescribedSet {
  return { reps: 5, isAmrap: false, weight: kg(100), ...overrides }
}

function logged(overrides: Partial<LoggedSet> = {}): LoggedSet {
  return {
    prescribedReps: 5,
    isAmrap: false,
    weight: kg(100),
    phase: 'untouched',
    completedReps: null,
    ...overrides,
  }
}

describe('toLoggedSet', () => {
  it('starts untouched with nothing logged', () => {
    expect(toLoggedSet(prescribed())).toEqual({
      prescribedReps: 5,
      isAmrap: false,
      weight: kg(100),
      phase: 'untouched',
      completedReps: null,
    })
  })

  it('carries a rep range and a label, and omits them otherwise', () => {
    expect(toLoggedSet(prescribed({ reps: 12, minReps: 8, label: '(Top set)' }))).toMatchObject({
      prescribedReps: 12,
      minReps: 8,
      label: '(Top set)',
    })
    expect(Object.keys(toLoggedSet(prescribed()))).not.toContain('minReps')
    expect(Object.keys(toLoggedSet(prescribed()))).not.toContain('label')
  })

  it('does not share the prescription weight object', () => {
    const set = prescribed()
    expect(toLoggedSet(set).weight).not.toBe(set.weight)
  })
})

describe('the non-AMRAP tap cycle', () => {
  // The whole contract in one table: taps 1..N+3 for a set prescribed at 5.
  const table: { tap: number; phase: SetPhase; completedReps: number | null; startsRest: boolean }[] = [
    { tap: 1, phase: 'done', completedReps: 5, startsRest: true },
    { tap: 2, phase: 'done', completedReps: 4, startsRest: false },
    { tap: 3, phase: 'done', completedReps: 3, startsRest: false },
    { tap: 4, phase: 'done', completedReps: 2, startsRest: false },
    { tap: 5, phase: 'done', completedReps: 1, startsRest: false },
    { tap: 6, phase: 'done', completedReps: 0, startsRest: false },
    { tap: 7, phase: 'skipped', completedReps: null, startsRest: false },
    { tap: 8, phase: 'untouched', completedReps: null, startsRest: false },
    { tap: 9, phase: 'done', completedReps: 5, startsRest: true },
  ]

  it.each(table)('tap $tap -> $phase / $completedReps', ({ tap, phase, completedReps, startsRest: rest }) => {
    let current = logged()
    let before = current

    for (let index = 0; index < tap; index++) {
      before = current
      current = tapSet(current)
    }

    expect(current.phase).toBe(phase)
    expect(current.completedReps).toBe(completedReps)
    expect(startsRest(before, current)).toBe(rest)
  })

  it('has a cycle of N + 3 states', () => {
    let current = logged({ prescribedReps: 3 })
    const seen: string[] = []

    for (let index = 0; index < 6; index++) {
      seen.push(`${current.phase}:${current.completedReps}`)
      current = tapSet(current)
    }

    expect(seen).toEqual(['untouched:null', 'done:3', 'done:2', 'done:1', 'done:0', 'skipped:null'])
    expect(current).toMatchObject({ phase: 'untouched', completedReps: null })
  })

  it('never mutates its argument', () => {
    const set = logged()
    const next = tapSet(set)

    expect(set).toMatchObject({ phase: 'untouched', completedReps: null })
    expect(next).not.toBe(set)
  })

  it('reaches skipped in one tap when the set is prescribed at 0 reps', () => {
    expect(tapSet(logged({ prescribedReps: 0 }))).toMatchObject({ phase: 'done', completedReps: 0 })
    expect(tapSet(tapSet(logged({ prescribedReps: 0 })))).toMatchObject({ phase: 'skipped' })
  })
})

describe('AMRAP sets', () => {
  const amrap = (overrides: Partial<LoggedSet> = {}) => logged({ isAmrap: true, prescribedReps: 3, ...overrides })

  it('confirms at the prescription on the first tap and starts rest', () => {
    const before = amrap()
    const after = tapSet(before)

    expect(after).toMatchObject({ phase: 'done', completedReps: 3 })
    expect(startsRest(before, after)).toBe(true)
  })

  it('is a no-op once done, so a stray tap cannot destroy a typed number', () => {
    const set = setAmrapReps(amrap(), 12)
    const after = tapSet(set)

    expect(after).toMatchObject({ phase: 'done', completedReps: 12 })
    expect(startsRest(set, after)).toBe(false)
  })

  it('returns a skipped AMRAP to untouched', () => {
    expect(tapSet(skipSet(amrap()))).toMatchObject({ phase: 'untouched', completedReps: null })
  })

  it('records more than prescribed — the point of an AMRAP', () => {
    expect(setAmrapReps(amrap(), 12)).toMatchObject({ phase: 'done', completedReps: 12 })
  })

  it('floors at 0 and rounds, and treats null / NaN as 0', () => {
    expect(setAmrapReps(amrap(), -4).completedReps).toBe(0)
    expect(setAmrapReps(amrap(), 7.6).completedReps).toBe(8)
    expect(setAmrapReps(amrap(), null).completedReps).toBe(0)
    expect(setAmrapReps(amrap(), Number.NaN).completedReps).toBe(0)
  })

  it('starts rest on the first stepper change out of untouched', () => {
    const before = amrap()
    expect(startsRest(before, setAmrapReps(before, 4))).toBe(true)
    expect(startsRest(setAmrapReps(before, 4), setAmrapReps(before, 5))).toBe(false)
  })
})

describe('skip / reset', () => {
  it('skips and clears without touching the prescription', () => {
    const set = tapSet(logged())

    expect(skipSet(set)).toMatchObject({ phase: 'skipped', completedReps: null, prescribedReps: 5 })
    expect(resetSet(set)).toMatchObject({ phase: 'untouched', completedReps: null, prescribedReps: 5 })
  })

  it('never starts rest', () => {
    const set = logged()
    expect(startsRest(set, skipSet(set))).toBe(false)
    expect(startsRest(set, resetSet(set))).toBe(false)
  })
})

describe('isLogged / loggedCount', () => {
  it('counts done and skipped, not untouched', () => {
    expect(isLogged(logged())).toBe(false)
    expect(isLogged(skipSet(logged()))).toBe(true)
    expect(isLogged(tapSet(logged()))).toBe(true)

    expect(loggedCount([logged(), tapSet(logged()), skipSet(logged())])).toBe(2)
    expect(loggedCount([])).toBe(0)
  })
})

describe('SetLog round-trip', () => {
  it('drops the phase; skipped and untouched both persist as null', () => {
    expect(toSetLog(skipSet(logged())).completedReps).toBeNull()
    expect(toSetLog(logged()).completedReps).toBeNull()
    expect(toSetLog(tapSet(logged())).completedReps).toBe(5)
  })

  it('omits absent optional keys rather than writing undefined', () => {
    const log = toSetLog(logged())

    expect('minReps' in log).toBe(false)
    expect('label' in log).toBe(false)
  })

  it('rehydrates a logged set and forgets the skipped-ness', () => {
    const stored: SetLog = {
      prescribedReps: 5,
      minReps: 3,
      isAmrap: true,
      completedReps: null,
      weight: kg(60),
      label: '(Top set)',
    }

    expect(fromSetLog(stored)).toEqual({
      prescribedReps: 5,
      minReps: 3,
      isAmrap: true,
      weight: kg(60),
      label: '(Top set)',
      phase: 'untouched',
      completedReps: null,
    })
    expect(fromSetLog({ ...stored, completedReps: 0 })).toMatchObject({ phase: 'done', completedReps: 0 })
  })

  it('survives a set -> log -> set round trip', () => {
    const set = setAmrapReps(logged({ isAmrap: true, minReps: 3 }), 9)

    expect(fromSetLog(toSetLog(set))).toEqual(set)
  })
})
