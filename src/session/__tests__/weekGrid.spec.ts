import { GZCLP_PROGRAM_SOURCE, initialProgramState } from '@/training/gzclp'
import type { Profile, Session } from '@/types'

import { buildToday } from '../today'
import { buildWeekGrid, liveWeekWindow, stepWeek, weekOffsetLabel, weekRangeLabel } from '../weekGrid'

const MON = '2026-08-24'
const TUE = '2026-08-25'
const WED = '2026-08-26'
const THU = '2026-08-27'
const SUN = '2026-08-30'

const SEED = {
  'T1:Squat': { weight: { value: 100, unit: 'kg' as const } },
  'T2:Bench Press': { weight: { value: 70, unit: 'kg' as const } },
  'T3:Lat Pulldown': { weight: { value: 40, unit: 'kg' as const } },
  'T1:Overhead Press': { weight: { value: 45, unit: 'kg' as const } },
  'T2:Deadlift': { weight: { value: 90, unit: 'kg' as const } },
}

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
      programText: GZCLP_PROGRAM_SOURCE,
      programState: initialProgramState(GZCLP_PROGRAM_SOURCE, SEED),
      rotationCursor: 0,
    },
    cardioTrack: {
      goal: { type: 'open' },
      modalities: ['run', 'bike'],
      weeklyMinutes: 150,
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

function strengthSession(date: string, status: Session['status'] = 'done'): Session {
  return {
    id: `s-${date}`,
    uid: 'u1',
    date,
    kind: 'strength',
    status,
    programDay: 'A1',
    exercises: [
      {
        name: 'Squat',
        tier: 1,
        sets: [
          { prescribedReps: 3, isAmrap: false, completedReps: 3, weight: { value: 100, unit: 'kg' } },
          { prescribedReps: 3, isAmrap: false, completedReps: null, weight: { value: 100, unit: 'kg' } },
        ],
      },
    ],
  }
}

function cardioSession(date: string, status: Session['status'] = 'done'): Session {
  return { id: `c-${date}`, uid: 'u1', date, kind: 'cardio', status, minutes: 42, distanceKm: 7.5 }
}

/** The day of the grid that carries `date`. */
function dayOn(model: ReturnType<typeof buildWeekGrid>, date: string) {
  const day = model.days.find((candidate) => candidate.date === date)
  if (!day) throw new Error(`no day ${date}`)

  return day
}

describe('buildWeekGrid', () => {
  it('returns seven Monday-first days with the week label and the planner explanations', () => {
    const model = buildWeekGrid(profile(), [], WED, WED)

    expect(model.weekStart).toBe(MON)
    expect(model.days).toHaveLength(7)
    expect(model.days[0].date).toBe(MON)
    expect(model.days[0].label).toBe('Mon')
    expect(model.days[6].label).toBe('Sun')
    expect(model.weekLabel).toBe('24 Aug – 30 Aug')
    expect(model.explanations.length).toBeGreaterThan(0)
    expect(typeof model.isDeloadWeek).toBe('boolean')
    expect(model.shortfallMinutes).toBeGreaterThanOrEqual(0)
  })

  it('marks a planned day that holds a done session as done, with the session id', () => {
    // composeWeek keeps `planned` set on a trained day, so this can only come
    // from the session list — the regression the whole module exists for.
    const model = buildWeekGrid(profile(), [strengthSession(MON)], WED, WED)
    const monday = dayOn(model, MON)

    expect(monday.status).toBe('done')
    expect(monday.sessionId).toBe('s-2026-08-24')
    expect(monday.kind).toBe('strength')
    expect(monday.detail).toBe('1 set logged')
  })

  it('marks an unplanned session on a rest day as done, taking the kind from the session', () => {
    const restProfile = profile({
      availability: { daysPerWeek: 2, preferredDays: [0, 2], longSessionDay: 2 },
    })
    const rest = buildWeekGrid(restProfile, [], SUN, SUN).days.find((day) => day.kind === null)
    expect(rest).toBeDefined()

    const model = buildWeekGrid(restProfile, [cardioSession(rest!.date)], SUN, SUN)
    const day = dayOn(model, rest!.date)

    expect(day.status).toBe('done')
    expect(day.kind).toBe('cardio')
    expect(day.detail).toBe('42 min · 7.5 km')
  })

  it('leaves an active session as planned so the row can offer a resume', () => {
    const model = buildWeekGrid(profile(), [strengthSession(WED, 'active')], WED, WED)
    const day = dayOn(model, WED)

    expect(day.status).toBe('planned')
    expect(day.sessionId).toBe('s-2026-08-26')
    expect(day.detail).toBe('In progress')
  })

  it('calls a past planned day with nothing logged missed, and today planned', () => {
    const model = buildWeekGrid(profile(), [], THU, THU)

    for (const day of model.days) {
      if (day.date < THU && day.kind !== null) expect(day.status).toBe('missed')
      if (day.date > THU) expect(['future', 'rest']).toContain(day.status)
    }

    expect(dayOn(model, THU).status).not.toBe('missed')
  })

  it('never reports a missed day in a future week', () => {
    const model = buildWeekGrid(profile(), [], '2026-09-07', WED)

    expect(model.days.every((day) => day.status !== 'missed')).toBe(true)
    expect(model.days.some((day) => day.status === 'future')).toBe(true)
  })

  it('keeps past days whole with a frontier, and plans the rest the way Today does', () => {
    const whole = buildWeekGrid(profile(), [], THU, THU)
    const stitched = buildWeekGrid(profile(), [], THU, THU, { fromDate: THU })
    const today = buildToday(profile(), [], THU)

    for (const [index, day] of stitched.days.entries()) {
      if (day.date < THU) {
        // A day that never happened still stands as missed, not as rest.
        expect(day.kind).toBe(whole.days[index].kind)
        expect(day.status).toBe(whole.days[index].status)
      } else {
        const planned = today.plan.week.days[index].planned
        expect(day.kind).toBe(planned?.kind ?? null)
        if (planned?.kind === 'strength') expect(day.title).toBe(`Strength ${planned.programDay}`)
      }
    }

    expect(stitched.days.some((day) => day.status === 'missed')).toBe(true)
    expect(stitched.days).toHaveLength(7)
  })

  it('moves the missed lift on to the next strength day, as Today does', () => {
    // Nothing logged by Thursday: the rotation is still on A1, so the next
    // strength day takes it rather than the day it was planned.
    const stitched = buildWeekGrid(profile(), [], THU, THU, { fromDate: THU })
    const nextAhead = stitched.days.find((day) => day.date >= THU && day.kind === 'strength')

    expect(nextAhead?.title).toBe('Strength A1')
  })

  it('names no program day on a missed lift, which is only a guess from the current cursor', () => {
    const model = buildWeekGrid(profile(), [], THU, THU, { fromDate: THU })
    const missed = model.days.filter((day) => day.status === 'missed' && day.kind === 'strength')

    expect(missed.length).toBeGreaterThan(0)
    expect(missed.every((day) => day.title === 'Strength')).toBe(true)
  })

  /** The athlete opted in to the rest-day suggestion; absent is off. */
  function saunaProfile(): Profile {
    const opted = profile()
    opted.availability = { ...opted.availability, saunaOnRestDays: true }
    return opted
  }

  function saunaSession(date: string): Session {
    return { id: `sauna-${date}`, uid: 'u1', date, kind: 'sauna', status: 'done', minutes: 20 }
  }

  it('suggests no sauna unless the athlete opted in', () => {
    expect(buildWeekGrid(profile(), [], MON, MON).days.some((day) => day.sauna !== null)).toBe(false)
  })

  it('suggests one sauna a week, on a rest day, never on a past day', () => {
    const model = buildWeekGrid(saunaProfile(), [], MON, MON)
    const suggested = model.days.filter((day) => day.sauna === 'suggested')

    expect(suggested).toHaveLength(1)
    expect(suggested[0].status).toBe('rest')

    const later = buildWeekGrid(saunaProfile(), [], MON, SUN)
    expect(later.days.filter((day) => day.sauna === 'suggested' && day.date < SUN)).toEqual([])
  })

  it('keeps a day with a claimed sauna a rest day, and drops the suggestion that week', () => {
    const rest = buildWeekGrid(saunaProfile(), [], MON, MON).days.find((day) => day.status === 'rest')
    if (!rest) throw new Error('no rest day')

    const model = buildWeekGrid(saunaProfile(), [saunaSession(rest.date)], MON, MON)
    const day = dayOn(model, rest.date)

    expect(day.status).toBe('rest')
    expect(day.kind).toBeNull()
    expect(day.sessionId).toBeNull()
    expect(day.sauna).toBe('claimed')
    expect(model.days.some((entry) => entry.sauna === 'suggested')).toBe(false)
  })

  it('leaves the plan alone when a sauna is claimed on a training day', () => {
    const plain = buildWeekGrid(profile(), [], MON, MON)
    const training = plain.days.find((day) => day.kind !== null)
    if (!training) throw new Error('no training day')

    const model = buildWeekGrid(profile(), [saunaSession(training.date)], MON, MON)

    expect(model.days.map((day) => [day.kind, day.title, day.status])).toEqual(
      plain.days.map((day) => [day.kind, day.title, day.status]),
    )
    expect(dayOn(model, training.date).sauna).toBe('claimed')
  })

  it('agrees with the Today card on whether today carries the suggestion', () => {
    const answers = [MON, TUE, WED, THU, '2026-08-28', '2026-08-29', SUN].map((date) => {
      const today = buildWeekGrid(saunaProfile(), [], date, date, { fromDate: date }).days.find((day) => day.isToday)

      expect(buildToday(saunaProfile(), [], date).saunaSuggested).toBe(today?.sauna === 'suggested')
      return today?.sauna === 'suggested'
    })

    // Not vacuous: some day of the week is the sauna day.
    expect(answers).toContain(true)
  })

  it('phrases a cardio day exactly once, through describePrescription', () => {
    const model = buildWeekGrid(profile(), [], WED, WED)
    const cardio = model.days.find((day) => day.kind === 'cardio')

    expect(cardio?.title).toMatch(/min/)
    expect(cardio?.detail).toBeNull()
  })

  it('names the sport of a cardio day, so its pace unit has a reason', () => {
    const model = buildWeekGrid(profile(), [], WED, WED)
    const cardio = model.days.filter((day) => day.kind === 'cardio')

    expect(cardio.length).toBeGreaterThan(0)
    for (const day of cardio) expect(['run', 'bike', 'swim']).toContain(day.modality)
    for (const day of model.days.filter((day) => day.kind !== 'cardio')) expect(day.modality).toBeNull()
  })

  it('survives a half-filled profile the way the onboarding preview does', () => {
    const draft = profile({
      availability: { daysPerWeek: Number.NaN, preferredDays: [], longSessionDay: Number.NaN },
    })

    expect(() => buildWeekGrid(draft, [], WED, WED)).not.toThrow()
    expect(buildWeekGrid(draft, [], WED, WED).days).toHaveLength(7)
  })

  it('is stable regardless of the order sessions arrive in', () => {
    const ordered = buildWeekGrid(profile(), [strengthSession(MON), cardioSession(TUE)], WED, WED)
    const reversed = buildWeekGrid(profile(), [cardioSession(TUE), strengthSession(MON)], WED, WED)

    expect(reversed.days).toEqual(ordered.days)
  })
})

describe('week labels and the navigable window', () => {
  it('names the range and the offset', () => {
    expect(weekRangeLabel(MON)).toBe('24 Aug – 30 Aug')
    expect(weekOffsetLabel(MON, WED)).toBe('This week')
    expect(weekOffsetLabel('2026-08-17', WED)).toBe('Last week')
    expect(weekOffsetLabel('2026-08-31', WED)).toBe('Next week')
    expect(weekOffsetLabel('2026-08-03', WED)).toBe('3 weeks ago')
    expect(weekOffsetLabel('2026-09-07', WED)).toBe('In 2 weeks')
  })

  it('clamps navigation to the weeks the live listener covers', () => {
    const window = liveWeekWindow(WED)

    expect(window.earliest).toBe('2026-08-03')
    expect(window.latest).toBe('2026-08-31')
    expect(stepWeek(MON, -1, window)).toBe('2026-08-17')
    expect(stepWeek('2026-08-03', -1, window)).toBeNull()
    expect(stepWeek('2026-08-31', 1, window)).toBeNull()
    expect(stepWeek(MON, 1, window)).toBe('2026-08-31')
  })
})
