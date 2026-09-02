import type { CardioPrescription, Profile, Session } from '@/types'
import { addDays } from '@/utils/date'

import { GZCLP_PROGRAM_SOURCE } from '../gzclp'
import { cardioOf, frontierFor, planWeek, resolveDay, resolveToday } from '../schedule'

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
      // A real program, because the rotation is read off it: the planner follows
      // the athlete's own day list, so an empty program schedules no strength.
      programText: GZCLP_PROGRAM_SOURCE,
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
      blockStartDate: MON,
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

  it('holds volume after a block that was actually missed', () => {
    // Strength happened in the block before this one, cardio did not — that is a
    // real miss, and the volume repeats instead of ramping.
    const plan = planWeek(
      profile({ cardioTrack: { ...profile().cardioTrack, mesoWeek: 2 } }),
      [strength(addDays(MON, -4), 'A1')],
      MON,
    )

    expect(plan.cardio.weeklyMinutes).toBe(150)
  })

  it('does not read an empty block as a missed one', () => {
    // Nothing at all was logged in the block before this one. That is an
    // absence, not a failed week — `comeback.ts` owns it — so the volume ramps
    // on rather than being held and then stepped back 10 % on top of the
    // comeback's own 70 %.
    const plan = planWeek(
      profile({ cardioTrack: { ...profile().cardioTrack, mesoWeek: 2 } }),
      [strength(addDays(MON, -30), 'A1')],
      MON,
    )

    expect(plan.cardio.weeklyMinutes).toBe(162)
  })

  it('plans the same cardio for next week as for this one', () => {
    // The adaptive input is the stored BLOCK, not the seven days before the
    // anchor: asking for next Monday used to measure this half-logged week,
    // score it under 70 % and hand back a held plan for a week nobody has
    // trained yet — which is what PlanView and the onboarding preview show.
    const athlete = profile({ cardioTrack: { ...profile().cardioTrack, mesoWeek: 2, lastPlannedMinutes: 150 } })
    const halfLogged = [strength(addDays(MON, -4), 'A1'), cardio(addDays(MON, -3), 150), strength(MON, 'A1')]

    const thisWeek = planWeek(athlete, halfLogged, MON)
    const nextWeek = planWeek(athlete, halfLogged, addDays(MON, 7))

    expect(nextWeek.cardio.sessions).toEqual(thisWeek.cardio.sessions)
    expect(nextWeek.cardio.weeklyMinutes).toBe(thisWeek.cardio.weeklyMinutes)
  })

  it('reports the week the cardio planner considers a deload', () => {
    expect(planWeek(profile(), [], MON).isDeloadWeek).toBe(false)
    expect(planWeek(profile({ cardioTrack: { ...profile().cardioTrack, mesoWeek: 4 } }), [], MON).isDeloadWeek).toBe(
      true,
    )
  })
})

describe('a program that is not GZCLP', () => {
  const pushPull = `# Week 1
## Push
T1: Bench Press / 5x3+ / 60kg / progress: none
## Pull
T1: Bent Over Row / 5x3+ / 50kg / progress: none
## Legs
T1: Squat / 5x3+ / 100kg / progress: none
`

  it('rotates the days the athlete actually wrote', () => {
    // The cursor is an index into the athlete's program, not into GZCLP. A
    // three-day split cycles three days; hardcoding four would train them on a
    // day their program does not have.
    const week = planWeek(
      profile({ strengthTrack: { ...profile().strengthTrack, programText: pushPull } }),
      [],
      MON,
    ).week

    const strengthDays = week.days
      .map((day) => day.planned)
      .filter((planned) => planned?.kind === 'strength')
      .map((planned) => (planned as { programDay: string }).programDay)

    expect(strengthDays).toEqual(['Push', 'Pull', 'Legs'])
  })

  it('schedules no strength at all when the program does not parse', () => {
    // Silently falling back to GZCLP would prescribe a workout the athlete never
    // wrote. The session screen explains the parse failure; the week just has no
    // strength in it.
    const broken = profile({
      strengthTrack: { ...profile().strengthTrack, programText: 'T1: Squat / ...Nothing Here' },
    })

    expect(planWeek(broken, [], MON).week.days.some((day) => day.planned?.kind === 'strength')).toBe(false)
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

describe('frontierFor', () => {
  it('replays a past day behind its own frontier and plans today and the future as of today', () => {
    expect(frontierFor(addDays(MON, -2), MON)).toBe(addDays(MON, -2))
    expect(frontierFor(MON, MON)).toBe(MON)
    expect(frontierFor(addDays(MON, 3), MON)).toBe(MON)
  })
})

describe('resolveDay', () => {
  it('is resolveToday when the day is today', () => {
    expect(resolveDay(profile(), [], MON, MON)).toEqual(resolveToday(profile(), [], MON))
  })

  it('offers a missed past day the rotation day that was outstanding then', () => {
    // Nothing logged by Friday: Monday and Wednesday were both A1 when they came.
    const friday = addDays(MON, 4)

    expect(resolveDay(profile(), [], MON, friday).item).toEqual({ kind: 'strength', programDay: 'A1' })
    expect(resolveDay(profile(), [], addDays(MON, 2), friday).item).toEqual({ kind: 'strength', programDay: 'A1' })
  })

  it('does not roll skipped days forward onto a future day', () => {
    const wednesday = addDays(MON, 2)
    const planned = planWeek(profile(), [], MON).week.days.find((day) => day.date === wednesday)?.planned

    expect(resolveDay(profile(), [], wednesday, MON).item).toEqual(planned)
  })

  it('measures the comeback and the gap to today, whichever day is asked about', () => {
    const lastSession = addDays(MON, -20)
    const sessions = [strength(lastSession, 'A1')]

    const today = resolveDay(profile(), sessions, MON, MON)
    const yesterday = resolveDay(profile(), sessions, addDays(MON, -1), MON)

    expect(yesterday.daysSinceLastSession).toBe(today.daysSinceLastSession)
    expect(yesterday.comebackProposal).toEqual(today.comebackProposal)
  })
})

describe('planWeek — a later week behind a frontier', () => {
  const NEXT_MON = addDays(MON, 7)
  const ROTATION = ['A1', 'B1', 'A2', 'B2']

  function firstStrengthDay(week: ReturnType<typeof planWeek>['week']): string | undefined {
    const day = week.days.find((entry) => entry.planned?.kind === 'strength')
    return day?.planned?.kind === 'strength' ? day.planned.programDay : undefined
  }

  it('projects the rotation cursor across the strength days still to come', () => {
    const thisWeek = planWeek(profile(), [], MON, MON).week
    const toCome = thisWeek.days.filter((day) => day.planned?.kind === 'strength').length
    expect(toCome).toBeGreaterThan(0)

    const projected = planWeek(profile(), [], NEXT_MON, MON)

    expect(projected.input.rotationCursor).toBe(toCome % ROTATION.length)
    expect(firstStrengthDay(projected.week)).toBe(ROTATION[toCome % ROTATION.length])
  })

  it('composes straight off the stored cursor when there is no frontier', () => {
    expect(planWeek(profile(), [], NEXT_MON).input.rotationCursor).toBe(0)
    expect(firstStrengthDay(planWeek(profile(), [], NEXT_MON).week)).toBe('A1')
  })

  it('counts from the frontier, not from the start of its week', () => {
    // Behind a Thursday frontier only Friday is still to come this week.
    expect(planWeek(profile(), [], NEXT_MON, THU).input.rotationCursor).toBe(1)
  })

  it('does not count a strength day that is already logged — the stored cursor already carries it', () => {
    const base = profile()
    const advanced = { ...base, strengthTrack: { ...base.strengthTrack, rotationCursor: 1 } }
    // Monday A1 is done; Wednesday and Friday are still to come.
    const projected = planWeek(advanced, [strength(MON, 'A1')], NEXT_MON, addDays(MON, 1))

    expect(projected.input.rotationCursor).toBe(3)
    expect(firstStrengthDay(projected.week)).toBe('B2')
  })

  it('leaves the anchor week itself alone', () => {
    const { input } = planWeek(profile(), [], addDays(MON, 3), MON)

    expect(input.rotationCursor).toBe(0)
    expect(input.weekStart).toBe(MON)
  })
})
