import type { BodyweightEntry, ComposedWeek, Profile, Session, SetLog } from '@/types'

import {
  bestSetFor,
  bodyweightTrend,
  cardioCompletionRatio,
  currentStreak,
  detectNewRecords,
  estimatedOneRepMax,
  personalRecords,
  sessionExerciseKey,
  weeklyCardioMinutes,
  weeklyRollup,
  weeklyTonnage,
} from '../stats'

const WEEK = '2026-08-17' // Monday

function set(kg: number, prescribed: number, completed: number | null, isAmrap = false): SetLog {
  return { prescribedReps: prescribed, isAmrap, completedReps: completed, weight: { value: kg, unit: 'kg' } }
}

function strength(id: string, date: string, sets: SetLog[], overrides: Partial<Session> = {}): Session {
  return {
    id,
    uid: 'u1',
    date,
    kind: 'strength',
    status: 'done',
    programDay: 'A1',
    exercises: [{ name: 'Squat', tier: 1, sets }],
    ...overrides,
  }
}

function cardio(id: string, date: string, minutes: number, overrides: Partial<Session> = {}): Session {
  return { id, uid: 'u1', date, kind: 'cardio', status: 'done', minutes, ...overrides }
}

const profile: Profile = {
  id: 'u1',
  email: 'a@b.c',
  settings: {
    units: 'kg',
    barbellWeight: 20,
    plates: [{ weight: 20, count: 2 }],
    restTimers: { t1: 180, t2: 120, t3: 60 },
    comebackGapDays: 10,
    notifications: { daily: true, gapNudge: true },
    fcmTokens: [],
  },
  availability: { daysPerWeek: 5, preferredDays: [0, 1, 2, 4, 5], longSessionDay: 5 },
  strengthTrack: { goal: { type: 'open' }, programText: '', programState: {}, rotationCursor: 0 },
  cardioTrack: {
    goal: { type: 'open' },
    modalities: ['run'],
    weeklyMinutes: 120,
    longestSessionMinutes: 60,
    mesoWeek: 1,
    mesoStartDate: WEEK,
    holdStreak: 0,
    rotationCursor: 0,
    lastPlannedMinutes: 0,
  },
  onboarding: { completed: true, step: 6 },
}

describe('sessionExerciseKey', () => {
  it('rebuilds the engine key from a logged exercise', () => {
    expect(sessionExerciseKey({ name: 'Squat', tier: 1 })).toBe('T1:Squat')
    expect(sessionExerciseKey({ name: 'Squat' })).toBe('Squat')
  })
})

describe('estimatedOneRepMax', () => {
  it('uses Epley from the engine', () => {
    expect(estimatedOneRepMax(set(100, 5, 5))?.value).toBeCloseTo(116.6667, 3)
  })

  it('is null for an untouched or skipped set', () => {
    expect(estimatedOneRepMax(set(100, 5, null))).toBeNull()
    expect(estimatedOneRepMax(set(100, 5, 0))).toBeNull()
  })
})

describe('bestSetFor', () => {
  const sessions = [
    strength('s1', '2026-08-17', [set(100, 5, 5)]),
    strength('s2', '2026-08-19', [set(110, 3, 3)]),
    strength('s3', '2026-08-21', [set(120, 1, null)]),
  ]

  it('ranks by estimated 1RM, not by bar weight alone', () => {
    const best = bestSetFor(sessions, 'T1:Squat')

    expect(best?.date).toBe('2026-08-19')
    expect(best?.e1rm?.value).toBeCloseTo(121, 5)
  })

  it('is null for an exercise that was never logged', () => {
    expect(bestSetFor(sessions, 'T2:Bench Press')).toBeNull()
  })

  it('ignores unfinished sessions', () => {
    const withActive = [...sessions, strength('s4', '2026-08-22', [set(200, 1, 1)], { status: 'active' })]

    expect(bestSetFor(withActive, 'T1:Squat')?.date).toBe('2026-08-19')
  })
})

describe('personalRecords', () => {
  it('tracks best weight, best e1RM and best AMRAP reps with their dates', () => {
    const records = personalRecords([
      strength('s1', '2026-08-17', [set(100, 5, 5), set(100, 5, 9, true)]),
      strength('s2', '2026-08-19', [set(105, 3, 3), set(105, 3, 6, true)]),
    ])
    const squat = records['T1:Squat']

    expect(squat.bestWeight).toEqual({ weight: { value: 105, unit: 'kg' }, reps: 3, date: '2026-08-19' })
    expect(squat.bestE1rm?.date).toBe('2026-08-17') // 100 x 9 = 130 beats 105 x 6 = 126
    expect(squat.bestAmrapReps).toEqual({ reps: 9, weight: { value: 100, unit: 'kg' }, date: '2026-08-17' })
  })
})

describe('detectNewRecords', () => {
  const history = [strength('s1', '2026-08-17', [set(100, 5, 5), set(100, 5, 8, true)])]

  it('reports only the records the session actually beat', () => {
    const session = strength('s2', '2026-08-19', [set(105, 5, 5), set(105, 5, 5, true)])
    const found = detectNewRecords([...history, session], session)

    // Heavier bar, but 105x5 (e1RM 122.5) stays under the old 100x8 (126.7) and 5 AMRAP reps under 8.
    expect(found.map((record) => record.kind)).toEqual(['weight'])
    expect(found[0]).toMatchObject({
      exerciseKey: 'T1:Squat',
      value: { value: 105, unit: 'kg' },
      previous: { value: 100, unit: 'kg' },
      date: '2026-08-19',
    })
  })

  it('reports nothing when the session matched but did not beat the previous best', () => {
    const session = strength('s2', '2026-08-19', [set(100, 5, 5), set(100, 5, 8, true)])

    expect(detectNewRecords([...history, session], session)).toEqual([])
  })

  it('reports every first-ever record with no previous value', () => {
    const session = strength('s1', '2026-08-17', [set(100, 5, 8, true)])
    const found = detectNewRecords([], session)

    expect(found.map((record) => record.kind).sort()).toEqual(['amrapReps', 'e1rm', 'weight'])
    expect(found.every((record) => record.previous === null)).toBe(true)
  })

  it('ignores later sessions when deciding what the previous best was', () => {
    const session = strength('s2', '2026-08-19', [set(105, 5, 5)])
    const future = strength('s3', '2026-08-26', [set(200, 5, 5)])

    expect(detectNewRecords([...history, session, future], session).map((record) => record.kind)).toEqual(['weight'])
  })
})

describe('weekly volume', () => {
  const sessions = [
    strength('s1', '2026-08-17', [set(100, 5, 5), set(100, 5, 4), set(100, 5, null)]),
    strength('s2', '2026-08-24', [set(100, 5, 5)]), // next week
    cardio('c1', '2026-08-18', 45),
    cardio('c2', '2026-08-20', 35),
    cardio('c3', '2026-08-24', 60), // next week
    cardio('c4', '2026-08-21', 30, { status: 'active' }),
  ]

  it('sums weight x completed reps inside the week only', () => {
    expect(weeklyTonnage(sessions, WEEK)).toEqual({ value: 900, unit: 'kg' })
    expect(weeklyTonnage(sessions, '2026-08-24')).toEqual({ value: 500, unit: 'kg' })
  })

  it('sums completed cardio minutes of the week', () => {
    expect(weeklyCardioMinutes(sessions, WEEK)).toBe(80)
  })

  it('divides done minutes by the target', () => {
    expect(cardioCompletionRatio(sessions, WEEK, 100)).toBe(0.8)
    expect(cardioCompletionRatio(sessions, WEEK, 0)).toBe(1)
  })
})

describe('currentStreak', () => {
  it('counts consecutive weeks with at least one session', () => {
    const sessions = [cardio('c1', '2026-08-10', 30), cardio('c2', '2026-08-19', 30)]

    expect(currentStreak(sessions, '2026-08-21')).toBe(2)
  })

  it('keeps the streak alive across the week boundary while the new week is empty', () => {
    const sessions = [cardio('c1', '2026-08-16', 30), cardio('c2', '2026-08-23', 30)]

    // Sunday, then Monday of the next (still empty) week — the streak holds.
    expect(currentStreak(sessions, '2026-08-23')).toBe(2)
    expect(currentStreak(sessions, '2026-08-24')).toBe(2)
  })

  it('breaks once a whole week passes with nothing logged', () => {
    const sessions = [cardio('c1', '2026-08-23', 30)]

    expect(currentStreak(sessions, '2026-08-31')).toBe(0)
  })

  it('is zero without any completed session', () => {
    expect(currentStreak([cardio('c1', '2026-08-19', 30, { status: 'active' })], '2026-08-21')).toBe(0)
  })
})

describe('bodyweightTrend', () => {
  const entries: BodyweightEntry[] = [
    { id: 'b3', uid: 'u1', date: '2026-08-19', weight: 82 },
    { id: 'b1', uid: 'u1', date: '2026-08-17', weight: 80 },
    { id: 'b2', uid: 'u1', date: '2026-08-18', weight: 81 },
    { id: 'b4', uid: 'u1', date: '2026-08-25', weight: 90 },
  ]

  it('sorts the points and averages the trailing 7 days', () => {
    expect(bodyweightTrend(entries)).toEqual([
      { date: '2026-08-17', weight: 80, average: 80 },
      { date: '2026-08-18', weight: 81, average: 80.5 },
      { date: '2026-08-19', weight: 82, average: 81 },
      { date: '2026-08-25', weight: 90, average: 86 }, // only 08-19 is still inside the 7-day window
    ])
  })

  it('handles an empty history', () => {
    expect(bodyweightTrend([])).toEqual([])
  })
})

describe('weeklyRollup', () => {
  const sessions = [strength('s1', '2026-08-17', [set(100, 5, 5)]), cardio('c1', '2026-08-18', 45)]

  it('estimates planned days from availability when no composed week is given', () => {
    const rollup = weeklyRollup(profile, sessions, WEEK)

    expect(rollup).toEqual({
      weekStart: WEEK,
      strength: { planned: 3, done: 1 },
      cardio: { planned: 2, done: 1, plannedMinutes: 120, doneMinutes: 45 },
      tonnage: { value: 500, unit: 'kg' },
    })
  })

  it('prefers the composed week as the authority on what was planned', () => {
    const composed: ComposedWeek = {
      weekStart: WEEK,
      days: [
        { date: '2026-08-17', planned: { kind: 'strength', programDay: 'A1' } },
        {
          date: '2026-08-18',
          planned: { kind: 'cardio', prescription: { modality: 'run', kind: 'easy', targetMinutes: 40, zone: 2 } },
        },
        { date: '2026-08-19', planned: null },
      ],
    }
    const rollup = weeklyRollup(profile, sessions, WEEK, composed)

    expect(rollup.strength.planned).toBe(1)
    expect(rollup.cardio).toEqual({ planned: 1, done: 1, plannedMinutes: 40, doneMinutes: 45 })
  })
})
