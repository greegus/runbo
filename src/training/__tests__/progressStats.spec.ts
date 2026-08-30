import type { Profile, Session, SetLog } from '@/types'

import { liftCatalogue, liftProgress, readinessSplit, recordRows, weeklySeries } from '../progressStats'

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

function cardio(id: string, date: string, minutes: number): Session {
  return { id, uid: 'u1', date, kind: 'cardio', status: 'done', minutes }
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
    blockStartDate: WEEK,
    holdStreak: 0,
    rotationCursor: 0,
    lastPlannedMinutes: 0,
  },
  onboarding: { completed: true, step: 6 },
}

describe('liftProgress', () => {
  it('reports the heaviest bar and the best estimate of each day, oldest first', () => {
    const sessions = [
      strength('s2', '2026-08-19', [set(105, 3, 3)]),
      strength('s1', '2026-08-17', [set(100, 5, 5), set(100, 5, 2)]),
    ]

    const points = liftProgress(sessions, 'T1:Squat')

    expect(points.map((point) => point.date)).toEqual(['2026-08-17', '2026-08-19'])
    expect(points[0].workingWeight.value).toBe(100)
    expect(points[0].reps).toBe(5)
    expect(points[0].e1rm.value).toBeCloseTo(116.6667, 3)
  })

  it('collapses two sessions on one day, taking the better of each axis', () => {
    const sessions = [strength('s1', '2026-08-17', [set(120, 1, 1)]), strength('s2', '2026-08-17', [set(100, 10, 10)])]

    const [point] = liftProgress(sessions, 'T1:Squat')

    // The two axes are independent: heaviest bar from the single, best
    // estimate from the set of ten.
    expect(point.workingWeight.value).toBe(120)
    expect(point.e1rm.value).toBeCloseTo(133.3333, 3)
    expect(point.reps).toBe(10)
  })

  it('ignores untouched, skipped, active and cardio work', () => {
    const sessions = [
      strength('s1', '2026-08-17', [set(100, 5, null)]),
      strength('s2', '2026-08-18', [set(100, 5, 0)]),
      strength('s3', '2026-08-19', [set(100, 5, 5)], { status: 'active' }),
      cardio('c1', '2026-08-20', 40),
    ]

    expect(liftProgress(sessions, 'T1:Squat')).toEqual([])
  })

  it('converts everything to one unit so the chart has one axis', () => {
    const sessions = [strength('s1', '2026-08-17', [{ ...set(100, 5, 5), weight: { value: 225, unit: 'lb' } }])]

    const [point] = liftProgress(sessions, 'T1:Squat', 'kg')

    expect(point.workingWeight.unit).toBe('kg')
    expect(point.workingWeight.value).toBeCloseTo(102.058, 2)
  })

  it('answers only for the key asked for', () => {
    const sessions = [
      strength('s1', '2026-08-17', [set(100, 5, 5)], {
        exercises: [
          { name: 'Squat', tier: 1, sets: [set(100, 5, 5)] },
          { name: 'Bench Press', tier: 2, sets: [set(60, 10, 10)] },
        ],
      }),
    ]

    expect(liftProgress(sessions, 'T2:Bench Press')[0].workingWeight.value).toBe(60)
    expect(liftProgress(sessions, 'T3:Nothing')).toEqual([])
  })
})

describe('weeklySeries', () => {
  it('returns the asked-for number of consecutive weeks, oldest first', () => {
    const points = weeklySeries(profile, [cardio('c1', '2026-08-19', 45)], WEEK, 3)

    expect(points).toHaveLength(3)
    expect(points.map((point) => point.weekStart)).toEqual(['2026-08-17', '2026-08-24', '2026-08-31'])
    expect(points[0].doneMinutes).toBe(45)
    expect(points[1].doneMinutes).toBe(0)
  })

  it('normalises the anchor back to Monday', () => {
    expect(weeklySeries(profile, [], '2026-08-20', 1)[0].weekStart).toBe(WEEK)
  })

  it('reports what the whole week asked for, not what is left of it', () => {
    // Composed without a frontier: a week already gone still reports its plan.
    expect(weeklySeries(profile, [], WEEK, 1)[0].plannedMinutes).toBeGreaterThan(0)
  })

  it('is empty for a non-positive week count', () => {
    expect(weeklySeries(profile, [], WEEK, 0)).toEqual([])
    expect(weeklySeries(profile, [], WEEK, -3)).toEqual([])
  })
})

describe('liftCatalogue', () => {
  const withProgram: Profile = {
    ...profile,
    strengthTrack: {
      ...profile.strengthTrack,
      programState: {
        'T1:Squat': { weights: [{ value: 100, unit: 'kg' }], setVariationIndex: 1, state: {} },
        'T3:Lat Pulldown': { weights: [{ value: 40, unit: 'kg' }], setVariationIndex: 1, state: {} },
      },
    },
  }

  it('unions the program and the log, and counts DAYS not sessions', () => {
    const sessions = [
      strength('s1', '2026-08-17', [set(100, 5, 5)]),
      strength('s2', '2026-08-17', [set(105, 3, 3)]),
      strength('s3', '2026-08-19', [set(100, 5, 5)], {
        exercises: [{ name: 'Bent Over Row', tier: 2, sets: [set(60, 10, 10)] }],
      }),
    ]

    const catalogue = liftCatalogue(withProgram, sessions)

    // Both trained lifts stand at one day; the tie breaks on the label, and
    // the never-trained one sorts last whatever its name.
    expect(catalogue.map((choice) => choice.key)).toEqual(['T2:Bent Over Row', 'T1:Squat', 'T3:Lat Pulldown'])
    expect(catalogue[1]).toEqual({ key: 'T1:Squat', label: 'Squat (T1)', sessionCount: 1 })
  })

  it('keeps a never-trained lift, reports zero and sorts it last', () => {
    const catalogue = liftCatalogue(withProgram, [])

    expect(catalogue.every((choice) => choice.sessionCount === 0)).toBe(true)
    expect(catalogue.map((choice) => choice.label)).toEqual(['Lat Pulldown (T3)', 'Squat (T1)'])
  })

  it('labels a key with no tier by its canonical name', () => {
    const sessions = [
      strength('s1', '2026-08-17', [set(100, 5, 5)], {
        exercises: [{ name: 'Back Squat', sets: [set(100, 5, 5)] }],
      }),
    ]

    expect(liftCatalogue(profile, sessions)[0].label).toBe('Squat')
  })

  it('does not count a session whose sets were all skipped', () => {
    const catalogue = liftCatalogue(withProgram, [strength('s1', '2026-08-17', [set(100, 5, null)])])

    expect(catalogue.find((choice) => choice.key === 'T1:Squat')?.sessionCount).toBe(0)
  })
})

describe('readinessSplit', () => {
  function scored(id: string, date: string, kg: number, reps: number, readiness: Session['readiness']): Session {
    return strength(id, date, [set(kg, reps, reps)], { readiness })
  }

  it('splits mean tonnage by band and names the count it is built on', () => {
    const sessions = [
      scored('s1', '2026-08-17', 100, 5, { sleep: 5, energy: 5, soreness: 5 }), // good, 500
      scored('s2', '2026-08-19', 60, 5, { sleep: 2, energy: 2, soreness: 2 }), // poor, 300
      strength('s3', '2026-08-21', [set(200, 5, 5)]), // no readiness answer
    ]

    const split = readinessSplit(profile, sessions)

    expect(split.scoredSessions).toBe(2)
    expect(split.highMeanTonnage).toEqual({ value: 500, unit: 'kg' })
    expect(split.lowMeanTonnage).toEqual({ value: 300, unit: 'kg' })
    expect(split.bestBand).toBe('good')
    expect(split.meanReadiness).toBe(10.5)
  })

  it('returns nulls, not zeros, for an empty bucket', () => {
    const split = readinessSplit(profile, [scored('s1', '2026-08-17', 100, 5, { sleep: 5, energy: 5, soreness: 5 })])

    expect(split.highMeanTonnage).toEqual({ value: 500, unit: 'kg' })
    expect(split.lowMeanTonnage).toBeNull()
  })

  it('survives a series with no readiness at all', () => {
    expect(readinessSplit(profile, [strength('s1', '2026-08-17', [set(100, 5, 5)])])).toEqual({
      scoredSessions: 0,
      highMeanTonnage: null,
      lowMeanTonnage: null,
      meanReadiness: null,
      bestBand: null,
    })
  })
})

describe('recordRows', () => {
  it('flattens the records newest first, formatted', () => {
    const sessions = [
      strength('s1', '2026-08-17', [set(100, 5, 5), set(100, 5, 9, true)]),
      strength('s2', '2026-08-24', [set(110, 3, 3)]),
    ]

    const rows = recordRows(sessions)

    expect(rows[0]).toEqual({
      id: 'T1:Squat:weight',
      exerciseKey: 'T1:Squat',
      lift: 'Squat',
      kind: 'weight',
      label: 'Best weight',
      value: '110 kg × 3',
      date: '2026-08-24',
    })
    expect(rows.map((row) => row.kind)).toEqual(['weight', 'e1rm', 'amrapReps'])
    expect(rows[2].value).toBe('9 reps @ 100 kg')
  })

  it('reports every record in the athlete’s unit, not the unit the set was logged in', () => {
    const rows = recordRows([strength('s1', '2026-08-17', [set(100, 5, 5)])], 'lb')

    expect(rows.every((row) => row.value.includes('lb'))).toBe(true)
    expect(rows.every((row) => !row.value.includes('kg'))).toBe(true)
  })

  it('is empty when nothing was ever completed', () => {
    expect(recordRows([])).toEqual([])
    expect(recordRows([strength('s1', '2026-08-17', [set(100, 5, null)])])).toEqual([])
  })
})
