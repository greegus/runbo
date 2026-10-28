import { describe, expect, it } from 'vitest'

import { parseProgram } from '@/liftoscript/parser'
import type { EvalContext, PrescribedSet, Program } from '@/liftoscript/types'
import { GZCLP_PROGRAM_SOURCE, gzclpProgram, initialProgramState } from '@/training/gzclp'
import type { ExerciseState } from '@/types'

import { DEFAULT_PROJECTED_SESSIONS, projectLift, setsLabel } from '../projection'

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

const SEEDED = initialProgramState(GZCLP_PROGRAM_SOURCE, {
  'T1:Squat': { weight: { value: 100, unit: 'kg' } },
  'T2:Bench Press': { weight: { value: 60, unit: 'kg' }, stage: 3 },
  'T3:Lat Pulldown': { weight: { value: 40, unit: 'kg' } },
})

function parse(source: string): Program {
  const { program, diagnostics } = parseProgram(source)
  expect(diagnostics).toEqual([])
  return program
}

function set(reps: number, overrides: Partial<PrescribedSet> = {}): PrescribedSet {
  return { reps, isAmrap: false, weight: { value: 100, unit: 'kg' }, ...overrides }
}

describe('projectLift', () => {
  it('walks a GZCLP T1 up by its increment while every session goes to plan', () => {
    const { sessions, diagnostics } = projectLift(gzclpProgram(), 'T1:Squat', SEEDED['T1:Squat'], ctx, { count: 4 })

    expect(diagnostics).toEqual([])
    expect(sessions.map((session) => session.weight.value)).toEqual([100, 105, 110, 115])
    expect(sessions.map((session) => session.stage)).toEqual([1, 1, 1, 1])
    expect(sessions.every((session) => setsLabel(session.sets) === '5×3+')).toBe(true)
    expect(sessions.map((session) => session.index)).toEqual([1, 2, 3, 4])
  })

  it('uses the per-lift increment carried in state', () => {
    const { sessions } = projectLift(gzclpProgram(), 'T2:Bench Press', SEEDED['T2:Bench Press'], ctx, { count: 3 })

    expect(sessions.map((session) => session.weight.value)).toEqual([60, 62.5, 65])
    expect(sessions.map((session) => setsLabel(session.sets))).toEqual(['3×6', '3×6', '3×6'])
  })

  it('keeps a T3 flat: the +2.5 kg needs a 25-rep AMRAP nobody has done yet', () => {
    const { sessions } = projectLift(gzclpProgram(), 'T3:Lat Pulldown', SEEDED['T3:Lat Pulldown'], ctx, { count: 3 })

    expect(sessions.map((session) => session.weight.value)).toEqual([40, 40, 40])
  })

  it('lists the default number of sessions', () => {
    const { sessions } = projectLift(gzclpProgram(), 'T1:Squat', SEEDED['T1:Squat'], ctx)

    expect(sessions).toHaveLength(DEFAULT_PROJECTED_SESSIONS)
  })

  it('never writes to the state it was given', () => {
    const state = structuredClone(SEEDED['T1:Squat'])
    projectLift(gzclpProgram(), 'T1:Squat', state, ctx, { count: 3 })

    expect(state).toEqual(SEEDED['T1:Squat'])
  })

  it('follows stage changes and flags a step back as a reset', () => {
    const program = parse(`# Week 1
## Day 1
Squat / 3x5 / 3x3 / 3x1 / 100kg / progress: custom() {~
  if (setVariationIndex >= 3) {
    setVariationIndex = 1
    weights += 5kg
  } else {
    setVariationIndex += 1
  }
~}
`)
    const state: ExerciseState = { weights: [{ value: 100, unit: 'kg' }], setVariationIndex: 1, state: {} }

    const { sessions } = projectLift(program, 'Squat', state, ctx, { count: 5 })

    expect(sessions.map((session) => session.stage)).toEqual([1, 2, 3, 1, 2])
    expect(sessions.map((session) => session.stageReset)).toEqual([false, false, false, true, false])
    expect(sessions.map((session) => session.weight.value)).toEqual([100, 100, 100, 105, 105])
  })

  it('projects nothing for a lift whose weight is not known yet', () => {
    const state: ExerciseState = {
      weights: [],
      setVariationIndex: 1,
      state: { inc: { value: 5, unit: 'kg' } },
      askWeight: true,
    }

    expect(projectLift(gzclpProgram(), 'T1:Squat', state, ctx)).toEqual({ sessions: [], diagnostics: [] })
  })

  it('projects from the weight on the bar when one is given', () => {
    const state: ExerciseState = {
      weights: [],
      setVariationIndex: 1,
      state: { inc: { value: 5, unit: 'kg' }, resetFactor: 0.85 },
      askWeight: true,
    }

    const { sessions } = projectLift(gzclpProgram(), 'T1:Squat', state, ctx, {
      count: 3,
      workingWeight: { value: 80, unit: 'kg' },
    })

    expect(sessions.map((session) => session.weight.value)).toEqual([80, 85, 90])
    expect(sessions.every((session) => session.sets.every((item) => item.askWeight !== true))).toBe(true)
  })

  it('stops with the engine diagnostics for a lift the program does not have', () => {
    const { sessions, diagnostics } = projectLift(gzclpProgram(), 'T1:Curl', SEEDED['T1:Squat'], ctx)

    expect(sessions).toEqual([])
    expect(diagnostics).toHaveLength(1)
  })

  it('projects nothing when asked for no sessions', () => {
    expect(projectLift(gzclpProgram(), 'T1:Squat', SEEDED['T1:Squat'], ctx, { count: 0 }).sessions).toEqual([])
  })
})

describe('setsLabel', () => {
  it('folds a trailing AMRAP into its group', () => {
    expect(setsLabel([set(3), set(3), set(3), set(3), set(3, { isAmrap: true })])).toBe('5×3+')
  })

  it('writes a range as the program does', () => {
    expect(setsLabel([set(12, { minReps: 8 }), set(12, { minReps: 8 })])).toBe('2×8-12')
  })

  it('keeps different rep targets apart', () => {
    expect(setsLabel([set(5), set(3), set(3)])).toBe('1×5, 2×3')
  })

  it('starts a new group after an AMRAP', () => {
    expect(setsLabel([set(3, { isAmrap: true }), set(3)])).toBe('1×3+, 1×3')
  })
})
