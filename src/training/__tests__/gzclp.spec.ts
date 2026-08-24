import { gzclpBuiltin } from '@/liftoscript/__tests__/fixtures'
import { exerciseKey, prescribe } from '@/liftoscript/evaluator'
import { parseProgram } from '@/liftoscript/parser'
import type { EvalContext } from '@/liftoscript/types'
import type { ExerciseState } from '@/types'

import {
  buildGzclpProgram,
  containsLowerLift,
  DEFAULT_REST_TIMERS,
  GZCLP_PROGRAM_SOURCE,
  GZCLP_ROTATION,
  gzclpProgram,
  initialProgramState,
  isHeavyLowerDay,
  nextCursor,
  programDayAt,
  restTimerFor,
  seedFromFiveRepMax,
  seedFromOneRepMax,
  tierOf,
} from '../gzclp'
import type { GzclpSeed } from '../gzclp'

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

const fullSeed: GzclpSeed = {
  'T1:Squat': { weight: { value: 110, unit: 'kg' }, stage: 1 },
  'T2:Squat': { weight: { value: 80, unit: 'kg' }, stage: 2 },
  'T1:Bench Press': { weight: { value: 85, unit: 'kg' }, stage: 1 },
  'T2:Bench Press': { weight: { value: 62.5, unit: 'kg' }, stage: 1 },
  'T1:Deadlift': { weight: { value: 130, unit: 'kg' }, stage: 3 },
  'T2:Deadlift': { weight: { value: 95, unit: 'kg' }, stage: 1 },
  'T1:Overhead Press': { weight: { value: 50, unit: 'kg' }, stage: 1 },
  'T2:Overhead Press': { weight: { value: 37.5, unit: 'kg' }, stage: 1 },
  'T3:Lat Pulldown': { weight: { value: 45, unit: 'kg' }, stage: 1 },
  'T3:Bent Over Row': { weight: { value: 42.5, unit: 'kg' }, stage: 1 },
}

/** A state that carries no weight yet, so the prescription falls back to the text. */
function emptyState(setVariationIndex = 1): ExerciseState {
  return { weights: [], setVariationIndex, state: {} }
}

describe('GZCLP_PROGRAM_SOURCE', () => {
  it('is the engine-verified fixture, verbatim', () => {
    expect(GZCLP_PROGRAM_SOURCE).toBe(gzclpBuiltin)
  })

  it('parses with zero diagnostics', () => {
    expect(parseProgram(GZCLP_PROGRAM_SOURCE).diagnostics).toEqual([])
  })

  it('has the four rotation days, in order', () => {
    const days = gzclpProgram().weeks.flatMap((week) => week.days.map((day) => day.name))
    expect(days).toEqual([...GZCLP_ROTATION])
  })
})

describe('buildGzclpProgram', () => {
  it('produces text that parses clean and prescribes the seeded weights', () => {
    const text = buildGzclpProgram(fullSeed)
    const { program, diagnostics } = parseProgram(text)
    expect(diagnostics).toEqual([])

    const squat = prescribe(program, 'T1:Squat', emptyState(), ctx)
    expect(squat.sets).toHaveLength(5)
    expect(squat.sets.every((set) => set.weight.value === 110)).toBe(true)
    expect(squat.sets.every((set) => set.askWeight)).toBe(false)

    // The same lift at a different tier keeps its own weight.
    const t2Squat = prescribe(program, 'T2:Squat', emptyState(), ctx)
    expect(t2Squat.sets[0].weight).toEqual({ value: 80, unit: 'kg' })

    const row = prescribe(program, 'T3:Bent Over Row', emptyState(), ctx)
    expect(row.sets[0].weight).toEqual({ value: 42.5, unit: 'kg' })
  })

  it('keeps the seeded weight on every set variation, not just the first', () => {
    const text = buildGzclpProgram(fullSeed)
    const { program } = parseProgram(text)

    for (const stage of [1, 2, 3]) {
      const sets = prescribe(program, 'T1:Deadlift', emptyState(stage), ctx).sets
      expect(sets.every((set) => set.weight.value === 130)).toBe(true)
    }
  })

  it('emits ask-weight sets for the lifts the seed does not mention', () => {
    const text = buildGzclpProgram({ 'T1:Squat': { weight: { value: 100, unit: 'kg' } } })
    expect(text).toContain('?+')

    const { program, diagnostics } = parseProgram(text)
    expect(diagnostics).toEqual([])

    const ohp = prescribe(program, 'T1:Overhead Press', emptyState(), ctx)
    expect(ohp.sets.every((set) => set.askWeight)).toBe(true)

    const squat = prescribe(program, 'T1:Squat', emptyState(), ctx)
    expect(squat.sets.every((set) => set.askWeight === undefined)).toBe(true)
    expect(squat.sets[0].weight.value).toBe(100)
  })

  it('leaves the warmup ramp and the progression scripts untouched', () => {
    const text = buildGzclpProgram({})
    expect(text).toContain('warmup: 1x5 20kg, 1x3 55%, 1x2 75%')
    expect(text).toContain('progress: custom(inc: 5kg, resetFactor: 0.85)')
    expect(text).toContain('completedReps >= reps')
  })
})

describe('seedFromFiveRepMax', () => {
  it('takes 85 % for T1 and 65 % for T2, rounded to a loadable weight', () => {
    // 102 kg 5RM: T1 wants 86.7 kg, T2 wants 66.3 kg — neither is loadable.
    expect(seedFromFiveRepMax('T1:Squat', { value: 102, unit: 'kg' }, ctx)).toEqual({
      weight: { value: 87.5, unit: 'kg' },
      stage: 1,
    })
    expect(seedFromFiveRepMax('T2:Squat', { value: 102, unit: 'kg' }, ctx)).toEqual({
      weight: { value: 67.5, unit: 'kg' },
      stage: 1,
    })
  })

  it('rounds every result onto the plate inventory (multiples of 2.5 kg here)', () => {
    for (let fiveRm = 40; fiveRm <= 200; fiveRm += 1) {
      const seeded = seedFromFiveRepMax('T1:Deadlift', { value: fiveRm, unit: 'kg' }, ctx)
      expect(seeded.weight.value % 2.5).toBe(0)
      expect(seeded.weight.value).toBeGreaterThanOrEqual(ctx.barbellWeight)
    }
  })

  it('starts every lift at stage 1', () => {
    expect(seedFromFiveRepMax('T3:Lat Pulldown', { value: 60, unit: 'kg' }, ctx).stage).toBe(1)
  })
})

describe('seedFromOneRepMax', () => {
  it('goes through the inverse of Epley', () => {
    // 120 kg 1RM -> 120 / (1 + 5/30) = 102.86 kg 5RM -> 85 % = 87.4 -> 87.5 kg.
    expect(seedFromOneRepMax('T1:Squat', { value: 120, unit: 'kg' }, ctx).weight).toEqual({
      value: 87.5,
      unit: 'kg',
    })
  })

  it('is lighter than seeding the same number as a 5RM', () => {
    const asOneRm = seedFromOneRepMax('T1:Bench Press', { value: 100, unit: 'kg' }, ctx)
    const asFiveRm = seedFromFiveRepMax('T1:Bench Press', { value: 100, unit: 'kg' }, ctx)
    expect(asOneRm.weight.value).toBeLessThan(asFiveRm.weight.value)
  })
})

describe('initialProgramState', () => {
  it('keys state by exerciseKey and carries weight, stage and state vars', () => {
    const state = initialProgramState(GZCLP_PROGRAM_SOURCE, fullSeed)

    expect(Object.keys(state).sort()).toEqual(Object.keys(fullSeed).sort())
    expect(state['T1:Squat']).toEqual({
      weights: [{ value: 110, unit: 'kg' }],
      setVariationIndex: 1,
      state: { inc: { value: 5, unit: 'kg' }, resetFactor: 0.85 },
    })
    expect(state['T1:Deadlift'].setVariationIndex).toBe(3)
    expect(state['T2:Squat'].setVariationIndex).toBe(2)
    // T3 has an empty `custom()` — no state vars to seed.
    expect(state['T3:Lat Pulldown'].state).toEqual({})
  })

  it('marks unseeded lifts as ask-weight with no stored weight', () => {
    const state = initialProgramState(GZCLP_PROGRAM_SOURCE, {})

    expect(state['T1:Squat']).toEqual({
      weights: [],
      setVariationIndex: 1,
      state: { inc: { value: 5, unit: 'kg' }, resetFactor: 0.85 },
      askWeight: true,
    })
  })

  it('clamps a stage that the program has no variation for', () => {
    const state = initialProgramState(GZCLP_PROGRAM_SOURCE, {
      'T3:Lat Pulldown': { weight: { value: 40, unit: 'kg' }, stage: 4 },
      'T1:Squat': { weight: { value: 100, unit: 'kg' }, stage: 0 },
    })

    expect(state['T3:Lat Pulldown'].setVariationIndex).toBe(1) // T3 has one variation
    expect(state['T1:Squat'].setVariationIndex).toBe(1)
  })

  it('works against a program built from a seed', () => {
    const state = initialProgramState(buildGzclpProgram(fullSeed), fullSeed)
    expect(state['T2:Overhead Press'].weights).toEqual([{ value: 37.5, unit: 'kg' }])
  })
})

describe('rotation', () => {
  it('cycles A1 -> B1 -> A2 -> B2', () => {
    expect([0, 1, 2, 3, 4].map(programDayAt)).toEqual(['A1', 'B1', 'A2', 'B2', 'A1'])
    expect(nextCursor(3)).toBe(0)
    expect(programDayAt(-1)).toBe('B2')
  })
})

describe('isHeavyLowerDay', () => {
  /**
   * Verified against the built-in program text: EVERY day trains a squat or a
   * deadlift — A1 = T1 Squat + T2 Bench, B1 = T1 OHP + T2 Deadlift,
   * A2 = T1 Bench + T2 Squat, B2 = T1 Deadlift + T2 OHP. A rule of "contains a
   * T1 or T2 squat/deadlift" is therefore true for all four days
   * (`containsLowerLift` below) and useless as an interference rule. The heavy
   * days the plan names (A1/B1/B2) fall out of the finer rule: any deadlift, or
   * a squat as the day's T1. A2's squat is T2 back-off volume, so A2 is NOT a
   * heavy lower day.
   */
  it('is true for A1, B1 and B2 and false for A2', () => {
    expect(isHeavyLowerDay('A1')).toBe(true)
    expect(isHeavyLowerDay('B1')).toBe(true)
    expect(isHeavyLowerDay('B2')).toBe(true)
    expect(isHeavyLowerDay('A2')).toBe(false)
  })

  it('reads the parsed program, so a rewritten day changes the answer', () => {
    // Swap A2's T2 Squat for a T1 Squat: the day becomes heavy.
    const source = GZCLP_PROGRAM_SOURCE.replace('T2: Squat / 3x10', 'T1: Squat / 3x10')
    const { program, diagnostics } = parseProgram(source)
    expect(diagnostics).toEqual([])
    expect(isHeavyLowerDay('A2', program)).toBe(true)
  })

  it('is false for a day that is not in the program', () => {
    expect(isHeavyLowerDay('C1')).toBe(false)
  })

  it('containsLowerLift is the broad rule and holds for every day', () => {
    expect(GZCLP_ROTATION.every((day) => containsLowerLift(day))).toBe(true)
  })
})

describe('tierOf / restTimerFor', () => {
  it('reads the T1/T2/T3 label', () => {
    expect(tierOf({ label: 'T1' })).toBe(1)
    expect(tierOf({ label: 't2' })).toBe(2)
    expect(tierOf({ label: 'T3' })).toBe(3)
    expect(tierOf({})).toBeUndefined()
  })

  it('defaults to 180/120/60 s and honours configured timers', () => {
    expect([1, 2, 3].map((tier) => restTimerFor(tier as 1 | 2 | 3))).toEqual([180, 120, 60])
    expect(restTimerFor(undefined)).toBe(DEFAULT_REST_TIMERS.t3)
    expect(restTimerFor(1, { t1: 240, t2: 150, t3: 90 })).toBe(240)
  })

  it('gives every line of the built-in program a rest timer', () => {
    const exercises = gzclpProgram().weeks.flatMap((week) => week.days.flatMap((day) => day.exercises))
    for (const exercise of exercises) {
      expect(restTimerFor(tierOf(exercise))).toBeGreaterThan(0)
      expect(exerciseKey(exercise)).toContain(':')
    }
  })
})
