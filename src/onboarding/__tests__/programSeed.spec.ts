import { describe, expect, it } from 'vitest'

import { exerciseKey } from '@/liftoscript/evaluator'
import {
  computeFromFiveRm,
  GZCLP_SEED_GROUPS,
  GZCLP_SEED_KEYS,
  gzclpSeedFrom,
  seedDraftsFrom,
  strengthTrackFromAdoption,
  strengthTrackFromDrafts,
} from '@/onboarding/programSeed'
import type { GymSettings, LiftSeedDraft, StrengthTrack } from '@/onboarding/types'
import { gzclpProgram } from '@/training/gzclp'
import type { ExerciseState } from '@/types'

const settings: GymSettings = {
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
  notifications: { daily: false, gapNudge: false },
  fcmTokens: [],
}

const base: StrengthTrack = { goal: { type: 'open' }, programText: '', programState: {}, rotationCursor: 3 }

function draft(key: string, patch: Partial<LiftSeedDraft> = {}): LiftSeedDraft {
  const [tier] = seedDraftsFrom({}, 'kg').filter((row) => row.key === key)
  return { ...tier, ...patch }
}

describe('GZCLP_SEED_KEYS', () => {
  it('lists the ten keys of the built-in program in day order', () => {
    expect(GZCLP_SEED_KEYS).toEqual([
      'T1:Squat',
      'T2:Bench Press',
      'T3:Lat Pulldown',
      'T1:Overhead Press',
      'T2:Deadlift',
      'T3:Bent Over Row',
      'T1:Bench Press',
      'T2:Squat',
      'T1:Deadlift',
      'T2:Overhead Press',
    ])
  })
})

describe('GZCLP_SEED_GROUPS', () => {
  // The grouping is hand-maintained, so pin it to the program it claims to
  // describe: every key must be a line the named day actually trains, and every
  // line must be asked about exactly once across the four days.
  it('names lifts the built-in program really trains on that day', () => {
    const days = gzclpProgram().weeks[0].days

    for (const group of GZCLP_SEED_GROUPS) {
      const day = days.find((candidate) => candidate.name === group.day)
      expect(day, `program has no day ${group.day}`).toBeDefined()

      const dayKeys = day!.exercises.map((exercise) => exerciseKey(exercise))
      for (const key of group.keys) expect(dayKeys).toContain(key)
    }
  })

  it('asks about every line of the program exactly once', () => {
    const everyKey = gzclpProgram().weeks[0].days.flatMap((day) =>
      day.exercises.map((exercise) => exerciseKey(exercise)),
    )

    expect([...GZCLP_SEED_KEYS].sort()).toEqual([...new Set(everyKey)].sort())
  })
})

describe('seedDraftsFrom', () => {
  it('is all ask-weight for an empty state', () => {
    const drafts = seedDraftsFrom({}, 'kg')

    expect(drafts).toHaveLength(10)
    expect(drafts.every((row) => row.weight === null)).toBe(true)
    expect(drafts.every((row) => row.fiveRm === null)).toBe(true)
  })

  it('reads tier and lift name off the key', () => {
    const drafts = seedDraftsFrom({}, 'kg')

    expect(drafts[0]).toMatchObject({ key: 'T1:Squat', lift: 'Squat', tier: 1, stage: 1 })
    expect(drafts[2]).toMatchObject({ key: 'T3:Lat Pulldown', lift: 'Lat Pulldown', tier: 3 })
  })

  it('pre-fills a stored weight and stage', () => {
    const state: Record<string, ExerciseState> = {
      'T1:Squat': { weights: [{ value: 100, unit: 'kg' }], setVariationIndex: 2, state: {} },
    }

    expect(seedDraftsFrom(state, 'kg')[0]).toMatchObject({ weight: 100, stage: 2 })
  })

  it('honours askWeight over a stale stored weight', () => {
    const state: Record<string, ExerciseState> = {
      'T1:Squat': { weights: [{ value: 100, unit: 'kg' }], setVariationIndex: 1, state: {}, askWeight: true },
    }

    expect(seedDraftsFrom(state, 'kg')[0].weight).toBeNull()
  })

  it('ignores a weight stored in the other unit', () => {
    const state: Record<string, ExerciseState> = {
      'T1:Squat': { weights: [{ value: 225, unit: 'lb' }], setVariationIndex: 1, state: {} },
    }

    expect(seedDraftsFrom(state, 'kg')[0].weight).toBeNull()
  })

  it('forces stage 1 on a tier-3 row whatever is stored', () => {
    const state: Record<string, ExerciseState> = {
      'T3:Lat Pulldown': { weights: [{ value: 40, unit: 'kg' }], setVariationIndex: 3, state: {} },
    }

    expect(seedDraftsFrom(state, 'kg')[2].stage).toBe(1)
  })
})

describe('computeFromFiveRm', () => {
  it('takes 85 % of a T1 5RM, rounded to a loadable weight', () => {
    const result = computeFromFiveRm(draft('T1:Squat', { fiveRm: 120 }), settings)

    // 120 × 0.85 = 102 → the plates round it to 102.5.
    expect(result.weight).toBe(102.5)
    expect(result.fiveRm).toBe(120)
  })

  it('takes 65 % for a T2', () => {
    expect(computeFromFiveRm(draft('T2:Bench Press', { fiveRm: 100 }), settings).weight).toBe(65)
  })

  it('takes 50 % for a T3', () => {
    expect(computeFromFiveRm(draft('T3:Lat Pulldown', { fiveRm: 80 }), settings).weight).toBe(40)
  })

  it('leaves the draft alone when the 5RM is missing or nonsense', () => {
    expect(computeFromFiveRm(draft('T1:Squat', { fiveRm: null }), settings).weight).toBeNull()
    expect(computeFromFiveRm(draft('T1:Squat', { fiveRm: 0 }), settings).weight).toBeNull()
    expect(computeFromFiveRm(draft('T1:Squat', { fiveRm: Number.NaN }), settings).weight).toBeNull()
  })
})

describe('gzclpSeedFrom', () => {
  it('drops empty and non-positive rows', () => {
    const seed = gzclpSeedFrom(
      [
        draft('T1:Squat', { weight: 100, stage: 2 }),
        draft('T2:Bench Press', { weight: null }),
        draft('T1:Deadlift', { weight: 0 }),
      ],
      'kg',
    )

    expect(Object.keys(seed)).toEqual(['T1:Squat'])
    expect(seed['T1:Squat']).toEqual({ weight: { value: 100, unit: 'kg' }, stage: 2 })
  })

  it('forces stage 1 for tier 3 and clamps a stage out of range', () => {
    const seed = gzclpSeedFrom(
      [draft('T3:Lat Pulldown', { weight: 40, stage: 3 }), draft('T1:Squat', { weight: 100, stage: 9 })],
      'kg',
    )

    expect(seed['T3:Lat Pulldown'].stage).toBe(1)
    expect(seed['T1:Squat'].stage).toBe(3)
  })

  it('stamps the passed units on every weight', () => {
    const seed = gzclpSeedFrom([draft('T1:Squat', { weight: 225 })], 'lb')

    expect(seed['T1:Squat'].weight.unit).toBe('lb')
  })
})

describe('strengthTrackFromDrafts', () => {
  const drafts = [
    draft('T1:Squat', { weight: 100, stage: 2 }),
    draft('T2:Bench Press', { weight: 60 }),
    ...GZCLP_SEED_KEYS.slice(2).map((key) => draft(key)),
  ]

  it('writes a seeded lift with its weight, its stage and no askWeight', () => {
    const track = strengthTrackFromDrafts(drafts, base, 'kg')

    expect(track.programState['T1:Squat'].weights).toEqual([{ value: 100, unit: 'kg' }])
    expect(track.programState['T1:Squat'].setVariationIndex).toBe(2)
    expect(track.programState['T1:Squat'].askWeight).toBeUndefined()
  })

  it('leaves an unseeded lift ask-weight at stage 1', () => {
    const track = strengthTrackFromDrafts(drafts, base, 'kg')

    expect(track.programState['T1:Deadlift'].weights).toEqual([])
    expect(track.programState['T1:Deadlift'].setVariationIndex).toBe(1)
    expect(track.programState['T1:Deadlift'].askWeight).toBe(true)
  })

  it('starts the rotation at A1 and keeps the goal', () => {
    const track = strengthTrackFromDrafts(drafts, base, 'kg')

    expect(track.rotationCursor).toBe(0)
    expect(track.goal).toEqual({ type: 'open' })
    expect(track.programText).toContain('100kg')
  })
})

describe('strengthTrackFromAdoption', () => {
  it('stores the pasted text and state verbatim', () => {
    const programState: Record<string, ExerciseState> = {
      'T1:Squat': { weights: [{ value: 140, unit: 'kg' }], setVariationIndex: 1, state: {} },
    }
    const track = strengthTrackFromAdoption({ programText: '# Week 1', programState }, base, 2)

    expect(track.programText).toBe('# Week 1')
    expect(track.programState).toBe(programState)
    expect(track.rotationCursor).toBe(2)
    expect(track.goal).toEqual({ type: 'open' })
  })

  it('falls back to cursor 0 on a nonsense cursor', () => {
    const adopted = { programText: '', programState: {} }

    expect(strengthTrackFromAdoption(adopted, base).rotationCursor).toBe(0)
    expect(strengthTrackFromAdoption(adopted, base, Number.NaN).rotationCursor).toBe(0)
    expect(strengthTrackFromAdoption(adopted, base, -3).rotationCursor).toBe(0)
  })
})
