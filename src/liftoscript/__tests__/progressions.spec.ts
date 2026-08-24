import type { ExerciseState, SetLog } from '@/types'

import { evaluateSession } from '../evaluator'
import { desugarProgram, desugarProgression } from '../progressions'
import { serializeScript } from '../serialize'
import type {
  DpProgression,
  EvalContext,
  Loc,
  LpProgression,
  Program,
  Progression,
  SessionLog,
  SetGroup,
  SumProgression,
  WeightExpr,
} from '../types'

const LOC: Loc = { line: 1, col: 1 }

const KG_PLATES = [
  { weight: 25, count: 2 },
  { weight: 20, count: 2 },
  { weight: 15, count: 2 },
  { weight: 10, count: 2 },
  { weight: 5, count: 2 },
  { weight: 2.5, count: 2 },
  { weight: 1.25, count: 2 },
]

const CTX: EvalContext = { units: 'kg', plates: KG_PLATES, barbellWeight: 20, week: 1, day: 1 }

// --- builders ---------------------------------------------------------------

function kg(value: number): WeightExpr {
  return { kind: 'absolute', value, unit: 'kg', loc: LOC }
}

function lp(
  increment: WeightExpr,
  successesRequired = 1,
  successCounter = 0,
  deload: WeightExpr = kg(0),
  failuresRequired = 0,
  failureCounter = 0,
): LpProgression {
  return {
    kind: 'lp',
    args: { increment, successesRequired, successCounter, deload, failuresRequired, failureCounter },
    loc: LOC,
  }
}

function dp(increment: WeightExpr, minReps: number, maxReps: number): DpProgression {
  return { kind: 'dp', args: { increment, minReps, maxReps }, loc: LOC }
}

function sum(target: number, increment: WeightExpr): SumProgression {
  return { kind: 'sum', args: { target, increment }, loc: LOC }
}

function group(count: number, reps: number, isAmrap = false): SetGroup {
  return { count, reps, isAmrap, weight: kg(100), loc: LOC }
}

/** A one-exercise program, so a session can be driven without the parser. */
function programWith(progression: Progression, groups: SetGroup[]): Program {
  return {
    weeks: [
      {
        name: 'Week 1',
        loc: LOC,
        days: [
          {
            name: 'Day 1',
            loc: LOC,
            exercises: [{ name: 'Squat', setVariations: [groups], sections: { progress: progression }, loc: LOC }],
          },
        ],
      },
    ],
  }
}

function startingState(weightValue = 100): ExerciseState {
  return { weights: [{ value: weightValue, unit: 'kg' }], setVariationIndex: 1, state: {} }
}

function sessionLog(prescribedReps: number, completed: (number | null)[], weightValue = 100): SessionLog {
  return completed.map((completedReps): SetLog => ({
    prescribedReps,
    isAmrap: false,
    completedReps,
    weight: { value: weightValue, unit: 'kg' },
  }))
}

/** Feeds one session after another, carrying `nextState` forward. */
function drive(program: Program, state: ExerciseState, logs: SessionLog[]): ExerciseState {
  return logs.reduce((current, log) => evaluateSession(program, 'Squat', current, log, CTX).nextState, state)
}

function workingWeight(state: ExerciseState): number {
  return state.weights[0].value
}

// --- the generated scripts --------------------------------------------------

describe('desugared scripts', () => {
  it('rewrites lp into a consecutive-success counter with a deload arm', () => {
    const desugared = desugarProgression(lp(kg(5), 1, 0, kg(15), 1, 0))
    expect(desugared.kind).toBe('custom')
    if (desugared.kind !== 'custom') return

    expect(desugared.stateInit.map((init) => init.name)).toEqual(['successes', 'failures'])
    expect(serializeScript(desugared.script)).toBe(
      [
        'if (zeroOrGte(completedReps, reps)) {',
        '  state.failures = 0',
        '  state.successes += 1',
        '  if (state.successes >= 1) {',
        '    state.successes = 0',
        '    weights += 5kg',
        '  }',
        '} else {',
        '  state.successes = 0',
        '  state.failures += 1',
        '  if (state.failures >= 1) {',
        '    state.failures = 0',
        '    weights -= 15kg',
        '  }',
        '}',
      ].join('\n'),
    )
  })

  it('drops the deload arm when lp asks for zero failures', () => {
    const desugared = desugarProgression(lp(kg(5)))
    if (desugared.kind !== 'custom') throw new Error('expected a custom progression')

    expect(desugared.stateInit.map((init) => init.name)).toEqual(['successes'])
    expect(serializeScript(desugared.script)).toBe(
      [
        'if (zeroOrGte(completedReps, reps)) {',
        '  state.successes += 1',
        '  if (state.successes >= 1) {',
        '    state.successes = 0',
        '    weights += 5kg',
        '  }',
        '} else {',
        '  state.successes = 0',
        '}',
      ].join('\n'),
    )
  })

  it('rewrites dp into reps-then-weight', () => {
    const desugared = desugarProgression(dp(kg(2.5), 6, 10))
    if (desugared.kind !== 'custom') throw new Error('expected a custom progression')

    expect(serializeScript(desugared.script)).toBe(
      [
        'if (zeroOrGte(completedReps, reps)) {',
        '  if (reps[1] >= 10) {',
        '    reps = 6',
        '    weights += 2.5kg',
        '  } else {',
        '    reps += 1',
        '  }',
        '}',
      ].join('\n'),
    )
  })

  it('rewrites sum into a total-reps threshold', () => {
    const desugared = desugarProgression(sum(25, kg(2.5)))
    if (desugared.kind !== 'custom') throw new Error('expected a custom progression')

    expect(serializeScript(desugared.script)).toBe(
      ['if (sum(completedReps) >= 25) {', '  weights += 2.5kg', '}'].join('\n'),
    )
  })

  it('leaves none and custom alone', () => {
    const none = { kind: 'none', loc: LOC } as const
    expect(desugarProgression(none)).toBe(none)

    const custom = desugarProgression(lp(kg(5)))
    expect(desugarProgression(custom)).toBe(custom)
  })

  it('desugars every exercise of a program', () => {
    const program = programWith(lp(kg(5)), [group(3, 5)])
    const desugared = desugarProgram(program)

    expect(desugared.weeks[0].days[0].exercises[0].sections.progress?.kind).toBe('custom')
    // the input is untouched — the editor still shows the user their own text
    expect(program.weeks[0].days[0].exercises[0].sections.progress?.kind).toBe('lp')
  })
})

// --- behaviour through the evaluator ---------------------------------------

describe('lp through the evaluator', () => {
  const program = programWith(lp(kg(5), 1, 0, kg(15), 1, 0), [group(3, 5)])

  it('adds the increment after a successful session', () => {
    const next = drive(program, startingState(), [sessionLog(5, [5, 5, 5])])
    expect(workingWeight(next)).toBe(105)
  })

  it('deloads after a missed session', () => {
    const next = drive(program, startingState(), [sessionLog(5, [5, 5, 4])])
    expect(workingWeight(next)).toBe(85)
  })

  it('keeps adding over consecutive successes', () => {
    const next = drive(program, startingState(), [
      sessionLog(5, [5, 5, 5]),
      sessionLog(5, [5, 5, 5], 105),
      sessionLog(5, [5, 5, 5], 110),
    ])
    expect(workingWeight(next)).toBe(115)
  })

  it('holds the weight until the required number of successes is reached', () => {
    const slow = programWith(lp(kg(2.5), 2, 0, kg(5), 2, 0), [group(3, 5)])

    const afterOne = drive(slow, startingState(), [sessionLog(5, [5, 5, 5])])
    expect(workingWeight(afterOne)).toBe(100)
    expect(afterOne.state.successes).toBe(1)

    const afterTwo = drive(slow, afterOne, [sessionLog(5, [5, 5, 5])])
    expect(workingWeight(afterTwo)).toBe(102.5)
    expect(afterTwo.state.successes).toBe(0)
  })

  it('breaks the streak on a miss, and only deloads after enough of them', () => {
    const slow = programWith(lp(kg(2.5), 2, 0, kg(5), 2, 0), [group(3, 5)])

    const broken = drive(slow, startingState(), [
      sessionLog(5, [5, 5, 5]),
      sessionLog(5, [5, 5, 3]),
      sessionLog(5, [5, 5, 5]),
    ])
    expect(workingWeight(broken)).toBe(100)
    expect(broken.state.successes).toBe(1)

    const deloaded = drive(slow, startingState(), [sessionLog(5, [5, 5, 3]), sessionLog(5, [5, 5, 3])])
    expect(workingWeight(deloaded)).toBe(95)
  })

  it('never deloads when lp was given no failure threshold', () => {
    const plain = programWith(lp(kg(5)), [group(3, 5)])
    const next = drive(plain, startingState(), [sessionLog(5, [5, 5, 2])])
    expect(workingWeight(next)).toBe(100)
  })
})

describe('dp through the evaluator', () => {
  it('holds the weight while there are reps left to add', () => {
    const program = programWith(dp(kg(2.5), 6, 10), [group(3, 8)])
    const next = drive(program, startingState(), [sessionLog(8, [8, 8, 8])])
    expect(workingWeight(next)).toBe(100)
  })

  it('adds the increment once the top of the range is hit', () => {
    const program = programWith(dp(kg(2.5), 6, 10), [group(3, 10)])
    const next = drive(program, startingState(), [sessionLog(10, [10, 10, 10])])
    expect(workingWeight(next)).toBe(102.5)
  })

  it('changes nothing after a missed session', () => {
    const program = programWith(dp(kg(2.5), 6, 10), [group(3, 10)])
    const next = drive(program, startingState(), [sessionLog(10, [10, 10, 7])])
    expect(workingWeight(next)).toBe(100)
  })
})

describe('sum through the evaluator', () => {
  const program = programWith(sum(25, kg(2.5)), [group(3, 15, true)])

  it('adds the increment when the total reaches the target', () => {
    const next = drive(program, startingState(40), [sessionLog(15, [10, 8, 7], 40)])
    expect(workingWeight(next)).toBe(42.5)
  })

  it('holds one rep short of the target', () => {
    const next = drive(program, startingState(40), [sessionLog(15, [10, 8, 6], 40)])
    expect(workingWeight(next)).toBe(40)
  })
})
