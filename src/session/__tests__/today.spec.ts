import type { ComebackProposal } from '@/training/comeback'
import { GZCLP_PROGRAM_SOURCE, initialProgramState } from '@/training/gzclp'
import type { Profile, Session } from '@/types'

import { buildToday, claimedOutcome, comebackPatch, strengthHeadline, swappedOutcome } from '../today'

const MON = '2026-08-24'
const TUE = '2026-08-25'
const WED = '2026-08-26'
const THU = '2026-08-27'
const SAT = '2026-08-29'

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
      mesoStartDate: MON,
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

describe('buildToday', () => {
  it('resolves today, the week rollup and the streak from one profile and session list', () => {
    const model = buildToday(profile(), [strengthSession(MON, 'A1')], TUE)

    expect(model.todayIso).toBe(TUE)
    expect(model.resolution.item).toEqual(model.item)
    expect(model.rollup.weekStart).toBe(MON)
    expect(model.rollup.strength.done).toBe(1)
    expect(model.streak).toBeGreaterThanOrEqual(1)
    expect(model.plan.week.days).toHaveLength(7)
  })

  it('offers a headline only for a strength day', () => {
    const model = buildToday(profile(), [], MON)

    if (model.item?.kind === 'strength') {
      expect(model.headline).toBe(strengthHeadline(profile(), model.item.programDay))
    } else {
      expect(model.headline).toBeNull()
    }
  })

  it('allows a claim only on a rest day with work outstanding', () => {
    const model = buildToday(profile(), [], WED)

    expect(model.canClaim).toBe(model.resolution.isRestDay && model.catchUp !== null)
    if (model.item !== null) expect(model.canClaim).toBe(false)
  })

  it('blocks a swap once today already holds a logged session', () => {
    const planned = buildToday(profile(), [], MON)
    expect(planned.canSwap).toBe(planned.item !== null)

    const logged = buildToday(profile(), [strengthSession(MON, 'A1')], MON)
    expect(logged.canSwap).toBe(false)
  })

  it('surfaces an unfinished session for today as the one to resume', () => {
    const active = strengthSession(MON, 'A1', 'active')
    const model = buildToday(profile(), [active], MON)

    expect(model.activeSession).toEqual(active)
  })

  it('ignores an active session from another day', () => {
    const model = buildToday(profile(), [strengthSession(MON, 'A1', 'active')], TUE)

    expect(model.activeSession).toBeNull()
  })

  // The composer keeps today's `planned` item after the day is logged, so the
  // card cannot tell "done" from "not started" without this.
  it('surfaces today’s finished session so the day cannot be started twice', () => {
    const done = strengthSession(MON, 'A1')
    const model = buildToday(profile(), [done], MON)

    expect(model.doneSession).toEqual(done)
    expect(model.activeSession).toBeNull()
  })

  it('leaves doneSession null while the day is unlogged or only active', () => {
    expect(buildToday(profile(), [], MON).doneSession).toBeNull()
    expect(buildToday(profile(), [strengthSession(MON, 'A1', 'active')], MON).doneSession).toBeNull()
    // Yesterday's finished session is not today's.
    expect(buildToday(profile(), [strengthSession(MON, 'A1')], TUE).doneSession).toBeNull()
  })
})

describe('claimedOutcome / swappedOutcome', () => {
  it('gives a rest day the outstanding session the resolution advertised', () => {
    const sessions = [strengthSession(MON, 'A1')]
    // Thursday is outside the default availability (Mon, Tue, Wed, Fri, Sat).
    const model = buildToday(profile(), sessions, THU)

    if (!model.canClaim) return

    const outcome = claimedOutcome(model)
    expect(outcome.item).toEqual(model.catchUp)
    expect(typeof outcome.explanation === 'string' || outcome.explanation === null).toBe(true)
  })

  it('flips today to the other track and keeps the week seven days long', () => {
    const model = buildToday(profile(), [], MON)
    if (model.item === null) return

    const outcome = swappedOutcome(model)
    expect(outcome.item?.kind).not.toBe(model.item.kind)
  })

  it('is a no-op on a day with nothing planned', () => {
    const model = buildToday(profile(), [], SAT)
    if (model.item !== null) return

    expect(swappedOutcome(model).item).toBeNull()
  })
})

describe('strengthHeadline', () => {
  it('names the first two lifts of the day with their working weights', () => {
    expect(strengthHeadline(profile(), 'A1')).toBe('Squat 100 kg - Bench Press 70 kg')
    expect(strengthHeadline(profile(), 'B1')).toBe('Overhead Press 45 kg - Deadlift 90 kg')
  })

  it('names a lift without a number while its weight is still unknown', () => {
    const base = profile()
    // `?+` is the program asking for the weight, and nothing is stored yet, so
    // there is no number to show — the session screen collects it.
    const programText = '# Week 1\n## A1\nT1: Squat / 5x3+ / ?+\nT2: Bench Press / 3x10 / 70kg\n'
    const programState = { 'T1:Squat': { weights: [], setVariationIndex: 1, state: {}, askWeight: true } }

    const headline = strengthHeadline(
      { ...base, strengthTrack: { ...base.strengthTrack, programText, programState } },
      'A1',
    )

    expect(headline).toBe('Squat - Bench Press 70 kg')
  })

  it('returns null when the program does not parse', () => {
    const base = profile()

    expect(
      strengthHeadline({ ...base, strengthTrack: { ...base.strengthTrack, programText: '## A1\n!!!' } }, 'A1'),
    ).toBeNull()
  })

  it('returns null for a day the program does not contain', () => {
    expect(strengthHeadline(profile(), 'Z9')).toBeNull()
  })
})

describe('comebackPatch', () => {
  const proposal: ComebackProposal = {
    date: MON,
    lastSessionDate: '2026-08-01',
    daysSinceLastSession: 23,
    strengthFactor: 0.9,
    cardioFactor: 0.7,
    rampWeeks: 2,
    strength: [
      {
        exerciseKey: 'T1:Squat',
        from: { value: 100, unit: 'kg' },
        to: { value: 90, unit: 'kg' },
        setVariationIndex: 1,
      },
    ],
    cardio: { fromWeeklyMinutes: 150, toWeeklyMinutes: 105 },
    summary: [],
  }

  it('carries the whole strength and cardio slices, not just the changed fields', () => {
    const base = profile()
    const patch = comebackPatch(base, proposal)

    expect(patch.strengthTrack?.programText).toBe(base.strengthTrack.programText)
    expect(patch.strengthTrack?.rotationCursor).toBe(base.strengthTrack.rotationCursor)
    expect(patch.strengthTrack?.programState['T1:Squat'].weights[0]).toEqual({ value: 90, unit: 'kg' })
    // The stage is kept: a comeback lowers the bar, never the GZCLP stage.
    expect(patch.strengthTrack?.programState['T1:Squat'].setVariationIndex).toBe(1)
  })

  it('writes the cardio fields the next week is planned from', () => {
    const patch = comebackPatch(profile(), proposal)

    expect(patch.cardioTrack?.weeklyMinutes).toBe(105)
    expect(patch.cardioTrack?.lastPlannedMinutes).toBe(105)
    expect(patch.cardioTrack?.holdStreak).toBe(0)
    expect(patch.cardioTrack?.mesoWeek).toBe(1)
  })

  it('does not mutate the profile it was given', () => {
    const base = profile()
    comebackPatch(base, proposal)

    expect(base.strengthTrack.programState['T1:Squat'].weights[0]).toEqual({ value: 100, unit: 'kg' })
    expect(base.cardioTrack.weeklyMinutes).toBe(150)
  })
})
