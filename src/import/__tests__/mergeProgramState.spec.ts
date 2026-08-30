import { parseProgramOrThrow } from '@/liftoscript/parser'
import type { ExerciseState, WeightValue } from '@/types'

import { mergeProgramState, variationCounts } from '../mergeProgramState'

function kg(value: number): WeightValue {
  return { value, unit: 'kg' }
}

function state(weight: number, setVariationIndex = 1, extra: Partial<ExerciseState> = {}): ExerciseState {
  return { weights: [kg(weight)], setVariationIndex, state: {}, ...extra }
}

describe('mergeProgramState', () => {
  it('keeps an existing lift wholesale and seeds only the new one', () => {
    const existing = {
      'T1:Squat': state(140, 2, { state: { increase: 5 } }),
      'T2:Bench Press': state(80),
    }
    const adopted = {
      'T1:Squat': state(100, 1),
      'T2:Bench Press': state(60),
      'T3:Lat Pulldown': state(40, 1, { askWeight: true }),
    }

    const result = mergeProgramState(existing, adopted)

    // The earned weight, stage and state vars survive the edit untouched.
    expect(result.programState['T1:Squat']).toEqual(existing['T1:Squat'])
    expect(result.programState['T2:Bench Press']).toEqual(existing['T2:Bench Press'])
    expect(result.programState['T3:Lat Pulldown']).toEqual(adopted['T3:Lat Pulldown'])
    expect(result.kept).toEqual(['T1:Squat', 'T2:Bench Press'])
    expect(result.seeded).toEqual(['T3:Lat Pulldown'])
    expect(result.dropped).toEqual([])
  })

  it('copies rather than aliases the states it carries over', () => {
    const existing = { 'T1:Squat': state(140) }
    const result = mergeProgramState(existing, { 'T1:Squat': state(100) })

    result.programState['T1:Squat'].weights[0].value = 999

    expect(existing['T1:Squat'].weights[0].value).toBe(140)
  })

  it('reports a renamed lift as a drop and a seed', () => {
    const result = mergeProgramState({ 'T1:Squat': state(140) }, { 'T1:Back Squat': state(100) })

    expect(result.dropped).toEqual(['T1:Squat'])
    expect(result.seeded).toEqual(['T1:Back Squat'])
    expect(result.kept).toEqual([])
    expect(Object.keys(result.programState)).toEqual(['T1:Back Squat'])
  })

  it('clamps a stage the shrunken program no longer has, and still reports it kept', () => {
    const result = mergeProgramState(
      { 'T1:Squat': state(140, 3) },
      { 'T1:Squat': state(100, 1) },
      {
        variationCounts: { 'T1:Squat': 2 },
      },
    )

    expect(result.programState['T1:Squat'].setVariationIndex).toBe(2)
    expect(result.programState['T1:Squat'].weights).toEqual([kg(140)])
    expect(result.kept).toEqual(['T1:Squat'])
  })

  it('leaves the stage alone when no variation count is known', () => {
    const result = mergeProgramState({ 'T1:Squat': state(140, 3) }, { 'T1:Squat': state(100, 1) })

    expect(result.programState['T1:Squat'].setVariationIndex).toBe(3)
  })

  it('never lets a stage fall below 1', () => {
    const result = mergeProgramState(
      { 'T1:Squat': state(140, 0) },
      { 'T1:Squat': state(100, 1) },
      {
        variationCounts: { 'T1:Squat': 3 },
      },
    )

    expect(result.programState['T1:Squat'].setVariationIndex).toBe(1)
  })

  it('seeds everything when there is no existing state', () => {
    const adopted = { 'T1:Squat': state(100), 'T2:Bench Press': state(60) }
    const result = mergeProgramState({}, adopted)

    expect(result.programState).toEqual(adopted)
    expect(result.seeded).toEqual(['T1:Squat', 'T2:Bench Press'])
    expect(result.kept).toEqual([])
    expect(result.dropped).toEqual([])
  })

  it('drops everything when the new program has no lifts', () => {
    const result = mergeProgramState({ 'T1:Squat': state(140), 'T2:Bench Press': state(80) }, {})

    expect(result.programState).toEqual({})
    expect(result.dropped).toEqual(['T1:Squat', 'T2:Bench Press'])
    expect(result.kept).toEqual([])
  })
})

describe('variationCounts', () => {
  it('counts the set variations of each key, first line winning', () => {
    const program = parseProgramOrThrow(
      [
        '# Week 1',
        '## Day 1',
        'T1: Squat / 5x3+ / 6x2+ / 10x1+ / 100kg / progress: none',
        'T3: Lat Pulldown / 3x15 / 40kg / progress: none',
        '## Day 2',
        'T1: Squat / 5x5 / 100kg / progress: none',
      ].join('\n'),
    )

    expect(variationCounts(program)).toEqual({ 'T1:Squat': 3, 'T3:Lat Pulldown': 1 })
  })
})
