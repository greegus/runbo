import type { Profile, Session } from '@/types'

import { planCardioWeek } from '../cardioPlan'
import {
  applyComeback,
  CARDIO_FACTOR,
  comebackFactorsForWeek,
  daysSinceLastSession,
  proposeComeback,
  STRENGTH_FACTOR,
} from '../comeback'

const TODAY = '2026-08-24' // Monday

function cardio(id: string, date: string, minutes: number, status: Session['status'] = 'done'): Session {
  return { id, uid: 'u1', date, kind: 'cardio', status, minutes }
}

function strengthSession(id: string, date: string, status: Session['status'] = 'done'): Session {
  return { id, uid: 'u1', date, kind: 'strength', status, programDay: 'A1', exercises: [] }
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'u1',
    email: 'a@b.c',
    settings: {
      units: 'kg',
      barbellWeight: 20,
      plates: [
        { weight: 25, count: 2 },
        { weight: 20, count: 2 },
        { weight: 10, count: 2 },
        { weight: 5, count: 2 },
        { weight: 2.5, count: 2 },
        { weight: 1.25, count: 2 },
      ],
      restTimers: { t1: 180, t2: 120, t3: 60 },
      comebackGapDays: 10,
      notifications: { daily: true, gapNudge: true },
      fcmTokens: [],
    },
    availability: { daysPerWeek: 5, preferredDays: [0, 1, 2, 4, 5], longSessionDay: 5 },
    strengthTrack: {
      goal: { type: 'open' },
      programText: '',
      programState: {
        'T1:Squat': { weights: [{ value: 100, unit: 'kg' }], setVariationIndex: 2, state: { inc: 5 } },
        'T2:Bench Press': { weights: [{ value: 60, unit: 'kg' }], setVariationIndex: 1, state: {} },
        'T3:Lat Pulldown': { weights: [{ value: 40, unit: 'kg' }], setVariationIndex: 1, state: {}, askWeight: true },
      },
      rotationCursor: 1,
    },
    cardioTrack: {
      goal: { type: 'open' },
      modalities: ['run', 'bike'],
      weeklyMinutes: 150,
      longestSessionMinutes: 60,
      mesoWeek: 3,
      mesoStartDate: '2026-07-27',
      holdStreak: 0,
      rotationCursor: 0,
      lastPlannedMinutes: 150,
    },
    onboarding: { completed: true, step: 6 },
    ...overrides,
  }
}

describe('daysSinceLastSession', () => {
  it('measures from the most recent completed session', () => {
    const sessions = [cardio('c1', '2026-08-01', 30), strengthSession('s1', '2026-08-12')]

    expect(daysSinceLastSession(sessions, TODAY)).toBe(12)
  })

  it('ignores unfinished and future sessions', () => {
    const sessions = [strengthSession('s1', '2026-08-12'), strengthSession('s2', '2026-08-23', 'active')]

    expect(daysSinceLastSession(sessions, TODAY)).toBe(12)
    expect(daysSinceLastSession([strengthSession('s3', '2026-09-01')], TODAY)).toBeNull()
  })

  it('is null without any history', () => {
    expect(daysSinceLastSession([], TODAY)).toBeNull()
  })
})

describe('comebackFactorsForWeek', () => {
  it('ramps from the reduced factors back to normal over two weeks', () => {
    expect(comebackFactorsForWeek(1)).toEqual({ strength: STRENGTH_FACTOR, cardio: CARDIO_FACTOR })
    expect(comebackFactorsForWeek(2)).toEqual({ strength: 0.95, cardio: 0.85 })
    expect(comebackFactorsForWeek(3)).toEqual({ strength: 1, cardio: 1 })
  })
})

describe('proposeComeback', () => {
  const sessions = [cardio('c1', '2026-08-10', 60), cardio('c2', '2026-08-11', 40), strengthSession('s1', '2026-08-12')]

  it('is null when the gap is under the configured threshold', () => {
    expect(proposeComeback(makeProfile(), [...sessions, strengthSession('s2', '2026-08-20')], TODAY)).toBeNull()
  })

  it('is null without any history to come back from', () => {
    expect(proposeComeback(makeProfile(), [], TODAY)).toBeNull()
  })

  it('honours a custom threshold', () => {
    const profile = makeProfile()
    profile.settings.comebackGapDays = 20

    expect(proposeComeback(profile, sessions, TODAY)).toBeNull()
  })

  it('drops known working weights to 90 % and keeps the stage', () => {
    const proposal = proposeComeback(makeProfile(), sessions, TODAY)

    expect(proposal).not.toBeNull()
    expect(proposal?.daysSinceLastSession).toBe(12)
    expect(proposal?.lastSessionDate).toBe('2026-08-12')
    expect(proposal?.strength).toEqual([
      {
        exerciseKey: 'T1:Squat',
        from: { value: 100, unit: 'kg' },
        to: { value: 90, unit: 'kg' },
        setVariationIndex: 2,
      },
      {
        exerciseKey: 'T2:Bench Press',
        from: { value: 60, unit: 'kg' },
        to: { value: 55, unit: 'kg' }, // 54 rounded onto the plates the user owns
        setVariationIndex: 1,
      },
    ])
  })

  it('takes cardio to 70 % of the last week that actually happened', () => {
    const proposal = proposeComeback(makeProfile(), sessions, TODAY)

    expect(proposal?.cardio).toEqual({ fromWeeklyMinutes: 100, toWeeklyMinutes: 70 })
    expect(proposal?.summary.length).toBeGreaterThan(0)
  })

  it('falls back to the planned baseline when no cardio was logged', () => {
    const proposal = proposeComeback(makeProfile(), [strengthSession('s1', '2026-08-12')], TODAY)

    expect(proposal?.cardio).toEqual({ fromWeeklyMinutes: 150, toWeeklyMinutes: 105 })
  })
})

describe('applyComeback', () => {
  const sessions = [cardio('c1', '2026-08-10', 60), cardio('c2', '2026-08-11', 40), strengthSession('s1', '2026-08-12')]

  it('returns the reduced state without touching the profile', () => {
    const profile = makeProfile()
    const before = structuredClone(profile)
    const proposal = proposeComeback(profile, sessions, TODAY)!

    const { programState, cardioTrack } = applyComeback(profile, proposal)

    expect(profile).toEqual(before)
    expect(programState['T1:Squat']).toEqual({
      weights: [{ value: 90, unit: 'kg' }],
      setVariationIndex: 2,
      state: { inc: 5 },
    })
    // Ask-weight exercises have no weight to reduce and are carried over as-is.
    expect(programState['T3:Lat Pulldown']).toEqual(profile.strengthTrack.programState['T3:Lat Pulldown'])
    expect(cardioTrack).toEqual({
      ...profile.cardioTrack,
      weeklyMinutes: 70,
      mesoWeek: 1,
      // A fresh block on the Monday of the week the athlete came back in.
      // `mesoStartDate` is left exactly as the interrupted block wrote it.
      blockStartDate: '2026-08-24',
      lastPlannedMinutes: 70,
      holdStreak: 0,
    })
  })

  it('clears the counters the interrupted block left behind', () => {
    // The first week back is always a "missed" week — nothing was logged during
    // the gap — so the adaptive branch runs on whatever these two fields say.
    // Carrying them over would hold the comeback week at the pre-gap volume and
    // then step the baseline back another 10 % on top of the comeback's 70 %.
    const profile = makeProfile({
      cardioTrack: { ...makeProfile().cardioTrack, lastPlannedMinutes: 233, holdStreak: 1 },
    })
    const { cardioTrack } = applyComeback(profile, proposeComeback(profile, sessions, TODAY)!)

    expect(cardioTrack.lastPlannedMinutes).toBe(70)
    expect(cardioTrack.holdStreak).toBe(0)

    const held = planCardioWeek(cardioTrack, 0, 2)

    expect(held.weeklyMinutes).toBe(70)
    expect(held.nextBaseline).toBe(70)
  })

  it('is applied only on demand — proposing changes nothing by itself', () => {
    const profile = makeProfile()
    const before = structuredClone(profile)

    proposeComeback(profile, sessions, TODAY)

    expect(profile).toEqual(before)
  })
})
