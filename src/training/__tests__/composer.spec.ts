import type { CardioPrescription, ComposedWeek, PlannedItem, Profile, Session } from '@/types'
import { addDays, weekdayIndexMondayFirst } from '@/utils/date'

import {
  canPlaceHardCardio,
  canPlaceLongSession,
  chooseSpreadDays,
  claimToday,
  type ComposedWeekPlan,
  type ComposeWeekInput,
  composeWeek,
  cyclicGaps,
  demoteToEasy,
  explainPlacement,
  isDayBeforeHeavyLower,
  isHardCardio,
  sharesDayWithStrength,
  swapToday,
  trainingWeekdays,
  weeklyTrackBudget,
} from '../composer'

const MON = '2026-08-24'
const TUE = '2026-08-25'
const WED = '2026-08-26'
const THU = '2026-08-27'
const FRI = '2026-08-28'
const SAT = '2026-08-29'
const SUN = '2026-08-30'

const ROTATION = ['A1', 'B1', 'A2', 'B2']

/** Mirrors `gzclp.isHeavyLowerDay` without pulling the program parser into these tests. */
const HEAVY = new Set(['A1', 'B1', 'B2'])
const heavyLowerDays = (programDay: string) => HEAVY.has(programDay)

function availability(overrides: Partial<Profile['availability']> = {}): Profile['availability'] {
  return { daysPerWeek: 5, preferredDays: [0, 1, 2, 4, 5], longSessionDay: 5, ...overrides }
}

function easy(targetMinutes: number, modality: CardioPrescription['modality'] = 'run'): CardioPrescription {
  return { modality, kind: 'easy', targetMinutes, zone: 2 }
}

function long(targetMinutes: number, modality: CardioPrescription['modality'] = 'run'): CardioPrescription {
  return { modality, kind: 'long', targetMinutes, zone: 2 }
}

function intervals(targetMinutes: number, modality: CardioPrescription['modality'] = 'bike'): CardioPrescription {
  return { modality, kind: 'intervals', targetMinutes, zone: 4, structure: { reps: 6, workMinutes: 3, restMinutes: 2 } }
}

function input(overrides: Partial<ComposeWeekInput> = {}): ComposeWeekInput {
  return {
    weekStart: MON,
    availability: availability(),
    rotationCursor: 0,
    programDays: ROTATION,
    cardioSessions: [long(60), intervals(40)],
    heavyLowerDays,
    completedSessions: [],
    ...overrides,
  }
}

function strengthSession(date: string, programDay: string): Session {
  return { id: `s-${date}`, uid: 'u1', date, kind: 'strength', status: 'done', programDay }
}

function cardioSession(date: string, prescription: CardioPrescription): Session {
  return {
    id: `c-${date}`,
    uid: 'u1',
    date,
    kind: 'cardio',
    status: 'done',
    minutes: prescription.targetMinutes,
    prescription,
  }
}

function itemAt(week: ComposedWeek, date: string): PlannedItem | null {
  return week.days.find((day) => day.date === date)?.planned ?? null
}

/** `{ Mon: 'A1', Tue: 'easy run 40', … }` — the shape assertions read best against. */
function layout(week: ComposedWeek): Record<string, string> {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const result: Record<string, string> = {}

  for (const day of week.days) {
    if (!day.planned) continue
    result[names[weekdayIndexMondayFirst(day.date)]] =
      day.planned.kind === 'strength'
        ? day.planned.programDay
        : `${day.planned.prescription.kind} ${day.planned.prescription.targetMinutes}`
  }

  return result
}

function strengthDays(week: ComposedWeek): string[] {
  return week.days.flatMap((day) => (day.planned?.kind === 'strength' ? [day.planned.programDay] : []))
}

function countKind(week: ComposedWeek, kind: PlannedItem['kind']): number {
  return week.days.filter((day) => day.planned?.kind === kind).length
}

/**
 * The one rule that must hold in every composed week: no hard cardio session
 * sits the day before a heavy lower strength day.
 */
function noHardCardioBeforeHeavyLower(week: ComposedWeek): boolean {
  return week.days.every((day) => {
    if (day.planned?.kind !== 'cardio' || !isHardCardio(day.planned.prescription)) return true

    const next = itemAt(week, addDays(day.date, 1))

    return !(next?.kind === 'strength' && heavyLowerDays(next.programDay))
  })
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

describe('interference predicates', () => {
  const slots = [
    { date: WED, programDay: 'B1' }, // heavy
    { date: FRI, programDay: 'A2' }, // not heavy
  ]

  it('treats intervals and tempo as hard cardio', () => {
    expect(isHardCardio(intervals(40))).toBe(true)
    expect(isHardCardio({ modality: 'run', kind: 'tempo', targetMinutes: 30, zone: 3 })).toBe(true)
    expect(isHardCardio(easy(40))).toBe(false)
    expect(isHardCardio(long(90))).toBe(false)
  })

  it('knows which days a strength session already owns', () => {
    expect(sharesDayWithStrength(WED, slots)).toBe(true)
    expect(sharesDayWithStrength(THU, slots)).toBe(false)
  })

  it('only flags the day before a HEAVY lower day', () => {
    expect(isDayBeforeHeavyLower(TUE, slots, heavyLowerDays)).toBe(true) // Wed is B1
    expect(isDayBeforeHeavyLower(THU, slots, heavyLowerDays)).toBe(false) // Fri is A2
    expect(isDayBeforeHeavyLower(WED, slots, heavyLowerDays)).toBe(false)
  })

  it('keeps hard cardio off strength days, heavy-lower eves and the long session eve', () => {
    expect(canPlaceHardCardio(THU, slots, heavyLowerDays)).toBe(true)
    expect(canPlaceHardCardio(WED, slots, heavyLowerDays)).toBe(false) // strength day
    expect(canPlaceHardCardio(TUE, slots, heavyLowerDays)).toBe(false) // eve of B1
    expect(canPlaceHardCardio(THU, slots, heavyLowerDays, FRI)).toBe(false) // eve of the long session
  })

  it('lets the long session sit before the hard session but not before heavy lower', () => {
    expect(canPlaceLongSession(THU, slots, heavyLowerDays)).toBe(true)
    expect(canPlaceLongSession(TUE, slots, heavyLowerDays)).toBe(false)
  })

  it('demotes to easy keeping the modality and the minutes, dropping the structure', () => {
    expect(demoteToEasy(intervals(45, 'bike'))).toEqual({
      modality: 'bike',
      kind: 'easy',
      targetMinutes: 45,
      zone: 2,
    })
  })
})

describe('trainingWeekdays', () => {
  it('uses the preferred days when there are enough of them', () => {
    expect(trainingWeekdays(availability())).toEqual([0, 1, 2, 4, 5])
  })

  it('fills forward from Monday when fewer days are preferred than the budget', () => {
    expect(trainingWeekdays(availability({ daysPerWeek: 4, preferredDays: [5, 6] }))).toEqual([0, 1, 5, 6])
  })

  it('trims the preferred list down to the budget', () => {
    expect(trainingWeekdays(availability({ daysPerWeek: 2 }))).toEqual([0, 1])
  })

  it('ignores garbage weekdays and duplicates', () => {
    expect(trainingWeekdays(availability({ daysPerWeek: 3, preferredDays: [2, 2, 9, -1, 4] }))).toEqual([0, 2, 4])
  })
})

describe('weeklyTrackBudget', () => {
  it('caps strength at three and gives cardio the rest', () => {
    expect(weeklyTrackBudget(availability({ daysPerWeek: 5 }), 4)).toEqual({
      trainingDays: 5,
      strengthDays: 3,
      cardioDays: 2,
    })
  })

  it('gives up a strength day so cardio always keeps one', () => {
    expect(weeklyTrackBudget(availability({ daysPerWeek: 3 }), 2)).toEqual({
      trainingDays: 3,
      strengthDays: 2,
      cardioDays: 1,
    })
  })

  it('keeps all three strength days when there is no cardio to place', () => {
    expect(weeklyTrackBudget(availability({ daysPerWeek: 3 }), 0)).toEqual({
      trainingDays: 3,
      strengthDays: 3,
      cardioDays: 0,
    })
  })
})

describe('spread helpers', () => {
  it('counts the wrap-around gap, so Sun+Mon is back to back', () => {
    expect(cyclicGaps([0, 6])).toEqual([6, 1])
    expect(cyclicGaps([0, 2, 4])).toEqual([2, 2, 3])
    expect(cyclicGaps([3])).toEqual([7])
  })

  it('picks the widest-spread combination, Mon/Wed/Fri out of a five-day week', () => {
    expect(chooseSpreadDays([0, 1, 2, 4, 5], 3, [], -1)).toEqual([0, 2, 4])
  })

  it('respects days that are already taken', () => {
    expect(chooseSpreadDays([2, 4, 5], 2, [0], -1)).toEqual([2, 4])
  })

  it('never stacks three lifting days in a row when a looser layout exists', () => {
    // Mon–Thu, three strength days: every option has one back-to-back pair, but
    // Mon/Tue/Wed has two. Ranking on the tightest gap alone could not tell
    // them apart and fell through to "the earliest days".
    expect(chooseSpreadDays([0, 1, 2, 3], 3, [], -1)).toEqual([0, 1, 3])
    expect(chooseSpreadDays([0, 1, 2, 3, 4], 3, [], -1)).toEqual([0, 2, 4])
  })

  it('breaks a tie by leaving the long-session day alone', () => {
    // {0,2,4} and {0,2,5} both have a minimum gap of 2; Saturday must stay free.
    expect(chooseSpreadDays([0, 2, 4, 5], 3, [], 5)).toEqual([0, 2, 4])
  })
})

// ---------------------------------------------------------------------------
// composeWeek
// ---------------------------------------------------------------------------

describe('composeWeek — default five-day availability', () => {
  const plan = composeWeek(input())

  it('places three strength days on Mon/Wed/Fri and two cardio days', () => {
    expect(countKind(plan, 'strength')).toBe(3)
    expect(countKind(plan, 'cardio')).toBe(2)
    expect(layout(plan)).toEqual({ Mon: 'A1', Tue: 'easy 40', Wed: 'B1', Fri: 'A2', Sat: 'long 60' })
  })

  it('walks the rotation forward from the cursor', () => {
    expect(strengthDays(plan)).toEqual(['A1', 'B1', 'A2'])
    expect(strengthDays(composeWeek(input({ rotationCursor: 3 })))).toEqual(['B2', 'A1', 'B1'])
  })

  it('puts the long session on the preferred long-session day', () => {
    expect(itemAt(plan, SAT)).toEqual({ kind: 'cardio', prescription: long(60) })
  })

  it('leaves Thursday and Sunday as rest days', () => {
    expect(itemAt(plan, THU)).toBeNull()
    expect(itemAt(plan, SUN)).toBeNull()
  })
})

/**
 * `planWeek` snaps its anchor to a Monday, so nothing in the app composes a
 * window that opens mid-week today. The invariant is pinned anyway: the layout
 * is a fact about the athlete's weekdays, and `planTracks` used to reach it by
 * indexing the window's dates with a weekday number — the same number only
 * while Monday is day zero of the window.
 */
describe('composeWeek — a window that does not open on a Monday', () => {
  const plan = composeWeek(input({ weekStart: THU }))

  it("trains on the athlete's weekdays, not on offsets into the window", () => {
    const trained = plan.days.filter((day) => day.planned).map((day) => weekdayIndexMondayFirst(day.date))

    expect([...trained].sort((a, b) => a - b)).toEqual(availability().preferredDays)
    // Thursday opens the window, so an offset-indexed layout would have trained
    // on it and left the Wednesday that closes the window empty.
    expect(itemAt(plan, THU)).toBeNull()
    expect(itemAt(plan, SUN)).toBeNull()
    expect(itemAt(plan, '2026-09-02')).not.toBeNull()
  })
})

describe('composeWeek — other budgets', () => {
  it('a three-day week trades one strength day for the single cardio day', () => {
    const plan = composeWeek(
      input({
        availability: availability({ daysPerWeek: 3, preferredDays: [0, 2, 4] }),
        cardioSessions: [long(60)],
      }),
    )

    expect(countKind(plan, 'strength')).toBe(2)
    expect(countKind(plan, 'cardio')).toBe(1)
    expect(layout(plan)).toEqual({ Mon: 'A1', Wed: 'long 60', Fri: 'B1' })
  })

  it('a seven-day week still caps strength at three and spends the rest on cardio', () => {
    const plan = composeWeek(
      input({
        availability: availability({ daysPerWeek: 7, preferredDays: [0, 1, 2, 3, 4, 5, 6] }),
        cardioSessions: [long(90), intervals(40), easy(30), easy(30)],
      }),
    )

    expect(countKind(plan, 'strength')).toBe(3)
    expect(countKind(plan, 'cardio')).toBe(4)
    expect(plan.days.every((day) => day.planned !== null)).toBe(true)
    expect(layout(plan)).toEqual({
      Mon: 'A1',
      Tue: 'easy 30',
      Wed: 'B1',
      Thu: 'intervals 40',
      Fri: 'A2',
      Sat: 'long 90',
      Sun: 'easy 30',
    })
  })
})

describe('composeWeek — intervals and the heavy lower days', () => {
  it('never puts intervals the day before a heavy lower session', () => {
    for (const cursor of [0, 1, 2, 3]) {
      for (const daysPerWeek of [3, 4, 5, 6, 7]) {
        const week = input({
          rotationCursor: cursor,
          availability: availability({ daysPerWeek, preferredDays: [0, 1, 2, 3, 4, 5, 6] }),
          cardioSessions: [long(60), intervals(40), easy(30), easy(30)],
        })
        const plan = composeWeek(week)

        expect(noHardCardioBeforeHeavyLower(plan)).toBe(true)

        // …and the rule survives the week boundary: composing next week from the
        // cursor this one leaves behind must not put a heavy lower day the
        // morning after this Sunday's session.
        const logged = strengthDays(plan).length
        const next = composeWeek({ ...week, weekStart: addDays(MON, 7), rotationCursor: cursor + logged })
        const bridged: ComposedWeek = { weekStart: MON, days: [...plan.days, ...next.days] }

        expect(noHardCardioBeforeHeavyLower(bridged)).toBe(true)
      }
    }
  })

  it('counts next Monday too: no hard session on the Sunday before a heavy lower day', () => {
    // Seven training days from cursor 2: Mon A2 / Wed B2 / Fri A1 leaves Tue and
    // Thu as heavy-lower eves and Sat to the long session, so Sunday is the only
    // day left — and next Monday is B1, a deadlift day. The week ends where the
    // slot list ends, the training does not.
    const week = input({
      rotationCursor: 2,
      availability: availability({ daysPerWeek: 7, preferredDays: [0, 1, 2, 3, 4, 5, 6] }),
      cardioSessions: [long(60), intervals(40), easy(30), easy(30)],
    })
    const plan = composeWeek(week)

    expect(strengthDays(plan)).toEqual(['A2', 'B2', 'A1'])
    expect(plan.days.every((day) => day.planned?.kind !== 'cardio' || !isHardCardio(day.planned.prescription))).toBe(
      true,
    )
    expect(itemAt(plan, TUE)).toEqual({ kind: 'cardio', prescription: easy(40, 'bike') })

    // Cursor 3 ends the week pointing at A2, the one day that is not heavy —
    // there the intervals keep their intensity.
    const softMonday = composeWeek({ ...week, rotationCursor: 3 })

    expect(itemAt(softMonday, SUN)).toEqual({ kind: 'cardio', prescription: intervals(40) })
  })

  it('demotes the intervals rather than moving them onto a heavy-lower eve', () => {
    // Mon A1 / Wed B1 / Fri A2 leaves only Tuesday for the hard session, and
    // Tuesday is the eve of B1 — so the intensity goes, the minutes stay.
    const plan = composeWeek(input())

    expect(itemAt(plan, TUE)).toEqual({ kind: 'cardio', prescription: easy(40, 'bike') })
    expect(plan.explanations.some((line) => line.includes('demoted'))).toBe(true)
  })
})

describe('composeWeek — the long session is demoted, never dropped', () => {
  // Mon/Wed/Fri strength from cursor 1 = B1 / A2 / B2, Thursday the only cardio
  // day — and Thursday is the eve of B2, a heavy deadlift day.
  const plan = composeWeek(
    input({
      availability: availability({ daysPerWeek: 4, preferredDays: [0, 2, 3, 4], longSessionDay: 2 }),
      rotationCursor: 1,
      cardioSessions: [long(75)],
    }),
  )

  it('keeps the session, the day and the minutes', () => {
    expect(strengthDays(plan)).toEqual(['B1', 'A2', 'B2'])
    expect(itemAt(plan, THU)).toEqual({ kind: 'cardio', prescription: easy(75) })
    expect(countKind(plan, 'cardio')).toBe(1)
  })

  it('says why in one line', () => {
    expect(plan.explanations.some((line) => line.includes('demoted') && line.includes('75 min'))).toBe(true)
  })
})

describe('composeWeek — logged sessions are fixed', () => {
  const completedSessions = [strengthSession(MON, 'A1'), cardioSession(TUE, long(60))]
  const base = input({
    // The Monday session already advanced the cursor.
    rotationCursor: 1,
    completedSessions,
    fromDate: WED,
  })
  const plan = composeWeek(base)

  it('leaves the days that already happened exactly where they are', () => {
    expect(itemAt(plan, MON)).toEqual({ kind: 'strength', programDay: 'A1' })
    expect(itemAt(plan, TUE)).toEqual({ kind: 'cardio', prescription: long(60) })
    expect(plan.explanations.filter((line) => line.includes('already logged')).length).toBe(2)
  })

  it('recomposes only the future, continuing the rotation', () => {
    expect(layout(plan)).toEqual({ Mon: 'A1', Tue: 'long 60', Wed: 'B1', Fri: 'A2', Sat: 'intervals 40' })
  })

  it('does not re-place a prescription the logged session already used', () => {
    expect(
      plan.days.filter((day) => day.planned?.kind === 'cardio' && day.planned.prescription.kind === 'long'),
    ).toHaveLength(1)
  })

  it('frees a past day that never happened instead of pretending it still can', () => {
    // Monday and Tuesday are untouched but unlogged and today is Wednesday:
    // they are gone, and Monday's workout rolls onto Wednesday.
    const rolled = composeWeek(input({ fromDate: WED }))

    expect(itemAt(rolled, MON)).toBeNull()
    expect(itemAt(rolled, TUE)).toBeNull()
    expect(layout(rolled)).toEqual({ Wed: 'A1', Fri: 'B1', Sat: 'long 60' })
  })
})

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

describe('claimToday', () => {
  const base = input({ fromDate: THU })
  const week = composeWeek(base)

  it('composes Thursday as a rest day to begin with', () => {
    expect(itemAt(week, THU)).toBeNull()
    expect(layout(week)).toEqual({ Fri: 'A1', Sat: 'long 60' })
  })

  it('offers the overdue strength session and pushes the rest of the rotation back', () => {
    const claimed = claimToday(week, THU, base)

    expect(itemAt(claimed, THU)).toEqual({ kind: 'strength', programDay: 'A1' })
    expect(strengthDays(claimed)).toEqual(['A1', 'B1'])
    expect(claimed.explanations[0]).toContain('claimed as an extra training day')
    expect(claimed.explanations[0]).toContain('strength is behind')
  })

  it('offers cardio once strength is caught up but a cardio day was missed', () => {
    // All three strength days are logged and so is Saturday's long run; only
    // Tuesday's session never happened, so Sunday is worth claiming for cardio.
    // The cursor stands at B2, so next Monday is a deadlift day and Sunday's
    // intervals lose their intensity — the minutes are what was missed.
    const caught = input({
      rotationCursor: 3,
      completedSessions: [
        strengthSession(MON, 'A1'),
        strengthSession(WED, 'B1'),
        strengthSession(FRI, 'A2'),
        cardioSession(SAT, long(60)),
      ],
      fromDate: SUN,
    })
    const claimed = claimToday(composeWeek(caught), SUN, caught)

    expect(itemAt(claimed, SUN)).toEqual({ kind: 'cardio', prescription: easy(40, 'bike') })
    expect(claimed.explanations[0]).toContain('cardio is behind')
  })

  it('claims Sunday for the hard session when next Monday is not a heavy lower day', () => {
    // Same week from cursor 2: next Monday is A2, the one GZCLP day that is not
    // heavy on the legs, so the intervals survive.
    const caught = input({
      rotationCursor: 2,
      completedSessions: [
        strengthSession(MON, 'B2'),
        strengthSession(WED, 'A1'),
        strengthSession(FRI, 'B1'),
        cardioSession(SAT, long(60)),
      ],
      fromDate: SUN,
    })
    const claimed = claimToday(composeWeek(caught), SUN, caught)

    expect(itemAt(claimed, SUN)).toEqual({ kind: 'cardio', prescription: intervals(40) })
  })

  it('is a no-op on a day that already has a session planned', () => {
    expect(layout(claimToday(week, FRI, base))).toEqual(layout(week))
  })
})

describe('swapToday', () => {
  const base = input()
  const week = composeWeek(base)
  const swapped = swapToday(week, MON, base)

  it('turns the strength day into a cardio day', () => {
    expect(itemAt(swapped, MON)?.kind).toBe('cardio')
    expect(swapped.explanations[0]).toContain('swapped to cardio')
  })

  it('displaces the rotation instead of skipping it', () => {
    expect(strengthDays(week)).toEqual(['A1', 'B1', 'A2'])
    expect(strengthDays(swapped)).toEqual(['A1', 'B1'])
    expect(itemAt(swapped, WED)).toEqual({ kind: 'strength', programDay: 'A1' })
    expect(itemAt(swapped, FRI)).toEqual({ kind: 'strength', programDay: 'B1' })
  })

  it('loses nothing across the week boundary — the cursor carries the remainder', () => {
    // The user logs what the swapped week actually offered; each logged session
    // advances the cursor by one, so next Monday starts where the week stopped.
    const logged = strengthDays(swapped)
    const nextWeek = composeWeek(
      input({ weekStart: addDays(MON, 7), rotationCursor: base.rotationCursor + logged.length }),
    )

    expect([...logged, ...strengthDays(nextWeek)]).toEqual(['A1', 'B1', 'A2', 'B2', 'A1'])
  })

  it('still respects the interference rules after the swap', () => {
    expect(noHardCardioBeforeHeavyLower(swapped)).toBe(true)
  })

  it('refuses to swap a session that already happened', () => {
    const logged = input({ rotationCursor: 1, completedSessions: [strengthSession(MON, 'A1')] })

    expect(layout(swapToday(composeWeek(logged), MON, logged))).toEqual(layout(composeWeek(logged)))
  })
})

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

describe('explainPlacement', () => {
  const plan = composeWeek(input())

  it('returns one readable line per decision', () => {
    const lines = explainPlacement(plan)

    expect(lines).toBe(plan.explanations)
    // The header plus one line per planned day.
    expect(lines).toHaveLength(1 + plan.days.filter((day) => day.planned).length)
    expect(lines[0]).toBe('Training days: Mon, Tue, Wed, Fri, Sat (5 per week).')
    expect(lines.every((line) => line.length > 10 && line.endsWith('.'))).toBe(true)
    expect(lines).toContain('Mon 2026-08-24: strength A1 — rotation position 1/4.')
  })

  it('reconstructs lines for a plain ComposedWeek that carries no reasoning', () => {
    const plain: ComposedWeek = { weekStart: plan.weekStart, days: plan.days.map((day) => ({ ...day })) }
    const lines = explainPlacement(plain)

    expect(lines).toHaveLength(plan.days.filter((day) => day.planned).length)
    expect(lines[0]).toBe('Mon 2026-08-24: strength A1.')
    expect(lines).toContain('Sat 2026-08-29: long run 60 min @Z2.')
  })
})

describe('composeWeek — degenerate inputs', () => {
  it('produces an empty week when there is nothing to do', () => {
    const plan: ComposedWeekPlan = composeWeek(
      input({ availability: availability({ daysPerWeek: 0, preferredDays: [] }), cardioSessions: [] }),
    )

    expect(plan.days).toHaveLength(7)
    expect(plan.days.every((day) => day.planned === null)).toBe(true)
  })

  it('reports the cardio sessions that found no day rather than dropping them silently', () => {
    const plan = composeWeek(
      input({
        availability: availability({ daysPerWeek: 4, preferredDays: [0, 2, 4, 5] }),
        cardioSessions: [long(60), intervals(40), easy(30), easy(30)],
      }),
    )

    expect(plan.explanations.some((line) => line.includes('roll forward'))).toBe(true)
  })
})
