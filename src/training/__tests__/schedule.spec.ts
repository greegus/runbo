import type { CardioPrescription, Profile, Session } from '@/types'
import { addDays } from '@/utils/date'

import { cardioOf, planWeek, resolveToday } from '../schedule'

const MON = '2026-08-24'
const TUE = '2026-08-25'
const WED = '2026-08-26'
const THU = '2026-08-27'
const FRI = '2026-08-28'
const SAT = '2026-08-29'
const SUN = '2026-08-30'

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'u1',
    email: 'a@b.c',
    settings: {
      units: 'kg',
      barbellWeight: 20,
      plates: [
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
        'T1:Squat': { weights: [{ value: 100, unit: 'kg' }], setVariationIndex: 1, state: {} },
      },
      rotationCursor: 0,
    },
    cardioTrack: {
      goal: { type: 'open' },
      modalities: ['run', 'bike'],
      weeklyMinutes: 150,
      // 90, not 60: with two cardio days a 150-minute week means 75-minute
      // sessions, and the planner refuses to prescribe past 110 % of the
      // longest session actually trained. A profile claiming 150 min/week off a
      // 60-minute longest is contradictory, and the shortfall it produces is a
      // separate, deliberately tested behaviour.
      longestSessionMinutes: 90,
      mesoWeek: 1,
      mesoStartDate: MON,
      holdStreak: 0,
      rotationCursor: 0,
      lastPlannedMinutes: 0,
    },
    onboarding: { completed: true, step: 6 },
    ...overrides,
  }
}

function strength(date: string, programDay: string): Session {
  return { id: `s-${date}`, uid: 'u1', date, kind: 'strength', status: 'done', programDay }
}

function cardio(date: string, minutes: number): Session {
  return { id: `c-${date}`, uid: 'u1', date, kind: 'cardio', status: 'done', minutes }
}

const FULL_WEEK: Session[] = [
  strength(MON, 'A1'),
  cardio(TUE, 38),
  strength(WED, 'B1'),
  strength(FRI, 'A2'),
  cardio(SAT, 112),
]

describe('planWeek', () => {
  it('composes the whole week the anchor day falls in', () => {
    const plan = planWeek(profile(), [], WED)

    expect(plan.week.weekStart).toBe(MON)
    expect(plan.week.days).toHaveLength(7)
    expect(plan.week.days.filter((day) => day.planned?.kind === 'strength')).toHaveLength(3)
    expect(plan.week.days.filter((day) => day.planned?.kind === 'cardio')).toHaveLength(2)
  })

  it('runs the GZCLP rotation from the profile cursor', () => {
    const days = planWeek(
      profile({ strengthTrack: { ...profile().strengthTrack, rotationCursor: 2 } }),
      [],
      MON,
    ).week.days.flatMap((day) => (day.planned?.kind === 'strength' ? [day.planned.programDay] : []))

    expect(days).toEqual(['A2', 'B2', 'A1'])
  })

  it('keeps hard cardio away from the eve of a heavy lower day, using the real GZCLP rule', () => {
    // Mon A1 / Wed B1 / Fri A2 — Tuesday is the eve of a deadlift day, so the
    // intervals lose their intensity and keep their minutes.
    const plan = planWeek(profile(), [], MON)
    const tuesday = plan.week.days.find((day) => day.date === TUE)?.planned

    expect(tuesday?.kind).toBe('cardio')
    expect(tuesday?.kind === 'cardio' && tuesday.prescription.kind).toBe('easy')
  })

  it('drops days before the frontier that never happened', () => {
    const plan = planWeek(profile(), [], MON, THU)

    expect(plan.week.days.slice(0, 3).every((day) => day.planned === null)).toBe(true)
  })

  it('does not hold volume for a profile that has no history to fall short of', () => {
    const plan = planWeek(profile({ cardioTrack: { ...profile().cardioTrack, mesoWeek: 2 } }), [], MON)

    expect(plan.cardio.weeklyMinutes).toBe(162) // 150 x 1.08, the week-2 ramp
  })

  it('holds volume after a week that was actually missed', () => {
    // Strength happened last week, cardio did not — that is a real miss.
    const plan = planWeek(
      profile({ cardioTrack: { ...profile().cardioTrack, mesoWeek: 2 } }),
      [strength(addDays(MON, -4), 'A1')],
      MON,
    )

    expect(plan.cardio.weeklyMinutes).toBe(150)
  })

  it('reports the week the cardio planner considers a deload', () => {
    expect(planWeek(profile(), [], MON).isDeloadWeek).toBe(false)
    expect(planWeek(profile({ cardioTrack: { ...profile().cardioTrack, mesoWeek: 4 } }), [], MON).isDeloadWeek).toBe(
      true,
    )
  })
})

describe('cardioOf', () => {
  it('lists the week’s prescriptions in calendar order', () => {
    const prescriptions: CardioPrescription[] = cardioOf(planWeek(profile(), [], MON).week)

    expect(prescriptions).toHaveLength(2)
    expect(prescriptions.map((item) => item.kind)).toEqual(['easy', 'long'])
  })
})

describe('resolveToday — a training day', () => {
  const today = resolveToday(profile(), [], MON)

  it('hands back the planned session', () => {
    expect(today.item).toEqual({ kind: 'strength', programDay: 'A1' })
    expect(today.isRestDay).toBe(false)
  })

  it('offers no catch-up when today already has work', () => {
    expect(today.catchUp).toBeNull()
  })

  it('has nothing to come back from', () => {
    expect(today.comebackProposal).toBeNull()
    expect(today.daysSinceLastSession).toBe(0)
  })
})

describe('resolveToday — a rest day with work outstanding', () => {
  // Nothing logged and it is already Thursday: Monday's and Wednesday's
  // sessions are gone, so Thursday is worth claiming.
  const today = resolveToday(profile(), [], THU)

  it('is a rest day', () => {
    expect(today.item).toBeNull()
    expect(today.isRestDay).toBe(true)
  })

  it('offers the overdue strength session', () => {
    expect(today.catchUp).toEqual({ kind: 'strength', programDay: 'A1' })
  })
})

describe('resolveToday — a rest day with nothing due', () => {
  const today = resolveToday(
    profile({ strengthTrack: { ...profile().strengthTrack, rotationCursor: 3 } }),
    FULL_WEEK,
    SUN,
  )

  it('offers nothing once the week is complete', () => {
    expect(today.item).toBeNull()
    expect(today.isRestDay).toBe(true)
    expect(today.catchUp).toBeNull()
  })

  it('still reports the gap since the last session', () => {
    expect(today.daysSinceLastSession).toBe(1)
  })
})

describe('resolveToday — after a long gap', () => {
  const lastSession = addDays(MON, -21)
  const today = resolveToday(profile(), [strength(lastSession, 'A1')], MON)

  it('counts the days off', () => {
    expect(today.daysSinceLastSession).toBe(21)
  })

  it('offers a comeback without touching the plan', () => {
    expect(today.comebackProposal).not.toBeNull()
    expect(today.comebackProposal?.daysSinceLastSession).toBe(21)
    expect(today.comebackProposal?.strength).toEqual([
      {
        exerciseKey: 'T1:Squat',
        from: { value: 100, unit: 'kg' },
        to: { value: 90, unit: 'kg' },
        setVariationIndex: 1,
      },
    ])
    // The proposal is an offer: today's plan is unchanged until it is accepted.
    expect(today.item).toEqual({ kind: 'strength', programDay: 'A1' })
  })

  it('stays quiet while the gap is shorter than the profile threshold', () => {
    expect(resolveToday(profile(), [strength(addDays(MON, -3), 'A1')], MON).comebackProposal).toBeNull()
  })
})
