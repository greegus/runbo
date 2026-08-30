/**
 * End-to-end regression test for the whole Liftoscript engine: real program
 * text goes through parser -> prescribe -> evaluateSession -> serializer, with
 * nothing hand-built. The per-module specs test the pieces; this one is the
 * guard against the pieces drifting apart.
 *
 * The GZCLP cases here are the acceptance criteria from the plan (Phase 2).
 */

import { describe, expect, it } from 'vitest'

import type { ExerciseState, SetLog } from '@/types'

import { unsupportedMessage } from '../diagnostics'
import { evaluateSession, exerciseKey, prescribe } from '../evaluator'
import { parseProgram } from '../parser'
import { serializeProgram } from '../serialize'
import type { EvalContext, PrescribedSet, Program } from '../types'
import { cardio, EXPECTED_UNSUPPORTED, fixtures, gzclpBuiltin, PROGRAMS_WITH_ERRORS, unsupported } from './fixtures'

/** The kg defaults from `Profile.settings`: a 20 kg bar, 1.25 kg smallest plate. */
const ctx: EvalContext = {
  units: 'kg',
  plates: [
    { weight: 25, count: 2 },
    { weight: 20, count: 2 },
    { weight: 15, count: 2 },
    { weight: 10, count: 2 },
    { weight: 5, count: 2 },
    { weight: 2.5, count: 2 },
    { weight: 1.25, count: 2 },
  ],
  barbellWeight: 20,
  week: 1,
  day: 1,
}

const program: Program = parseProgram(gzclpBuiltin).program

function state(kg: number, setVariationIndex = 1): ExerciseState {
  return { weights: [{ value: kg, unit: 'kg' }], setVariationIndex, state: {} }
}

/**
 * Builds the session log the way the app does: from the prescription, with the
 * user's actual reps filled in. `null` is an untouched/skipped set.
 */
function logSession(sets: PrescribedSet[], completed: (number | null)[]): SetLog[] {
  return sets.map((set, index) => ({
    prescribedReps: set.reps,
    ...(set.minReps === undefined ? {} : { minReps: set.minReps }),
    isAmrap: set.isAmrap,
    completedReps: completed[index] ?? null,
    weight: set.weight,
  }))
}

/** prescribe -> log the given reps -> evaluateSession, for one exercise. */
function runSession(name: string, before: ExerciseState, completed: (number | null)[]) {
  const prescription = prescribe(program, name, before, ctx)
  expect(prescription.diagnostics).toEqual([])

  const result = evaluateSession(program, name, before, logSession(prescription.sets, completed), ctx)
  expect(result.diagnostics).toEqual([])

  return result
}

describe('the built-in GZCLP program, end to end', () => {
  it('parses with zero diagnostics', () => {
    expect(parseProgram(gzclpBuiltin).diagnostics).toEqual([])
  })

  it('prescribes T1 Squat stage 1 as 5x3 with the last set AMRAP, plus warmups', () => {
    const result = prescribe(program, 'Squat', state(100), ctx)

    expect(result.diagnostics).toEqual([])
    expect(result.sets).toHaveLength(5)
    expect(result.sets.map((set) => set.reps)).toEqual([3, 3, 3, 3, 3])
    expect(result.sets.map((set) => set.isAmrap)).toEqual([false, false, false, false, true])
    expect(result.sets.every((set) => set.weight.value === 100 && set.weight.unit === 'kg')).toBe(true)

    // `warmup: 1x5 20kg, 1x3 55%, 1x2 75%` against a 100 kg working weight
    expect(result.warmup).toEqual([
      { reps: 5, weight: { value: 20, unit: 'kg' } },
      { reps: 3, weight: { value: 55, unit: 'kg' } },
      { reps: 2, weight: { value: 75, unit: 'kg' } },
    ])
  })

  it('adds state.inc after a fully completed session', () => {
    const result = runSession('Squat', state(100), [3, 3, 3, 3, 6])

    expect(result.nextState.weights).toEqual([{ value: 105, unit: 'kg' }])
    expect(result.nextState.setVariationIndex).toBe(1)
    expect(result.summary).toBe('Squat: 100 kg -> 105 kg')
  })

  it('advances to stage 2 and holds the weight after a missed set', () => {
    const result = runSession('Squat', state(100), [3, 3, 3, 3, 2])

    expect(result.nextState.setVariationIndex).toBe(2)
    expect(result.nextState.weights).toEqual([{ value: 100, unit: 'kg' }])
    expect(prescribe(program, 'Squat', result.nextState, ctx).sets).toHaveLength(6)
  })

  it('treats a skipped set as a failed session rather than forgiving it', () => {
    // The trap this guards: `zeroOrGte` (Liftosaur's helper for optional sets)
    // reads 0 as "not done" and passes the session, which would hand out a
    // weight increase for a workout that was not finished.
    const result = runSession('Squat', state(100), [3, 3, 3, null, null])

    expect(result.nextState.weights).toEqual([{ value: 100, unit: 'kg' }])
    expect(result.nextState.setVariationIndex).toBe(2)
  })

  it('resets T1 from 10x1+ when a single is missed', () => {
    // At stage 3 every set is one rep, so a miss IS a zero. Forgiving zeros here
    // would strand T1 at stage 3 forever, and the GZCLP cycle would never restart.
    const result = runSession('Squat', state(120, 3), [1, 1, 1, 1, 1, 1, 1, 0, 0, 0])

    expect(result.nextState.setVariationIndex).toBe(1)
    expect(result.nextState.weights).toEqual([{ value: 102.5, unit: 'kg' }])
  })

  it('resets to stage 1 at 85% of the failed weight when stage 3 is missed', () => {
    const result = runSession('Bench Press', state(100, 3), [6, 6, 5])

    expect(result.nextState.setVariationIndex).toBe(1)
    expect(result.nextState.weights).toEqual([{ value: 85, unit: 'kg' }])
    expect(prescribe(program, 'Bench Press', result.nextState, ctx).sets).toHaveLength(3)
  })

  it('rounds the reset weight to a loadable weight', () => {
    // 102.5 x 0.85 = 87.125, and 2 x 1.25 kg is the smallest loadable step
    const result = runSession('Bench Press', state(102.5, 3), [6, 6, 5])

    expect(result.nextState.weights).toEqual([{ value: 87.5, unit: 'kg' }])
  })

  it('carries the progressed weight into the next prescription', () => {
    // The weight written in the program text is a seed, not a fixed prescription:
    // two clean sessions in a row must show 100 -> 105 -> 110 kg.
    const first = runSession('Squat', state(100), [3, 3, 3, 3, 6])
    const second = runSession('Squat', first.nextState, [3, 3, 3, 3, 5])

    expect(prescribe(program, 'Squat', first.nextState, ctx).sets[0].weight).toEqual({ value: 105, unit: 'kg' })
    expect(second.nextState.weights).toEqual([{ value: 110, unit: 'kg' }])
    expect(prescribe(program, 'Squat', second.nextState, ctx).warmup).toEqual([
      { reps: 5, weight: { value: 20, unit: 'kg' } },
      { reps: 3, weight: { value: 60, unit: 'kg' } },
      { reps: 2, weight: { value: 82.5, unit: 'kg' } },
    ])
  })

  it('adds 2.5 kg to a T3 lift only when its AMRAP set reaches 25 reps', () => {
    const hit = runSession('Lat Pulldown', state(40), [15, 15, 25])
    expect(hit.nextState.weights).toEqual([{ value: 42.5, unit: 'kg' }])

    const miss = runSession('Lat Pulldown', state(40), [15, 15, 24])
    expect(miss.nextState.weights).toEqual([{ value: 40, unit: 'kg' }])
  })
})

describe('the cardio extension', () => {
  it('parses durations, distances, zones and rests without diagnostics', () => {
    const parsed = parseProgram(cardio)
    expect(parsed.diagnostics).toEqual([])

    const groups = parsed.program.weeks[0].days.flatMap((day) =>
      day.exercises.map((exercise) => ({
        name: exercise.name,
        group: exercise.setVariations[0][0],
        sections: exercise.sections,
      })),
    )
    const intervals = groups.find((entry) => entry.name === 'Swim')!
    // `8x100m` is eight 100 metre repeats, not 100 minutes
    expect(intervals.group).toMatchObject({ count: 8, distance: { value: 100, unit: 'm' }, zone: 3 })
    expect(intervals.sections.restSec).toBe(30)

    const easyRun = groups.find((entry) => entry.name === 'Run')!
    expect(easyRun.group).toMatchObject({ count: 1, duration: 2400, zone: 2 })
  })
})

describe('parse -> serialize -> parse', () => {
  const clean = Object.entries(fixtures).filter(([name]) => !PROGRAMS_WITH_ERRORS.has(name))

  it.each(clean)('is stable for %s', (_name, source) => {
    const first = parseProgram(source)
    expect(first.diagnostics).toEqual([])

    const text = serializeProgram(first.program)
    const second = parseProgram(text)

    expect(second.diagnostics).toEqual([])
    expect(serializeProgram(second.program)).toBe(text)
  })
})

describe('unsupported constructs', () => {
  const diagnostics = parseProgram(unsupported).diagnostics

  it('reports one diagnostic per construct, on the right line', () => {
    expect(diagnostics.map(({ line, message }) => ({ line, message }))).toEqual(
      EXPECTED_UNSUPPORTED.map(({ id, line }) => ({ line, message: unsupportedMessage(id) })),
    )
    expect(diagnostics.every((diagnostic) => diagnostic.severity === 'error')).toBe(true)
    expect(diagnostics.every((diagnostic) => diagnostic.col >= 1 && diagnostic.sourceLine.length > 0)).toBe(true)
  })
})

describe('exercise keys', () => {
  // GZCLP squats twice per rotation - heavy on A1, volume on A2 - and those are two independent
  // progressions. Keyed by name alone they would share one weight and one stage.
  const squatT1 = program.weeks[0].days[0].exercises.find((exercise) => exercise.name === 'Squat')!
  const squatT2 = program.weeks[0].days[2].exercises.find((exercise) => exercise.name === 'Squat')!

  it('separates T1 Squat from T2 Squat', () => {
    expect(exerciseKey(squatT1)).toBe('T1:Squat')
    expect(exerciseKey(squatT2)).toBe('T2:Squat')
  })

  it('resolves a key to the line on the day being trained', () => {
    const onA1 = prescribe(program, 'T1:Squat', state(100), { ...ctx, day: 1 })
    const onA2 = prescribe(program, 'T2:Squat', state(75), { ...ctx, day: 3 })

    expect(onA1.sets).toHaveLength(5)
    expect(onA1.sets[4].isAmrap).toBe(true)
    expect(onA2.sets).toHaveLength(3)
    expect(onA2.sets[0].reps).toBe(10)
  })

  it('progresses the two independently', () => {
    const t1After = evaluateSession(
      program,
      'T1:Squat',
      state(100),
      logSession(prescribe(program, 'T1:Squat', state(100), { ...ctx, day: 1 }).sets, [3, 3, 3, 3, 5]),
      { ...ctx, day: 1 },
    )
    expect(t1After.nextState.weights[0].value).toBe(105)

    const t2After = evaluateSession(
      program,
      'T2:Squat',
      state(75),
      logSession(prescribe(program, 'T2:Squat', state(75), { ...ctx, day: 3 }).sets, [10, 10, 10]),
      { ...ctx, day: 3 },
    )
    expect(t2After.nextState.weights[0].value).toBe(80)
  })
})
