/**
 * `...Name` reuse. The feature exists because Liftosaur's own GZCLP is written
 * with it — six of its ten lines borrow another line's progression — so a
 * program that cannot resolve reuse cannot import the most common program there
 * is.
 */

import { evaluateSession, prescribe } from '../evaluator'
import { parseProgram } from '../parser'
import { desugarProgram } from '../progressions'
import { serializeProgram } from '../serialize'
import type { EvalContext } from '../types'
import { weight } from '../weight'

const ctx: EvalContext = {
  units: 'kg',
  plates: [
    { weight: 25, count: 2 },
    { weight: 20, count: 2 },
    { weight: 10, count: 2 },
    { weight: 5, count: 2 },
    { weight: 2.5, count: 2 },
    { weight: 1.25, count: 2 },
  ],
  barbellWeight: 20,
  week: 1,
  day: 1,
}

function parse(source: string) {
  const result = parseProgram(source)
  return { ...result, program: desugarProgram(result.program) }
}

function lineNamed(program: ReturnType<typeof parse>['program'], name: string) {
  return program.weeks[0].days.flatMap((day) => day.exercises).find((exercise) => exercise.name === name)!
}

describe('reusing sets', () => {
  const source = `# Week 1
## Day 1
t3: Lat Pulldown / 2x15, 1x15+ / 60% 90s / progress: none
t3: Bent Over Row / ...t3: Lat Pulldown[1]
`

  it('copies the set variations of the line it points at', () => {
    const { program, diagnostics } = parse(source)
    expect(diagnostics).toEqual([])

    const source_ = lineNamed(program, 'Lat Pulldown')
    const target = lineNamed(program, 'Bent Over Row')

    expect(target.setVariations).toEqual(source_.setVariations)
    expect(target.setVariations[0].map((group) => `${group.count}x${group.reps}${group.isAmrap ? '+' : ''}`)).toEqual([
      '2x15',
      '1x15+',
    ])
  })

  it('copies deeply, so editing one line cannot reach into the other', () => {
    const { program } = parse(source)

    lineNamed(program, 'Bent Over Row').setVariations[0][0].count = 99

    expect(lineNamed(program, 'Lat Pulldown').setVariations[0][0].count).toBe(2)
  })

  it('carries the rest timer written beside the weight', () => {
    // `60% 90s` is a weight for every set plus the rest between them — the shape
    // Liftosaur's GZCLP writes its T3 line in.
    const { program } = parse(source)

    expect(lineNamed(program, 'Lat Pulldown').setVariations[0][0].restTimerSec).toBe(90)
    expect(lineNamed(program, 'Bent Over Row').setVariations[0][0].restTimerSec).toBe(90)
  })

  it('matches the tier label whatever case it was written in', () => {
    const { diagnostics } = parse(`# Week 1
## Day 1
T3: Lat Pulldown / 3x15 / 40kg / progress: none
t3: Bent Over Row / ...t3: Lat Pulldown
`)

    expect(diagnostics).toEqual([])
  })

  it('reports a reference to a line that does not exist', () => {
    const { diagnostics } = parse(`# Week 1
## Day 1
t3: Bent Over Row / ...t3: Nothing Here
`)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].message).toContain('No exercise named `T3:Nothing Here`')
  })

  it('refuses a chain rather than resolving it in whatever order it read the lines', () => {
    const { diagnostics } = parse(`# Week 1
## Day 1
t3: A / 3x15 / 40kg / progress: none
t3: B / ...t3: A
t3: C / ...t3: B
`)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].message).toContain('may not chain')
  })
})

describe('reusing a progression', () => {
  /** GZCLP in miniature: one script, two lifts, two different increments. */
  const source = `# Week 1
## Day 1
t1: Squat / 5x3+ / 100kg / progress: custom(increase: 5kg) {~
  if (completedReps >= reps) {
    weights = weights[ns] + state.increase
  }
~}
t1: Overhead Press / 5x3+ / 45kg / progress: custom(increase: 2.5kg) { ...t1: Squat }
`

  it("runs the borrowed script with the borrowing line's own state", () => {
    const { program, diagnostics } = parse(source)
    expect(diagnostics).toEqual([])

    const press = lineNamed(program, 'Overhead Press')
    const state = {
      weights: [weight(45, 'kg')],
      setVariationIndex: 1,
      state: { increase: weight(2.5, 'kg') },
    }

    const log = prescribe(program, 'T1:Overhead Press', state, ctx).sets.map((set) => ({
      prescribedReps: set.reps,
      isAmrap: set.isAmrap,
      completedReps: set.reps,
      weight: set.weight,
    }))

    const { nextState } = evaluateSession(program, 'T1:Overhead Press', state, log, ctx)

    // 45 + 2.5, not 45 + 5: the script came from Squat, the increment did not.
    expect(nextState.weights[0]).toEqual({ value: 47.5, unit: 'kg' })
    expect(press.sections.progress?.kind).toBe('custom')
  })

  it('leaves the source lift progressing by its own increment', () => {
    const { program } = parse(source)
    const state = { weights: [weight(100, 'kg')], setVariationIndex: 1, state: { increase: weight(5, 'kg') } }

    const log = prescribe(program, 'T1:Squat', state, ctx).sets.map((set) => ({
      prescribedReps: set.reps,
      isAmrap: set.isAmrap,
      completedReps: set.reps,
      weight: set.weight,
    }))

    expect(evaluateSession(program, 'T1:Squat', state, log, ctx).nextState.weights[0]).toEqual({
      value: 105,
      unit: 'kg',
    })
  })

  it('reports a progression borrowed from a line that has none', () => {
    const { diagnostics } = parse(`# Week 1
## Day 1
t1: Squat / 5x3+ / 100kg
t1: Overhead Press / 5x3+ / 45kg / progress: custom(increase: 2.5kg) { ...t1: Squat }
`)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].message).toContain('no `custom(...)` progression')
  })
})

describe('serializing a resolved program', () => {
  it('writes reuse out in full and re-reads to the same thing', () => {
    // The AST is resolved by the time the serializer sees it, so reuse comes
    // back expanded rather than as `...Name`. That is the honest rendering: the
    // program editor shows what the line actually does.
    const { program } = parse(`# Week 1
## Day 1
t3: Lat Pulldown / 2x15, 1x15+ / 60% 90s / progress: none
t3: Bent Over Row / ...t3: Lat Pulldown[1]
`)

    const text = serializeProgram(program)
    const again = parseProgram(text)

    expect(again.diagnostics).toEqual([])
    expect(text).toContain('t3: Bent Over Row / 2x15 60% 90s, 1x15+ 60% 90s')
    expect(serializeProgram(again.program)).toBe(text)
  })
})
