import { buildGzclpProgram, initialProgramState } from '@/training/gzclp'
import type { Profile } from '@/types'

import { advancePatch, completePatch, LAST_STEP, normalizeStep, skipPatch, stepPatch } from '../wizard'

const PROGRAM_TEXT = buildGzclpProgram({})

function profile(): Profile {
  return {
    id: 'u1',
    email: 'a@b.c',
    settings: {
      units: 'kg',
      barbellWeight: 20,
      plates: [{ weight: 20, count: 2 }],
      restTimers: { t1: 180, t2: 120, t3: 60 },
      comebackGapDays: 10,
      notifications: { daily: false, gapNudge: false },
      fcmTokens: [],
    },
    availability: { daysPerWeek: 4, preferredDays: [0, 2, 4], longSessionDay: 5 },
    strengthTrack: {
      goal: { type: 'open' },
      programText: PROGRAM_TEXT,
      programState: initialProgramState(PROGRAM_TEXT, {}),
      rotationCursor: 0,
    },
    cardioTrack: {
      goal: { type: 'open' },
      modalities: ['run'],
      weeklyMinutes: 90,
      longestSessionMinutes: 40,
      mesoWeek: 2,
      mesoStartDate: '2026-08-17',
      holdStreak: 1,
      rotationCursor: 0,
      lastPlannedMinutes: 80,
      zones: { hr: { max: 190 } },
    },
    onboarding: { completed: false, step: 3 },
  }
}

describe('normalizeStep', () => {
  it('keeps every in-range step', () => {
    for (const step of [0, 1, 2, 3, 4, 5, 6]) {
      expect(normalizeStep(String(step))).toBe(step)
    }
  })

  it('lands a non-numeric param on the first real question', () => {
    for (const raw of ['abc', '', null, undefined, NaN, {}]) {
      expect(normalizeStep(raw)).toBe(1)
    }
  })

  it('clamps out-of-range params', () => {
    expect(normalizeStep('-1')).toBe(0)
    expect(normalizeStep('-99')).toBe(0)
    expect(normalizeStep('7')).toBe(6)
    expect(normalizeStep('999')).toBe(6)
  })

  it('floors a fractional param', () => {
    expect(normalizeStep('2.7')).toBe(2)
    expect(normalizeStep('0.9')).toBe(0)
  })
})

describe('stepPatch', () => {
  it('commits nothing on the welcome and review steps', () => {
    expect(stepPatch(0, profile())).toEqual({})
    expect(stepPatch(6, profile())).toEqual({})
  })

  it('commits whole slices, keeping the fields no form touches', () => {
    const draft = profile()

    expect(stepPatch(1, draft).settings).toEqual(draft.settings)
    expect(stepPatch(1, draft).settings?.restTimers).toEqual({ t1: 180, t2: 120, t3: 60 })
    expect(stepPatch(2, draft).strengthTrack).toEqual(draft.strengthTrack)
    expect(stepPatch(5, draft).availability).toEqual(draft.availability)
  })

  it('commits the same whole cardio slice from both cardio steps', () => {
    const draft = profile()

    expect(stepPatch(3, draft)).toEqual({ cardioTrack: draft.cardioTrack })
    expect(stepPatch(4, draft)).toEqual({ cardioTrack: draft.cardioTrack })
    expect(stepPatch(4, draft).cardioTrack?.mesoStartDate).toBe('2026-08-17')
    expect(stepPatch(3, draft).cardioTrack?.zones).toEqual({ hr: { max: 190 } })
  })

  it('never carries the onboarding field — that is `advancePatch`', () => {
    expect(stepPatch(1, profile())).not.toHaveProperty('onboarding')
  })
})

describe('the onboarding patches', () => {
  it('advances without completing', () => {
    expect(advancePatch(4)).toEqual({ onboarding: { completed: false, step: 4 } })
  })

  it('completes on skip and on finish alike', () => {
    expect(skipPatch()).toEqual({ onboarding: { completed: true, step: LAST_STEP } })
    expect(completePatch()).toEqual({ onboarding: { completed: true, step: LAST_STEP } })
  })

  it('merges with a step patch into a single write', () => {
    const draft = profile()
    const patch = { ...stepPatch(3, draft), ...advancePatch(4) }

    expect(patch).toEqual({ cardioTrack: draft.cardioTrack, onboarding: { completed: false, step: 4 } })
  })
})
