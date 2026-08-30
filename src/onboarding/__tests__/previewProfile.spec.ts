import { GZCLP_PROGRAM_SOURCE } from '@/training/gzclp'
import { planWeek } from '@/training/schedule'
import type { Profile } from '@/types'

import { coerceProfileForPreview } from '../previewProfile'

const TODAY = '2026-08-27' // a Thursday
const MONDAY = '2026-08-24'

function profile(overrides: Partial<Profile> = {}): Profile {
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
    availability: { daysPerWeek: 5, preferredDays: [0, 1, 2, 4, 5], longSessionDay: 5, strengthDaysPerWeek: 3 },
    // A real program: the planner reads the rotation off this text, so an empty
    // one is not a well-formed profile — it is the case the coercion fills in.
    strengthTrack: { goal: { type: 'open' }, programText: GZCLP_PROGRAM_SOURCE, programState: {}, rotationCursor: 0 },
    cardioTrack: {
      goal: { type: 'open' },
      modalities: ['run'],
      weeklyMinutes: 60,
      longestSessionMinutes: 30,
      mesoWeek: 1,
      mesoStartDate: MONDAY,
      blockStartDate: MONDAY,
      holdStreak: 0,
      rotationCursor: 0,
      lastPlannedMinutes: 0,
    },
    onboarding: { completed: false, step: 5 },
    ...overrides,
  }
}

describe('coerceProfileForPreview', () => {
  it('leaves a well-formed profile alone', () => {
    const input = profile()

    expect(coerceProfileForPreview(input, TODAY)).toEqual(input)
  })

  it('never mutates its argument', () => {
    const input = profile({
      availability: { daysPerWeek: Number.NaN, preferredDays: [9], longSessionDay: -3 },
    })

    coerceProfileForPreview(input, TODAY)

    expect(input.availability).toEqual({ daysPerWeek: Number.NaN, preferredDays: [9], longSessionDay: -3 })
  })

  it('replaces non-finite and negative cardio numbers with the profile defaults', () => {
    const result = coerceProfileForPreview(
      profile({
        cardioTrack: {
          ...profile().cardioTrack,
          weeklyMinutes: Number.NaN,
          longestSessionMinutes: -10,
          mesoWeek: Number.NaN,
          holdStreak: Number.NaN,
          rotationCursor: -1,
          lastPlannedMinutes: Number.NaN,
        },
      }),
      TODAY,
    )

    expect(result.cardioTrack.weeklyMinutes).toBe(60)
    expect(result.cardioTrack.longestSessionMinutes).toBe(30)
    expect(result.cardioTrack.mesoWeek).toBe(1)
    expect(result.cardioTrack.holdStreak).toBe(0)
    expect(result.cardioTrack.rotationCursor).toBe(0)
    expect(result.cardioTrack.lastPlannedMinutes).toBe(0)
  })

  it('falls back to running when no modality is selected', () => {
    const result = coerceProfileForPreview(
      profile({ cardioTrack: { ...profile().cardioTrack, modalities: [] } }),
      TODAY,
    )

    expect(result.cardioTrack.modalities).toEqual(['run'])
  })

  it('replaces a missing or malformed mesoStartDate with this week Monday', () => {
    const malformed = coerceProfileForPreview(
      profile({ cardioTrack: { ...profile().cardioTrack, mesoStartDate: '2026-02-30' } }),
      TODAY,
    )
    const missing = coerceProfileForPreview(
      profile({ cardioTrack: { ...profile().cardioTrack, mesoStartDate: undefined as unknown as string } }),
      TODAY,
    )

    expect(malformed.cardioTrack.mesoStartDate).toBe(MONDAY)
    expect(missing.cardioTrack.mesoStartDate).toBe(MONDAY)
  })

  it('nulls a malformed block anchor rather than inventing one', () => {
    // An anchor the app made up would open a block the athlete has not trained a
    // day of; `null` is the state that says "no block yet", and the first
    // session opens one.
    const malformed = coerceProfileForPreview(
      profile({ cardioTrack: { ...profile().cardioTrack, blockStartDate: '2026-02-30' } }),
      TODAY,
    )
    const missing = coerceProfileForPreview(
      profile({ cardioTrack: { ...profile().cardioTrack, blockStartDate: undefined } }),
      TODAY,
    )

    expect(malformed.cardioTrack.blockStartDate).toBeNull()
    expect(missing.cardioTrack.blockStartDate).toBeNull()
  })

  it('clamps availability into range and de-duplicates preferred days', () => {
    const result = coerceProfileForPreview(
      profile({ availability: { daysPerWeek: 12, preferredDays: [5, 1, 1, -1, 7, 3.5], longSessionDay: 9 } }),
      TODAY,
    )

    expect(result.availability.daysPerWeek).toBe(7)
    expect(result.availability.preferredDays).toEqual([1, 5])
    expect(result.availability.longSessionDay).toBe(6)
    // Absent is the shape every profile written before the setting existed has;
    // it must read as the old hard-coded three, not as zero lifting days.
    expect(result.availability.strengthDaysPerWeek).toBe(3)

    const clamped = coerceProfileForPreview(
      profile({ availability: { daysPerWeek: 5, preferredDays: [0], longSessionDay: 5, strengthDaysPerWeek: 12 } }),
      TODAY,
    )

    expect(clamped.availability.strengthDaysPerWeek).toBe(7)
  })

  it('produces a profile planWeek can compose a full week from', () => {
    const broken = profile({
      availability: { daysPerWeek: Number.NaN, preferredDays: [], longSessionDay: Number.NaN },
      cardioTrack: {
        ...profile().cardioTrack,
        modalities: [],
        weeklyMinutes: Number.NaN,
        longestSessionMinutes: Number.NaN,
        mesoStartDate: 'not-a-date',
      },
    })

    const plan = planWeek(coerceProfileForPreview(broken, TODAY), [], TODAY)

    expect(plan.week.days).toHaveLength(7)
    expect(plan.week.days.some((day) => day.planned?.kind === 'strength')).toBe(true)
    expect(plan.week.days.some((day) => day.planned?.kind === 'cardio')).toBe(true)
  })
})
