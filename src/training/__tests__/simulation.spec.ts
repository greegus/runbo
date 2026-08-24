/**
 * Twelve weeks of runbo, one day at a time, through the real modules.
 *
 * Nothing here is stubbed: the profile carries the built-in GZCLP text, every
 * strength set comes out of `prescribe`, every progression runs through
 * `evaluateSession`, every day is resolved by `resolveToday`, and the state is
 * written back exactly the way the app will write it — program state and
 * rotation cursor after each strength session, the cardio mesocycle fields on
 * the Monday rollover.
 *
 * The point is the seams. Each module is unit-tested on its own; this file
 * exists to catch the things that only appear when they are wired together —
 * a stage that resets one session late, a mesocycle that reads a completed
 * deload as a missed week, a rotation cursor that quietly eats a workout.
 *
 * The scripted results deliberately contain: a clean opening block, a T1 miss,
 * a T2 miss, a full stage-3 failure with the 85 % reset, a T3 rep-target hit,
 * a half-completed cardio week, the mesocycle deload, and a 12-day gap.
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { evaluateSession, exerciseKey, prescribe } from '@/liftoscript/evaluator'
import type { ExerciseLine, PrescribedSet, Program } from '@/liftoscript/types'
import type { CardioPrescription, Profile, Session, SetLog, WeightValue } from '@/types'
import { addDays, weekdayIndexMondayFirst } from '@/utils/date'

import { applyComeback, type ComebackProposal } from '../comeback'
import { GZCLP_PROGRAM_SOURCE, GZCLP_ROTATION, gzclpProgram, initialProgramState, nextCursor, tierOf } from '../gzclp'
import { evalContextFromSettings } from '../plates'
import { planWeek, resolveToday } from '../schedule'

const UID = 'sim-user'
const START_MONDAY = '2026-01-05' // a Monday
const WEEKS = 12
const WEEK_LENGTH = 7

/** The plan's kg defaults: 20 kg bar, a pair of everything down to 1.25 kg. */
const DEFAULT_PLATES = [
  { weight: 25, count: 2 },
  { weight: 20, count: 2 },
  { weight: 15, count: 2 },
  { weight: 10, count: 2 },
  { weight: 5, count: 2 },
  { weight: 2.5, count: 2 },
  { weight: 1.25, count: 2 },
]

/** Starting weights — the same numbers the built-in program text carries. */
const SEED: Record<string, { weight: WeightValue; stage?: number }> = {
  'T1:Squat': { weight: { value: 100, unit: 'kg' } },
  'T2:Bench Press': { weight: { value: 60, unit: 'kg' } },
  'T3:Lat Pulldown': { weight: { value: 40, unit: 'kg' } },
  'T1:Overhead Press': { weight: { value: 45, unit: 'kg' } },
  'T2:Deadlift': { weight: { value: 90, unit: 'kg' } },
  'T3:Bent Over Row': { weight: { value: 40, unit: 'kg' } },
  'T1:Bench Press': { weight: { value: 80, unit: 'kg' } },
  'T2:Squat': { weight: { value: 75, unit: 'kg' } },
  'T1:Deadlift': { weight: { value: 120, unit: 'kg' } },
  'T2:Overhead Press': { weight: { value: 35, unit: 'kg' } },
}

/**
 * The script. Keyed by exercise, listing the 1-based occurrence numbers of that
 * lift that go badly. `T1:Squat` walks the entire failure ladder in one run:
 * miss at stage 1, miss at stage 2, miss at stage 3 -> reset to 85 %.
 */
const MISSED_OCCURRENCES: Record<string, number[]> = {
  'T1:Squat': [3, 4, 5],
  'T2:Bench Press': [2],
}

/** Occurrences where the athlete buries the T3 AMRAP and earns the +2.5 kg. */
const T3_BIG_AMRAP: Record<string, number[]> = {
  'T3:Lat Pulldown': [2],
}

const HALF_CARDIO_WEEK = 4 // 0-based: week 5 gets 50 % of its prescribed minutes

/**
 * The gap. Monday of week 9 is the last session; everything up to and including
 * the Friday eleven days later is skipped, so the next session lands exactly
 * twelve days after the last one (Mon + 12 = the following week's Saturday).
 */
const GAP_FIRST_SKIPPED = addDays(mondayOf(8), 1)
const GAP_LAST_SKIPPED = addDays(mondayOf(8), 11)

function mondayOf(week: number): string {
  return addDays(START_MONDAY, week * WEEK_LENGTH)
}

function makeProfile(overrides: Partial<Profile['availability']> = {}): Profile {
  return {
    id: UID,
    email: 'sim@example.com',
    settings: {
      units: 'kg',
      barbellWeight: 20,
      plates: DEFAULT_PLATES,
      restTimers: { t1: 180, t2: 120, t3: 60 },
      comebackGapDays: 10,
      notifications: { daily: true, gapNudge: true },
      fcmTokens: [],
    },
    availability: { daysPerWeek: 5, preferredDays: [0, 1, 2, 4, 5], longSessionDay: 5, ...overrides },
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
      // 90, not 60: with two cardio days a 150-minute week means 75-minute
      // sessions, and the planner refuses to prescribe past 110 % of the
      // longest session actually trained. A profile claiming 150 min/week off a
      // 60-minute longest is contradictory, and the shortfall it produces is a
      // separate, deliberately tested behaviour.
      longestSessionMinutes: 90,
      mesoWeek: 1,
      mesoStartDate: START_MONDAY,
      holdStreak: 0,
      rotationCursor: 0,
      lastPlannedMinutes: 0,
    },
    onboarding: { completed: true, step: 6 },
  }
}

// ---------------------------------------------------------------------------
// The athlete: what actually happened on each set
// ---------------------------------------------------------------------------

type SetOutcome = 'success' | 'miss' | 'big-amrap'

/**
 * A miss is one rep short on the LAST set — which at T1 stage 3 (`10x1+`) means
 * a zero, exactly the case the built-in program's comment says `zeroOrGte` would
 * have forgiven.
 */
function scriptedReps(set: PrescribedSet, outcome: SetOutcome, index: number, total: number): number {
  if (outcome === 'miss' && index === total - 1) return Math.max(0, set.reps - 1)
  if (outcome === 'big-amrap' && set.isAmrap) return 25

  return set.reps
}

function outcomeFor(key: string, occurrence: number): SetOutcome {
  if (MISSED_OCCURRENCES[key]?.includes(occurrence)) return 'miss'
  if (T3_BIG_AMRAP[key]?.includes(occurrence)) return 'big-amrap'

  return 'success'
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

interface LiftEvent {
  date: string
  programDay: string
  key: string
  stageBefore: number
  stageAfter: number
  weightBefore: WeightValue | undefined
  weightAfter: WeightValue | undefined
  outcome: SetOutcome
  summary: string
}

interface WeekObservation {
  week: number // 1-based
  monday: string
  mesoWeek: number
  baseline: number
  prescribedMinutes: number
  isDeload: boolean
  prescriptions: CardioPrescription[]
  completedMinutes: number
}

interface SimResult {
  profile: Profile
  sessions: Session[]
  weeks: WeekObservation[]
  lifts: LiftEvent[]
  trace: string[]
  /** Every day `resolveToday` offered a comeback, in calendar order. */
  comebackDays: string[]
  comebackApplied: { date: string; proposal: ComebackProposal } | null
  prescribedWeights: WeightValue[]
}

function dayIndexOf(programDay: string): number {
  const index = GZCLP_ROTATION.indexOf(programDay as (typeof GZCLP_ROTATION)[number])

  return index >= 0 ? index + 1 : 1
}

function exercisesOf(program: Program, programDay: string): ExerciseLine[] {
  for (const week of program.weeks) {
    const day = week.days.find((candidate) => candidate.name === programDay)
    if (day) return day.exercises
  }

  return []
}

function isSkipped(date: string): boolean {
  return date >= GAP_FIRST_SKIPPED && date <= GAP_LAST_SKIPPED
}

function label(date: string): string {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][weekdayIndexMondayFirst(date)]
}

function fmt(value: WeightValue | undefined): string {
  return value ? `${String(Math.round(value.value * 100) / 100)}${value.unit}` : '?'
}

function runSimulation(availability: Partial<Profile['availability']> = {}): SimResult {
  const program = gzclpProgram()
  const profile = makeProfile(availability)
  const sessions: Session[] = []
  const weeks: WeekObservation[] = []
  const lifts: LiftEvent[] = []
  const trace: string[] = []
  const comebackDays: string[] = []
  const prescribedWeights: WeightValue[] = []
  const occurrences = new Map<string, number>()

  let comebackApplied: SimResult['comebackApplied'] = null

  for (let week = 0; week < WEEKS; week += 1) {
    const monday = mondayOf(week)

    // The Monday rollover: re-plan the week that just ended off the state that
    // was in force during it, then persist what the planner says comes next.
    // This is the one write the app makes to `cardioTrack` per week.
    if (week > 0) {
      const previous = planWeek(profile, sessions, addDays(monday, -WEEK_LENGTH))

      profile.cardioTrack = {
        ...profile.cardioTrack,
        mesoWeek: previous.cardio.nextMesoWeek,
        weeklyMinutes: previous.cardio.nextBaseline,
        holdStreak: previous.cardio.holdStreak,
        rotationCursor: previous.cardio.rotationCursor,
        lastPlannedMinutes: previous.cardio.weeklyMinutes,
      }
    }

    const plan = planWeek(profile, sessions, monday)
    const observation: WeekObservation = {
      week: week + 1,
      monday,
      mesoWeek: profile.cardioTrack.mesoWeek,
      baseline: profile.cardioTrack.weeklyMinutes,
      prescribedMinutes: plan.cardio.weeklyMinutes,
      isDeload: plan.isDeloadWeek,
      prescriptions: plan.cardio.sessions,
      completedMinutes: 0,
    }
    weeks.push(observation)

    trace.push(
      `W${String(week + 1).padStart(2, '0')}  meso ${observation.mesoWeek}/4  baseline ${observation.baseline}min  ` +
        `prescribed ${observation.prescribedMinutes}min${observation.isDeload ? '  [DELOAD]' : ''}`,
    )

    for (let offset = 0; offset < WEEK_LENGTH; offset += 1) {
      const date = addDays(monday, offset)
      let today = resolveToday(profile, sessions, date)

      if (today.comebackProposal) comebackDays.push(date)

      // The app never auto-applies; the athlete accepts it on the day they come
      // back, before logging anything. Accepting rewrites the profile, so the
      // day is resolved again — the reduced prescription has to apply to the
      // session being started, not only to next week.
      if (today.comebackProposal && !comebackApplied && !isSkipped(date) && today.item) {
        const applied = applyComeback(profile, today.comebackProposal)

        profile.strengthTrack = { ...profile.strengthTrack, programState: applied.programState }
        profile.cardioTrack = applied.cardioTrack
        comebackApplied = { date, proposal: today.comebackProposal }
        trace.push(`      ${label(date)} ${date}  COMEBACK ACCEPTED — ${today.comebackProposal.summary[1]}`)
        today = resolveToday(profile, sessions, date)
      }

      if (!today.item || isSkipped(date)) continue

      if (today.item.kind === 'strength') {
        const programDay = today.item.programDay
        const ctx = evalContextFromSettings(profile.settings, { week: 1, day: dayIndexOf(programDay) })
        const snapshot = structuredClone(profile.strengthTrack.programState)
        const logged: NonNullable<Session['exercises']> = []
        const summaries: string[] = []
        const parts: string[] = []

        for (const exercise of exercisesOf(program, programDay)) {
          const key = exerciseKey(exercise)
          const state = profile.strengthTrack.programState[key]
          const occurrence = (occurrences.get(key) ?? 0) + 1
          occurrences.set(key, occurrence)

          const outcome = outcomeFor(key, occurrence)
          const { sets, diagnostics } = prescribe(program, key, state, ctx)
          expect(diagnostics).toEqual([])

          const setLogs: SetLog[] = sets.map((set, index) => ({
            prescribedReps: set.reps,
            ...(set.minReps === undefined ? {} : { minReps: set.minReps }),
            isAmrap: set.isAmrap,
            weight: set.weight,
            completedReps: scriptedReps(set, outcome, index, sets.length),
          }))
          for (const set of sets) prescribedWeights.push(set.weight)

          const before = state
          const result = evaluateSession(program, key, state, setLogs, ctx)
          expect(result.diagnostics).toEqual([])

          profile.strengthTrack.programState[key] = result.nextState
          summaries.push(result.summary)
          lifts.push({
            date,
            programDay,
            key,
            stageBefore: before.setVariationIndex,
            stageAfter: result.nextState.setVariationIndex,
            weightBefore: before.weights[0],
            weightAfter: result.nextState.weights[0],
            outcome,
            summary: result.summary,
          })

          logged.push({
            name: exercise.name,
            ...(tierOf(exercise) === undefined ? {} : { tier: tierOf(exercise) }),
            sets: setLogs,
          })
          parts.push(
            `${key} ${fmt(before.weights[0])} s${String(before.setVariationIndex)}` +
              `${outcome === 'miss' ? ' MISS' : outcome === 'big-amrap' ? ' AMRAP25' : ''}` +
              ` -> ${fmt(result.nextState.weights[0])} s${String(result.nextState.setVariationIndex)}`,
          )
        }

        sessions.push({
          id: `s-${date}`,
          uid: UID,
          date,
          kind: 'strength',
          status: 'done',
          programDay,
          exercises: logged,
          progressionSummary: summaries,
          stateSnapshot: snapshot,
        })
        profile.strengthTrack = {
          ...profile.strengthTrack,
          rotationCursor: nextCursor(profile.strengthTrack.rotationCursor),
        }

        trace.push(`      ${label(date)} ${date}  ${programDay.padEnd(3)} ${parts.join('  |  ')}`)
        continue
      }

      const prescription = today.item.prescription
      const share = week === HALF_CARDIO_WEEK ? 0.5 : 1
      const minutes = Math.round(prescription.targetMinutes * share)
      observation.completedMinutes += minutes

      sessions.push({
        id: `c-${date}`,
        uid: UID,
        date,
        kind: 'cardio',
        status: 'done',
        prescription,
        source: 'manual',
        minutes,
      })

      trace.push(
        `      ${label(date)} ${date}  ${prescription.modality} ${prescription.kind} ` +
          `${String(prescription.targetMinutes)}min Z${String(prescription.zone)}` +
          `${prescription.structure ? ` (${String(prescription.structure.reps)}x${String(prescription.structure.workMinutes)}min)` : ''}` +
          `  -> logged ${String(minutes)}min`,
      )
    }
  }

  return { profile, sessions, weeks, lifts, trace, comebackDays, comebackApplied, prescribedWeights }
}

const sim = runSimulation()

function eventsFor(key: string): LiftEvent[] {
  return sim.lifts.filter((event) => event.key === key)
}

// ---------------------------------------------------------------------------

describe('12-week simulation', () => {
  beforeAll(() => {
    console.log(`\n${sim.trace.join('\n')}\n`)
  })

  it('trains on every planned day and logs nothing on rest days', () => {
    expect(sim.sessions.length).toBeGreaterThan(40)

    const dates = sim.sessions.map((session) => session.date)
    expect(new Set(dates).size).toBe(dates.length) // never two sessions on one day
    expect(dates.every((date) => !isSkipped(date))).toBe(true)
  })
})

describe('strength — stage transitions and resets', () => {
  it('adds the per-lift increment after a clean session', () => {
    const squat = eventsFor('T1:Squat')

    expect(squat[0]).toMatchObject({ stageBefore: 1, stageAfter: 1, outcome: 'success' })
    expect(squat[0].weightBefore).toEqual({ value: 100, unit: 'kg' })
    expect(squat[0].weightAfter).toEqual({ value: 105, unit: 'kg' })
    expect(squat[1].weightAfter).toEqual({ value: 110, unit: 'kg' })
  })

  it('walks T1 up the stages on a miss and holds the weight', () => {
    const [, , first, second] = eventsFor('T1:Squat')

    // 5x3+ -> 6x2+, weight untouched.
    expect(first).toMatchObject({ outcome: 'miss', stageBefore: 1, stageAfter: 2 })
    expect(first.weightAfter).toEqual({ value: 110, unit: 'kg' })

    // 6x2+ -> 10x1+, still 110 kg.
    expect(second).toMatchObject({ outcome: 'miss', stageBefore: 2, stageAfter: 3 })
    expect(second.weightAfter).toEqual({ value: 110, unit: 'kg' })
  })

  it('resets to stage 1 at 85 % rounded to a loadable bar after failing stage 3', () => {
    const reset = eventsFor('T1:Squat')[4]

    expect(reset).toMatchObject({ outcome: 'miss', stageBefore: 3, stageAfter: 1 })
    // 110 x 0.85 = 93.5, and 93.5 is not loadable with 1.25 kg pairs -> 92.5.
    expect(reset.weightAfter).toEqual({ value: 92.5, unit: 'kg' })
    expect(reset.summary).toContain('reset to')
  })

  it('climbs again from the reset weight', () => {
    const after = eventsFor('T1:Squat')[5]

    expect(after).toMatchObject({ outcome: 'success', stageBefore: 1, stageAfter: 1 })
    expect(after.weightBefore).toEqual({ value: 92.5, unit: 'kg' })
    expect(after.weightAfter).toEqual({ value: 97.5, unit: 'kg' })
  })

  it('moves a missed T2 down the rep ladder without touching the weight', () => {
    const [first, miss] = eventsFor('T2:Bench Press')

    expect(first.weightAfter).toEqual({ value: 62.5, unit: 'kg' }) // +2.5 kg for a press
    expect(miss).toMatchObject({ outcome: 'miss', stageBefore: 1, stageAfter: 2 })
    expect(miss.weightAfter).toEqual(miss.weightBefore)
  })

  it('bumps a T3 only when the AMRAP set clears 25 reps', () => {
    const events = eventsFor('T3:Lat Pulldown')

    expect(events[0].weightAfter).toEqual(events[0].weightBefore) // 15 reps: nothing happens
    expect(events[1]).toMatchObject({ outcome: 'big-amrap' })
    expect(events[1].weightAfter).toEqual({ value: 42.5, unit: 'kg' })
    expect(events[2].weightBefore).toEqual({ value: 42.5, unit: 'kg' })
  })

  it('never prescribes or stores a weight below the empty bar', () => {
    const bar = sim.profile.settings.barbellWeight

    for (const set of sim.prescribedWeights) expect(set.value).toBeGreaterThanOrEqual(bar)
    for (const event of sim.lifts) {
      expect(event.weightAfter?.value ?? bar).toBeGreaterThanOrEqual(bar)
    }
    for (const state of Object.values(sim.profile.strengthTrack.programState)) {
      for (const weight of state.weights) expect(weight.value).toBeGreaterThanOrEqual(bar)
    }
  })

  it('keeps every stage inside the program (1..3)', () => {
    for (const event of sim.lifts) {
      expect(event.stageAfter).toBeGreaterThanOrEqual(1)
      expect(event.stageAfter).toBeLessThanOrEqual(3)
    }
  })
})

describe('rotation cursor — nothing is ever skipped', () => {
  const order = sim.sessions
    .filter((session) => session.kind === 'strength')
    .map((session) => session.programDay as string)

  it('walks A1 -> B1 -> A2 -> B2 without a break, gap and all', () => {
    for (let index = 0; index < order.length; index += 1) {
      expect(order[index]).toBe(GZCLP_ROTATION[index % GZCLP_ROTATION.length])
    }
  })

  it('balances the four program days across the block', () => {
    const counts = GZCLP_ROTATION.map((day) => order.filter((entry) => entry === day).length)

    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(order.length)
  })

  it('leaves the stored cursor pointing at the day that comes next', () => {
    expect(sim.profile.strengthTrack.rotationCursor).toBe(order.length % GZCLP_ROTATION.length)
  })
})

describe('cardio mesocycle', () => {
  it('ramps 8 % a week for three weeks, then deloads to 60 %', () => {
    const opening = sim.weeks.slice(0, 4)

    expect(opening.map((week) => week.mesoWeek)).toEqual([1, 2, 3, 4])
    expect(opening.map((week) => week.prescribedMinutes)).toEqual([150, 162, 175, 90])
    expect(opening.map((week) => week.isDeload)).toEqual([false, false, false, true])
  })

  it('rolls week 3 volume into the next baseline and restarts the mesocycle', () => {
    expect(sim.weeks[4]).toMatchObject({ mesoWeek: 1, baseline: 175, prescribedMinutes: 175, isDeload: false })
  })

  it('does NOT read a completed deload week as a missed week', () => {
    // The deload prescribes 60 % of the baseline; dividing what was done by the
    // baseline instead of by what was prescribed would score a perfect deload at
    // ~0.51 and hold week 5 for no reason.
    expect(sim.weeks[3].completedMinutes).toBe(sim.weeks[3].prescribedMinutes)
    expect(sim.weeks[4].mesoWeek).toBe(2 - 1) // advanced into a fresh block, not held
    expect(sim.weeks[4].prescribedMinutes).toBeGreaterThan(sim.weeks[3].prescribedMinutes)
  })

  it('holds the volume after a week that only got half done', () => {
    const half = sim.weeks[HALF_CARDIO_WEEK]
    const next = sim.weeks[HALF_CARDIO_WEEK + 1]

    expect(half.completedMinutes / half.prescribedMinutes).toBeLessThan(0.7)
    // Week 6 would have been meso week 2 at 189 min; instead it repeats week 5.
    expect(next.mesoWeek).toBe(2)
    expect(next.prescribedMinutes).toBe(half.prescribedMinutes)
    expect(next.baseline).toBe(half.baseline)
  })

  it('resumes the ramp once a week is completed again', () => {
    const resumed = sim.weeks[HALF_CARDIO_WEEK + 2]

    expect(resumed.mesoWeek).toBe(2)
    expect(resumed.prescribedMinutes).toBeGreaterThan(sim.weeks[HALF_CARDIO_WEEK + 1].prescribedMinutes)
  })

  it('always splits the week into whole minutes that add up', () => {
    for (const week of sim.weeks) {
      const total = week.prescriptions.reduce((sum, item) => sum + item.targetMinutes, 0)

      expect(total).toBe(week.prescribedMinutes)
      expect(week.prescriptions.every((item) => Number.isInteger(item.targetMinutes))).toBe(true)
    }
  })

  it('never puts an interval session the day before a heavy lower day', () => {
    const strengthOn = new Map(
      sim.sessions
        .filter((session) => session.kind === 'strength')
        .map((session) => [session.date, session.programDay as string]),
    )

    for (const session of sim.sessions) {
      if (session.kind !== 'cardio' || session.prescription?.kind !== 'intervals') continue

      const tomorrow = strengthOn.get(addDays(session.date, 1))
      expect(tomorrow === undefined || tomorrow === 'A2').toBe(true)
    }
  })
})

describe('the 12-day gap', () => {
  it('is exactly twelve days long', () => {
    const dates = sim.sessions.map((session) => session.date).sort()
    const gaps = dates.slice(1).map((date, index) => {
      const previous = new Date(`${dates[index]}T00:00:00Z`).getTime()

      return Math.round((new Date(`${date}T00:00:00Z`).getTime() - previous) / 86_400_000)
    })

    expect(Math.max(...gaps)).toBe(12)
  })

  it('offers the comeback on the tenth day and not a day earlier', () => {
    const first = sim.comebackDays[0]

    expect(first).toBe(addDays(mondayOf(8), 10))
    expect(sim.comebackDays.every((date) => date >= first)).toBe(true)
    // Ten days is the configured threshold, so nothing before the gap qualifies.
    expect(sim.comebackDays.filter((date) => date < GAP_FIRST_SKIPPED)).toEqual([])
  })

  it('drops the working weights to 90 %, keeps the stages, and restarts the block', () => {
    const applied = sim.comebackApplied

    expect(applied).not.toBeNull()
    expect(applied?.date).toBe(addDays(mondayOf(8), 12)) // the first day back
    expect(applied?.proposal.daysSinceLastSession).toBe(12)

    for (const change of applied?.proposal.strength ?? []) {
      expect(change.to.value).toBeLessThan(change.from.value)
      expect(change.to.value).toBeGreaterThanOrEqual(sim.profile.settings.barbellWeight)
      // 90 % rounded to a loadable bar — never more than one 2.5 kg step off.
      expect(Math.abs(change.to.value - change.from.value * 0.9)).toBeLessThanOrEqual(2.5)
    }
  })

  it('carries on training after the comeback', () => {
    const after = sim.sessions.filter((session) => session.date > GAP_LAST_SKIPPED)

    expect(after.length).toBeGreaterThan(8)
    expect(after.some((session) => session.kind === 'strength')).toBe(true)
    expect(after.some((session) => session.kind === 'cardio')).toBe(true)
  })
})

/**
 * What the DEFAULT availability (5 training days = 3 strength + 2 cardio) does
 * to the cardio week. Two days is the tightest case the splitter has to survive:
 * the 40/25/35 split has no easy session for the remaining 35 %, and before the
 * ceiling was applied to every session that remainder all landed on the long
 * one — 112 minutes for an athlete whose longest session so far is 60.
 */
describe('a two-cardio-day week', () => {
  it('spreads the remainder instead of pouring it into the long session', () => {
    const week = sim.weeks[0]

    // A two-day week has no easy session to absorb the 35 % left after the
    // 40/25 split, so it goes round robin over both rather than filling the
    // long one to the ceiling first (which gave 99 + 51).
    expect(week.prescriptions.map((item) => [item.kind, item.targetMinutes])).toEqual([
      ['long', 94],
      ['intervals', 56],
    ])
    // Both stay under 110 % of the longest session actually trained.
    const ceiling = Math.floor(sim.profile.cardioTrack.longestSessionMinutes * 1.1)
    expect(week.prescriptions.every((item) => item.targetMinutes <= ceiling)).toBe(true)
  })

  it('keeps the long session the longest one, deload week included', () => {
    for (const week of sim.weeks) {
      const long = week.prescriptions.find((item) => item.kind === 'long')
      if (!long) continue

      for (const item of week.prescriptions) expect(long.targetMinutes).toBeGreaterThanOrEqual(item.targetMinutes)
    }

    // The deload used to come out inverted — `long 36min, easy 54min`.
    expect(sim.weeks[3].prescriptions.map((item) => [item.kind, item.targetMinutes])).toEqual([
      ['long', 45],
      ['easy', 45],
    ])
  })

  it('demotes the interval session on most weeks, because Tuesday precedes a heavy lower day', () => {
    const hard = sim.sessions.filter(
      (session) => session.kind === 'cardio' && session.prescription?.kind === 'intervals',
    )
    const planned = sim.weeks.filter((week) => week.prescriptions.some((item) => item.kind === 'intervals'))

    expect(planned.length).toBeGreaterThan(hard.length)
  })
})

/**
 * The same twelve weeks on a six-day availability (3 strength + 3 cardio) —
 * the shape the cardio spec was written for. Kept as a control: with a third
 * cardio day the split respects the long-session cap.
 */
describe('six training days — the split the cardio spec describes', () => {
  const wide = runSimulation({ daysPerWeek: 6, preferredDays: [0, 1, 2, 3, 4, 5] })

  beforeAll(() => {
    console.log(`\n--- control run: 6 training days ---\n${wide.trace.slice(0, 12).join('\n')}\n`)
  })

  it('keeps every session inside 110 % of the longest session so far, or the even share', () => {
    for (const week of wide.weeks) {
      // The ceiling only lifts when the week's own volume cannot fit under it
      // even spread evenly across the days — by week 7 that is 204/3 = 68.
      const ceiling = Math.max(
        Math.floor(wide.profile.cardioTrack.longestSessionMinutes * 1.1),
        Math.ceil(week.prescribedMinutes / week.prescriptions.length),
      )

      for (const item of week.prescriptions) expect(item.targetMinutes).toBeLessThanOrEqual(ceiling)
    }
  })

  it('runs three cardio sessions a week and still balances the strength rotation', () => {
    expect(wide.weeks[0].prescriptions.map((item) => item.kind)).toEqual(['long', 'intervals', 'easy'])

    const order = wide.sessions
      .filter((session) => session.kind === 'strength')
      .map((session) => session.programDay as string)

    for (let index = 0; index < order.length; index += 1) {
      expect(order[index]).toBe(GZCLP_ROTATION[index % GZCLP_ROTATION.length])
    }
  })
})

describe('determinism', () => {
  it('produces byte-identical state when replayed', () => {
    const replay = runSimulation()

    expect(replay.sessions).toEqual(sim.sessions)
    expect(replay.profile).toEqual(sim.profile)
  })
})
