import { describe, expect, it } from 'vitest'

import { GZCLP_PROGRAM_SOURCE } from '@/training/gzclp'
import type { Profile, Session } from '@/types'

import {
  applyLoggedSets,
  applyWorkingWeight,
  buildStrengthPlan,
  draftFromPlan,
  finishBlockedReason,
  loggedSetsFromSession,
  restSecFor,
} from '../strengthSession'
import type { LoggedSet } from '../types'

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'u1',
    email: 'a@b.c',
    settings: {
      units: 'kg',
      barbellWeight: 20,
      plates: [
        { weight: 20, count: 4 },
        { weight: 10, count: 2 },
        { weight: 5, count: 2 },
        { weight: 2.5, count: 2 },
        { weight: 1.25, count: 2 },
      ],
      restTimers: { t1: 200, t2: 130, t3: 70 },
      comebackGapDays: 10,
      notifications: { daily: true, gapNudge: true },
      fcmTokens: [],
    },
    availability: { daysPerWeek: 5, preferredDays: [0, 1, 2, 4, 5], longSessionDay: 5 },
    strengthTrack: {
      goal: { type: 'open' },
      programText: GZCLP_PROGRAM_SOURCE,
      programState: {
        'T1:Squat': { weights: [{ value: 105, unit: 'kg' }], setVariationIndex: 1, state: { inc: 5 } },
        'T2:Bench Press': { weights: [{ value: 62.5, unit: 'kg' }], setVariationIndex: 1, state: { inc: 2.5 } },
        'T3:Lat Pulldown': { weights: [{ value: 45, unit: 'kg' }], setVariationIndex: 1, state: {} },
      },
      rotationCursor: 0,
    },
    cardioTrack: {
      goal: { type: 'open' },
      modalities: ['run'],
      weeklyMinutes: 120,
      longestSessionMinutes: 60,
      mesoWeek: 1,
      blockStartDate: '2026-08-24',
      holdStreak: 0,
      rotationCursor: 0,
      lastPlannedMinutes: 0,
    },
    onboarding: { completed: true, step: 6 },
    ...overrides,
  }
}

function loggedSet(overrides: Partial<LoggedSet> = {}): LoggedSet {
  return {
    prescribedReps: 3,
    isAmrap: false,
    weight: { value: 100, unit: 'kg' },
    phase: 'untouched',
    completedReps: null,
    ...overrides,
  }
}

describe('buildStrengthPlan', () => {
  it('prescribes the day found by NAME, with the state weight winning over the program seed', () => {
    const plan = buildStrengthPlan(profile(), 'A1')

    expect(plan.diagnostics).toEqual([])
    expect(plan.exercises.map((exercise) => exercise.key)).toEqual(['T1:Squat', 'T2:Bench Press', 'T3:Lat Pulldown'])
    expect(plan.exercises[0].sets).toHaveLength(5)
    // 105 kg from `programState`, not the 100 kg written in the program text.
    expect(plan.exercises[0].sets[0].weight).toEqual({ value: 105, unit: 'kg' })
    expect(plan.exercises[0].workingWeight).toEqual({ value: 105, unit: 'kg' })
  })

  it('resolves the slot for a day that is not the first one', () => {
    const plan = buildStrengthPlan(profile(), 'B2')

    expect(plan.diagnostics).toEqual([])
    expect(plan.day).toBe(4)
    expect(plan.exercises.length).toBeGreaterThan(0)
  })

  it('marks only the last set of a "+"-terminated group as an AMRAP', () => {
    const plan = buildStrengthPlan(profile(), 'A1')
    const squat = plan.exercises[0]

    expect(squat.sets.map((set) => set.isAmrap)).toEqual([false, false, false, false, true])
  })

  it('carries the rest default per tier from the profile settings', () => {
    const plan = buildStrengthPlan(profile(), 'A1')

    expect(plan.exercises.map((exercise) => exercise.defaultRestSec)).toEqual([200, 130, 70])
  })

  it('renders warmups for T1/T2 and none for a "warmup: none" T3', () => {
    const plan = buildStrengthPlan(profile(), 'A1')

    expect(plan.exercises[0].warmup.length).toBeGreaterThan(0)
    expect(plan.exercises[2].warmup).toEqual([])
  })

  it('asks for a weight when the state has none, and reports no working weight', () => {
    const bare = profile()
    bare.strengthTrack.programState = {
      ...bare.strengthTrack.programState,
      'T1:Squat': { weights: [], setVariationIndex: 1, state: { inc: 5 }, askWeight: true },
    }

    const squat = buildStrengthPlan(bare, 'A1').exercises[0]

    expect(squat.askWeight).toBe(true)
    expect(squat.workingWeight).toBeNull()
  })

  it('flags plate hints only for barbell lifts', () => {
    const plan = buildStrengthPlan(profile(), 'A1')

    expect(plan.exercises[0].showPlates).toBe(true) // Squat
    expect(plan.exercises[2].showPlates).toBe(false) // Lat Pulldown, a machine
  })

  it('returns program diagnostics and no exercises when the program does not parse', () => {
    const broken = profile()
    broken.strengthTrack.programText = '# Week 1\n## A1\nT1: Squat / 5x3+ / progress: nonsense(1,2,3)\n'

    const plan = buildStrengthPlan(broken, 'A1')

    expect(plan.diagnostics.length).toBeGreaterThan(0)
    expect(plan.exercises).toEqual([])
  })

  it('reports a day that is not in the program instead of prescribing another one', () => {
    const plan = buildStrengthPlan(profile(), 'C7')

    expect(plan.exercises).toEqual([])
    expect(plan.diagnostics[0].message).toContain('C7')
  })
})

describe('draftFromPlan', () => {
  it('writes working sets only, untouched, with the tier on every line', () => {
    const plan = buildStrengthPlan(profile(), 'A1')
    const draft = draftFromPlan(plan, '2026-08-27')

    expect(draft.date).toBe('2026-08-27')
    expect(draft.kind).toBe('strength')
    expect(draft.programDay).toBe('A1')
    expect(draft.exercises?.map((exercise) => exercise.tier)).toEqual([1, 2, 3])
    expect(draft.exercises?.[0].sets).toHaveLength(plan.exercises[0].sets.length)
    expect(draft.exercises?.[0].sets.every((set) => set.completedReps === null)).toBe(true)
  })

  it('omits readiness rather than writing undefined, which Firestore rejects', () => {
    const plan = buildStrengthPlan(profile(), 'A1')

    expect('readiness' in draftFromPlan(plan, '2026-08-27')).toBe(false)
    expect(draftFromPlan(plan, '2026-08-27', { sleep: 2, energy: 3, soreness: 1 }).readiness).toEqual({
      sleep: 2,
      energy: 3,
      soreness: 1,
    })
  })
})

describe('loggedSetsFromSession / applyLoggedSets', () => {
  const session: Session = {
    id: 's1',
    uid: 'u1',
    date: '2026-08-27',
    kind: 'strength',
    status: 'active',
    programDay: 'A1',
    exercises: [
      {
        name: 'Squat',
        tier: 1,
        sets: [
          { prescribedReps: 3, isAmrap: false, completedReps: 3, weight: { value: 105, unit: 'kg' } },
          { prescribedReps: 3, isAmrap: false, completedReps: null, weight: { value: 105, unit: 'kg' } },
        ],
      },
    ],
  }

  it('rehydrates a done set and leaves a null one untouched', () => {
    const logged = loggedSetsFromSession(session)

    expect(logged[0][0]).toMatchObject({ phase: 'done', completedReps: 3 })
    expect(logged[0][1]).toMatchObject({ phase: 'untouched', completedReps: null })
  })

  it('projects skipped and untouched back to the same null the model has', () => {
    const logged = loggedSetsFromSession(session)
    logged[0][1] = { ...logged[0][1], phase: 'skipped' }

    const projected = applyLoggedSets(session, logged)

    expect(projected.exercises?.[0].sets[1].completedReps).toBeNull()
    // Untouched sets are NOT dropped: a set you did not do is a failed session.
    expect(projected.exercises?.[0].sets).toHaveLength(2)
    expect(projected.id).toBe('s1')
  })
})

describe('restSecFor', () => {
  it('prefers an explicit program timer over the tier default', () => {
    const plan = buildStrengthPlan(profile(), 'A1')
    const exercise = { ...plan.exercises[0] }
    exercise.sets = [{ ...exercise.sets[0], restTimerSec: 45 }, exercise.sets[1]]

    expect(restSecFor(exercise, 0)).toBe(45)
    expect(restSecFor(exercise, 1)).toBe(200)
  })
})

describe('applyWorkingWeight', () => {
  it('rewrites untouched sets and leaves logged ones at what was actually lifted', () => {
    const sets = [loggedSet({ phase: 'done', completedReps: 3 }), loggedSet({ phase: 'skipped' }), loggedSet()]

    const next = applyWorkingWeight(sets, { value: 110, unit: 'kg' })

    expect(next[0].weight.value).toBe(100)
    expect(next[1].weight.value).toBe(100)
    expect(next[2].weight.value).toBe(110)
  })
})

describe('applyWorkingWeight and finishBlockedReason together', () => {
  const kg = (value: number) => ({ value, unit: 'kg' as const })

  const setAt = (weight: number, phase: 'untouched' | 'logged') => ({
    prescribedReps: 15,
    isAmrap: false,
    completedReps: phase === 'logged' ? 15 : null,
    weight: kg(weight),
    phase,
    restSec: 60,
  })

  it('fixes a logged set that never had a weight', () => {
    // The screen stops a row of a weightless lift from being tapped at all, so
    // this state is not reachable through the UI today. It is pinned because the
    // alternative — leaving a logged set at zero — is a session that can only be
    // deleted, and that is what the two rules produce between them if that guard
    // ever moves.
    const sets = [setAt(0, 'logged'), setAt(0, 'untouched')] as never

    const fixed = applyWorkingWeight(sets, kg(40))

    expect(fixed.map((set) => set.weight.value)).toEqual([40, 40])
    expect(fixed[0].completedReps).toBe(15)
  })

  it('still refuses to rewrite a set logged at a real weight', () => {
    const sets = [setAt(35, 'logged'), setAt(0, 'untouched')] as never

    expect(applyWorkingWeight(sets, kg(40)).map((set) => set.weight.value)).toEqual([35, 40])
  })
})

describe('finishBlockedReason', () => {
  const plan = buildStrengthPlan(profile(), 'A1')

  it('names the exercise whose weight is still missing', () => {
    const logged = plan.exercises.map((exercise) => exercise.sets.map(() => loggedSet()))
    logged[1][0] = loggedSet({ weight: { value: 0, unit: 'kg' } })

    expect(finishBlockedReason(plan, logged)).toBe('Enter a weight for Bench Press')
  })

  it('blocks a session with nothing logged at all', () => {
    const logged = plan.exercises.map((exercise) => exercise.sets.map(() => loggedSet()))

    expect(finishBlockedReason(plan, logged)).toBe('Log at least one set before finishing')
  })

  it('allows a partially logged session — an untouched set is a miss, not an error', () => {
    const logged = plan.exercises.map((exercise) => exercise.sets.map(() => loggedSet()))
    logged[0][0] = loggedSet({ phase: 'done', completedReps: 1 })

    expect(finishBlockedReason(plan, logged)).toBeNull()
  })
})
