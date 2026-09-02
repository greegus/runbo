import { GZCLP_PROGRAM_SOURCE, initialProgramState } from '@/training/gzclp'
import type { Profile, Session } from '@/types'
import { addDays, daysBetween } from '@/utils/date'

import { buildDayPicker, DAYS_AHEAD, pickerRange, relativeDayLabel } from '../dayPicker'
import { buildDay } from '../today'

const MON = '2026-08-24'
const TUE = '2026-08-25'
const WED = '2026-08-26'
const THU = '2026-08-27'
const FRI = '2026-08-28'

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

function strengthSession(date: string, programDay: string, status: Session['status'] = 'done'): Session {
  return { id: `s-${date}`, uid: 'u1', date, kind: 'strength', status, programDay }
}

function allDays(model: ReturnType<typeof buildDayPicker>) {
  return model.weeks.flatMap((week) => week.days)
}

function dayOn(model: ReturnType<typeof buildDayPicker>, date: string) {
  const day = allDays(model).find((candidate) => candidate.date === date)
  if (!day) throw new Error(`no day ${date}`)

  return day
}

describe('pickerRange', () => {
  it('opens on the Monday the live session window opens on and closes a week from today', () => {
    const range = pickerRange(WED)

    expect(range.earliest).toBe(addDays(MON, -21))
    expect(range.latest).toBe(addDays(WED, DAYS_AHEAD))
  })
})

describe('relativeDayLabel', () => {
  it('names the three days around today and dates the rest without a year', () => {
    expect(relativeDayLabel(WED, WED)).toBe('Today')
    expect(relativeDayLabel(TUE, WED)).toBe('Yesterday')
    expect(relativeDayLabel(THU, WED)).toBe('Tomorrow')
    expect(relativeDayLabel(MON, WED)).toBe('Mon, 24 Aug')
    expect(relativeDayLabel('2026-09-04', WED)).toBe('Fri, 4 Sep')
  })
})

describe('buildDayPicker', () => {
  it('covers every day of the range once, oldest week first, and cuts next week at the last day', () => {
    const model = buildDayPicker(profile(), [], WED)
    const days = allDays(model)

    expect(days).toHaveLength(daysBetween(model.earliest, model.latest) + 1)
    expect(days[0].date).toBe(model.earliest)
    expect(days[days.length - 1].date).toBe(model.latest)
    expect(new Set(days.map((day) => day.date)).size).toBe(days.length)

    expect(model.weeks.map((week) => week.label)).toEqual([
      '3 weeks ago',
      '2 weeks ago',
      'Last week',
      'This week',
      'Next week',
    ])
    // Wednesday + 7 is next Wednesday: Mon, Tue, Wed of next week and no more.
    expect(model.weeks[4].days).toHaveLength(3)
    expect(model.weeks[4].range).toBe('31 Aug – 6 Sep')
  })

  it('flags today and lets a day be opened only when it carries a plan or a session', () => {
    const model = buildDayPicker(profile(), [], WED)

    expect(dayOn(model, WED).isToday).toBe(true)
    expect(allDays(model).filter((day) => day.isToday)).toHaveLength(1)

    for (const day of allDays(model)) {
      expect(day.selectable).toBe(day.kind !== null)
    }
    // The default availability leaves Thursday and Sunday free.
    expect(dayOn(model, THU).selectable).toBe(false)
    expect(dayOn(model, THU).status).toBe('rest')
  })

  it('shows a logged day as done, with the session it links to, even on a rest day', () => {
    const model = buildDayPicker(profile(), [strengthSession(THU, 'A1')], FRI)
    const thursday = dayOn(model, THU)

    expect(thursday.status).toBe('done')
    expect(thursday.selectable).toBe(true)
    expect(thursday.sessionId).toBe(`s-${THU}`)
  })

  it('calls a planned past day missed and a planned future day future', () => {
    const model = buildDayPicker(profile(), [], WED)

    expect(dayOn(model, MON).status).toBe('missed')
    expect(dayOn(model, FRI).status).toBe('future')
    expect(model.weeks[4].days.every((day) => day.status !== 'missed')).toBe(true)
  })

  // The property the whole frontier rule exists for: every missed day of the
  // week is offered the work that is still outstanding, so backfilling any one
  // of them never steps the rotation past a day that never happened.
  it('offers every missed past day the same outstanding rotation day', () => {
    const model = buildDayPicker(profile(), [], FRI)
    const missedStrength = allDays(model).filter(
      (day) => day.date >= MON && day.status === 'missed' && day.kind === 'strength',
    )

    expect(missedStrength.length).toBeGreaterThan(1)
    expect(new Set(missedStrength.map((day) => day.title)).size).toBe(1)
    expect(missedStrength[0].title).toBe('Strength A1')
  })

  // Next week is composed behind today's frontier, so its rotation continues
  // where this week's remaining days leave off instead of repeating them.
  it('continues the rotation into next week without repeating a day still to come', () => {
    const model = buildDayPicker(profile(), [], WED)
    const rotation = ['A1', 'B1', 'A2', 'B2']
    const upcoming = allDays(model)
      .filter((day) => day.date >= WED && day.kind === 'strength')
      .map((day) => day.title.replace('Strength ', ''))

    expect(upcoming.length).toBeGreaterThan(2)
    for (let index = 1; index < upcoming.length; index += 1) {
      const previous = rotation.indexOf(upcoming[index - 1])
      expect(upcoming[index]).toBe(rotation[(previous + 1) % rotation.length])
    }
  })

  it('reads each day exactly as the card built for that day would', () => {
    const sessions = [strengthSession(MON, 'A1')]
    const model = buildDayPicker(profile(), sessions, WED)

    for (const day of allDays(model)) {
      const card = buildDay(profile(), sessions, day.date, WED)

      if (day.kind === 'strength' && card.item?.kind === 'strength') {
        expect(day.title).toBe(`Strength ${card.item.programDay}`)
      }
      expect(day.sessionId).toBe(card.doneSession?.id ?? card.activeSession?.id ?? null)
    }
  })

  it('survives a half-filled profile the way the week strip does', () => {
    const draft = profile({
      availability: { daysPerWeek: Number.NaN, preferredDays: [], longSessionDay: Number.NaN },
    })

    expect(() => buildDayPicker(draft, [], WED)).not.toThrow()
  })
})
