import { unsupportedMessage } from '../diagnostics'
import { parseProgram, parseProgramOrThrow, parseScript } from '../parser'
import type { CustomProgression, Day, DpProgression, ExerciseLine, LpProgression, SumProgression } from '../types'
import { cardio, EXPECTED_UNSUPPORTED, gzclpBuiltin, gzclpStock, misc, unsupported } from './fixtures'

function days(source: string): Day[] {
  const { program, diagnostics } = parseProgram(source)
  expect(diagnostics).toEqual([])
  return program.weeks[0].days
}

function exercise(source: string, day: number, index: number): ExerciseLine {
  return days(source)[day].exercises[index]
}

describe('built-in GZCLP', () => {
  it('parses without a single diagnostic', () => {
    expect(parseProgram(gzclpBuiltin).diagnostics).toEqual([])
  })

  it('reads one week of four rotation days', () => {
    const { program } = parseProgram(gzclpBuiltin)
    expect(program.weeks).toHaveLength(1)
    expect(program.weeks[0].name).toBe('Week 1')
    expect(program.weeks[0].days.map((day) => day.name)).toEqual(['A1', 'B1', 'A2', 'B2'])
    expect(program.weeks[0].days.every((day) => day.exercises.length === 3)).toBe(true)
  })

  it('keeps the tier label and the exercise name apart', () => {
    const t1 = exercise(gzclpBuiltin, 0, 0)
    expect(t1.label).toBe('T1')
    expect(t1.name).toBe('Squat')
    expect(t1.equipment).toBeUndefined()
  })

  it('reads the three T1 stages as set variations', () => {
    const t1 = exercise(gzclpBuiltin, 0, 0)
    expect(t1.setVariations).toHaveLength(3)
    expect(t1.setVariations.map((variation) => variation[0].count)).toEqual([5, 6, 10])
    expect(t1.setVariations.map((variation) => variation[0].reps)).toEqual([3, 2, 1])
    expect(t1.setVariations.every((variation) => variation[0].isAmrap)).toBe(true)
  })

  it('spreads the standalone weight segment over every variation', () => {
    const t1 = exercise(gzclpBuiltin, 0, 0)
    for (const variation of t1.setVariations) {
      expect(variation[0].weight).toMatchObject({ kind: 'absolute', value: 100, unit: 'kg' })
    }
  })

  it('reads the warmup sets, absolute and relative', () => {
    const warmup = exercise(gzclpBuiltin, 0, 0).sections.warmup
    expect(warmup).toHaveLength(3)
    expect(warmup).toMatchObject([
      { count: 1, reps: 5, weight: { kind: 'absolute', value: 20, unit: 'kg' } },
      { count: 1, reps: 3, weight: { kind: 'percent', value: 55 } },
      { count: 1, reps: 2, weight: { kind: 'percent', value: 75 } },
    ])
  })

  it('honours `warmup: none`', () => {
    expect(exercise(gzclpBuiltin, 0, 2).sections.warmup).toBe('none')
  })

  it('seeds the custom progression state from its arguments', () => {
    const progress = exercise(gzclpBuiltin, 0, 0).sections.progress as CustomProgression
    expect(progress.kind).toBe('custom')
    expect(progress.stateInit.map((init) => init.name)).toEqual(['inc', 'resetFactor'])
    expect(progress.stateInit[0].value).toMatchObject({ type: 'weight', value: { value: 5, unit: 'kg' } })
    expect(progress.stateInit[1].value).toMatchObject({ type: 'number', value: 0.85 })
  })

  it('parses the progression script into statements', () => {
    const progress = exercise(gzclpBuiltin, 0, 0).sections.progress as CustomProgression
    expect(progress.script).toHaveLength(1)

    const statement = progress.script[0]
    expect(statement.type).toBe('if')
    if (statement.type !== 'if') return

    expect(statement.branches).toHaveLength(2)
    expect(statement.branches[0].condition).toMatchObject({
      type: 'binary',
      op: '>=',
      left: { type: 'var', name: 'completedReps' },
      right: { type: 'var', name: 'reps' },
    })
    expect(statement.branches[0].body[0]).toMatchObject({
      type: 'assign',
      op: '+=',
      target: { type: 'var', scope: 'bare', name: 'weights' },
      value: { type: 'var', scope: 'state', name: 'inc' },
    })
    expect(statement.branches[1].condition).toMatchObject({
      type: 'binary',
      op: '>=',
      left: { type: 'var', name: 'setVariationIndex' },
      right: { type: 'number', value: 3 },
    })
    expect(statement.branches[1].body[1]).toMatchObject({
      type: 'assign',
      op: '=',
      target: { name: 'weights' },
      value: { type: 'call', name: 'roundWeight' },
    })
    expect(statement.elseBody).toMatchObject([{ type: 'assign', op: '+=', target: { name: 'setVariationIndex' } }])
  })

  it('reads an indexed access as a 1-based script index', () => {
    const progress = exercise(gzclpBuiltin, 0, 2).sections.progress as CustomProgression
    const statement = progress.script[0]
    expect(statement).toMatchObject({
      type: 'if',
      branches: [
        {
          condition: {
            type: 'binary',
            op: '>=',
            left: { type: 'index', target: { name: 'completedReps' }, index: { type: 'number', value: 3 } },
          },
        },
      ],
    })
  })

  it('points every node at its position in the source', () => {
    const t1 = exercise(gzclpBuiltin, 0, 0)
    expect(t1.loc).toEqual({ line: 11, col: 1 })
    // The script keeps the position it has in the file, not in the snippet.
    const progress = t1.sections.progress as CustomProgression
    expect(progress.script[0].loc.line).toBe(12)
  })
})

describe('stock GZCLP shorthand progressions', () => {
  it('parses without a single diagnostic', () => {
    expect(parseProgram(gzclpStock).diagnostics).toEqual([])
  })

  it('reads the full lp argument list', () => {
    const progress = exercise(gzclpStock, 0, 0).sections.progress as LpProgression
    expect(progress.kind).toBe('lp')
    expect(progress.args).toMatchObject({
      increment: { kind: 'absolute', value: 5, unit: 'kg' },
      successesRequired: 1,
      successCounter: 0,
      deload: { kind: 'absolute', value: 15, unit: 'kg' },
      failuresRequired: 1,
      failureCounter: 0,
    })
  })

  it('fills in lp defaults when only an increment is written', () => {
    const progress = exercise(gzclpStock, 2, 0).sections.progress as LpProgression
    expect(progress.args).toMatchObject({
      increment: { kind: 'absolute', value: 2.5, unit: 'kg' },
      successesRequired: 1,
      successCounter: 0,
      deload: { kind: 'absolute', value: 0, unit: 'kg' },
      failuresRequired: 0,
      failureCounter: 0,
    })
  })

  it('reads dp and sum', () => {
    const dp = exercise(gzclpStock, 0, 1).sections.progress as DpProgression
    expect(dp).toMatchObject({ kind: 'dp', args: { increment: { value: 2.5, unit: 'kg' }, minReps: 6, maxReps: 10 } })

    const sum = exercise(gzclpStock, 0, 2).sections.progress as SumProgression
    expect(sum).toMatchObject({ kind: 'sum', args: { target: 25, increment: { value: 2.5, unit: 'kg' } } })
  })

  it('reads `progress: none`', () => {
    expect(exercise(gzclpStock, 2, 2).sections.progress).toMatchObject({ kind: 'none' })
  })

  it('attaches a `//` comment as the description of the next exercise', () => {
    expect(exercise(gzclpStock, 0, 0).description).toBe('Push the knees out on the way up.')
    expect(exercise(gzclpStock, 0, 1).description).toBeUndefined()
  })

  it('splits the equipment off the exercise name', () => {
    const bench = exercise(gzclpStock, 0, 1)
    expect(bench.name).toBe('Bench Press')
    expect(bench.equipment).toBe('Barbell')
  })
})

describe('cardio extension', () => {
  it('parses without a single diagnostic', () => {
    expect(parseProgram(cardio).diagnostics).toEqual([])
  })

  it('reads a continuous effort as one set with a duration and a zone', () => {
    const run = exercise(cardio, 0, 0)
    expect(run.name).toBe('Run')
    expect(run.setVariations[0][0]).toMatchObject({ count: 1, duration: 2400, zone: 2 })
  })

  it('reads interval sets and their rest', () => {
    const intervals = exercise(cardio, 1, 0)
    expect(intervals.setVariations[0][0]).toMatchObject({ count: 6, duration: 180, zone: 4 })
    expect(intervals.sections.restSec).toBe(120)
  })

  it('reads a distance in metres and in kilometres', () => {
    expect(exercise(cardio, 1, 2).setVariations[0][0]).toMatchObject({
      count: 8,
      distance: { value: 100, unit: 'm' },
      zone: 3,
    })
    expect(exercise(cardio, 2, 0).setVariations[0][0]).toMatchObject({ distance: { value: 5, unit: 'km' } })
  })

  it('accepts a plain RPE instead of a zone', () => {
    const group = exercise(cardio, 2, 2).setVariations[0][0]
    expect(group.rpe).toBe(6)
    expect(group.zone).toBeUndefined()
  })

  it('keeps the equipment of a cardio line', () => {
    expect(exercise(cardio, 0, 2)).toMatchObject({ name: 'Walk', equipment: 'Treadmill' })
  })
})

describe('notation coverage', () => {
  it('parses without a single diagnostic', () => {
    expect(parseProgram(misc).diagnostics).toEqual([])
  })

  it('joins consecutive `//` lines and drops `///` ones', () => {
    expect(exercise(misc, 0, 0).description).toBe('Keep the bar over midfoot.\nReset between reps.')
  })

  it('reads a rep range', () => {
    expect(exercise(misc, 0, 0).setVariations[0][0]).toMatchObject({ count: 3, reps: 8, maxReps: 12 })
  })

  it('reads percentages, a logged RPE, a timer and a label on one set group', () => {
    const groups = exercise(misc, 0, 1).setVariations[0]
    expect(groups).toHaveLength(3)
    expect(groups[0]).toMatchObject({ count: 1, reps: 5, weight: { kind: 'percent', value: 60 } })
    expect(groups[2]).toMatchObject({
      count: 3,
      reps: 5,
      weight: { kind: 'percent', value: 80 },
      rpe: 8,
      rpeLog: true,
      setTimerSec: 60,
      restTimerSec: 30,
      label: 'Top set',
    })
  })

  it('reads `?+` as an unknown weight', () => {
    const group = exercise(misc, 0, 2).setVariations[0][0]
    expect(group).toMatchObject({ isAmrap: true, askWeight: true, weight: { kind: 'ask' } })
    expect(exercise(misc, 0, 2).sections.restSec).toBe(90)
  })

  it('continues an exercise line over a trailing backslash', () => {
    const deadlift = exercise(misc, 0, 3)
    expect(deadlift.name).toBe('Deadlift')
    expect(deadlift.setVariations[0][0]).toMatchObject({ count: 5, reps: 5, rpe: 7 })
    expect(deadlift.sections.warmup).toHaveLength(2)
    expect(deadlift.sections.progress).toMatchObject({ kind: 'lp' })
  })

  it('reads id tags and `used: none`', () => {
    expect(exercise(misc, 0, 4).sections.tags).toEqual([3, 7])
    expect(exercise(misc, 0, 5).sections.usedNone).toBe(true)
  })

  it('spreads a standalone timer segment over the sets', () => {
    expect(exercise(misc, 0, 6).setVariations[0][0]).toMatchObject({ setTimerSec: 60, restTimerSec: 30 })
  })

  it('counts consecutive set specs as variations and skips the weight segment', () => {
    const row = exercise(misc, 0, 4)
    expect(row.setVariations).toHaveLength(2)
    expect(row.setVariations.map((variation) => variation[0].reps)).toEqual([10, 8])
    expect(row.setVariations.every((variation) => variation[0].weight?.kind === 'absolute')).toBe(true)
  })
})

describe('unsupported constructs', () => {
  it('reports every construct on its own line, with the exact message', () => {
    const { diagnostics } = parseProgram(unsupported)

    for (const expected of EXPECTED_UNSUPPORTED) {
      const match = diagnostics.find(
        (diagnostic) => diagnostic.line === expected.line && diagnostic.message === unsupportedMessage(expected.id),
      )
      expect(match, `${expected.id} on line ${expected.line}`).toBeDefined()
      expect(match?.col).toBeGreaterThan(0)
      expect(match?.sourceLine).toBe(unsupported.split('\n')[expected.line - 1])
    }
  })

  it('points the column at the construct itself', () => {
    const { diagnostics } = parseProgram(unsupported)
    const superset = diagnostics.find((diagnostic) => diagnostic.line === 9)
    expect(unsupported.split('\n')[8].slice((superset?.col ?? 1) - 1)).toMatch(/^superset:/)
  })

  it('collects them all instead of stopping at the first', () => {
    const { diagnostics } = parseProgram(unsupported)
    expect(diagnostics.length).toBeGreaterThanOrEqual(EXPECTED_UNSUPPORTED.length)

    // Reported in source order, which is what the diagnostics list renders.
    const reportedLines = diagnostics.map((diagnostic) => diagnostic.line)
    const sorted = reportedLines.slice().sort((a, b) => a - b)
    expect(reportedLines).toEqual(sorted)
  })

  it('skips the offending line but keeps the surrounding program', () => {
    const { program } = parseProgram(
      `# Week 1\n## Day 1\nSquat / 5x5 / 100kg / superset: Bench Press\nDeadlift / 3x5 / 120kg`,
    )
    expect(program.weeks[0].days[0].exercises.map((line) => line.name)).toEqual(['Deadlift'])
  })

  it('does not mistake a set timer for an exercise variation', () => {
    expect(parseProgram('Plank / 3x1 60s|30s').diagnostics).toEqual([])
  })

  it('does not mistake `||` inside a script for an exercise variation', () => {
    const source = 'Squat / 5x5 / 100kg / progress: custom() {~ if (week == 1 || week == 2) { weights += 5kg } ~}'
    expect(parseProgram(source).diagnostics).toEqual([])
  })
})

describe('malformed input', () => {
  it('never throws', () => {
    const sources = ['', '   ', '#', '##', '/', 'Squat /', 'Squat / 5x', 'T1:', '{~', 'Squat / 5x5 / progress: custom(']
    for (const source of sources) {
      expect(() => parseProgram(source)).not.toThrow()
    }
  })

  it('reports an unknown section', () => {
    const { diagnostics } = parseProgram('Squat / 5x5 / 100kg / bogus: 3')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].message).toBe('Unknown section `bogus:`.')
  })

  it('reports an unknown progression', () => {
    const { diagnostics } = parseProgram('Squat / 5x5 / 100kg / progress: quadratic(2)')
    expect(diagnostics[0].message).toMatch(/Unknown progression `quadratic`/)
  })

  it('reports an unknown script function and variable', () => {
    const unknownCall = parseProgram('Squat / 5x5 / 100kg / progress: custom() {~ weights = frobnicate(1) ~}')
    expect(unknownCall.diagnostics[0].message).toBe('Unknown function `frobnicate`.')

    const unknownVar = parseProgram('Squat / 5x5 / 100kg / progress: custom() {~ weights = nonsense ~}')
    expect(unknownVar.diagnostics[0].message).toMatch(/Unknown variable `nonsense`/)
  })

  it('refuses to assign to a read-only variable', () => {
    const { diagnostics } = parseProgram('Squat / 5x5 / 100kg / progress: custom() {~ week = 5 ~}')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].message).toBe('`week` is read-only and cannot be assigned.')
  })

  it('keeps parsing after a broken line', () => {
    const { program, diagnostics } = parseProgram('# Week 1\n## Day 1\nSquat / bogus: 3\nDeadlift / 3x5 / 120kg')
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(program.weeks[0].days[0].exercises.map((line) => line.name)).toEqual(['Squat', 'Deadlift'])
  })

  it('puts exercises without a header into an implicit week and day', () => {
    const { program } = parseProgram('Squat / 5x5 / 100kg')
    expect(program.weeks[0].name).toBe('Week 1')
    expect(program.weeks[0].days[0].name).toBe('Day 1')
    expect(program.weeks[0].days[0].exercises).toHaveLength(1)
  })
})

describe('parseScript', () => {
  it('parses statements on their own', () => {
    const { script, diagnostics } = parseScript('state.count += 1\nif (state.count >= 2) { weights += 5kg }')
    expect(diagnostics).toEqual([])
    expect(script).toHaveLength(2)
    expect(script[0]).toMatchObject({ type: 'assign', op: '+=', target: { scope: 'state', name: 'count' } })
    expect(script[1].type).toBe('if')
  })

  it('parses a for-in loop over a per-set array', () => {
    const { script, diagnostics } = parseScript('for (var.i in completedReps) { var.total += completedReps[var.i] }')
    expect(diagnostics).toEqual([])
    expect(script[0]).toMatchObject({
      type: 'forIn',
      variable: { scope: 'var', name: 'i' },
      iterable: { type: 'var', name: 'completedReps' },
    })
  })

  it('parses a ternary and honours operator precedence', () => {
    const { script } = parseScript('weights = completedReps[1] > 3 ? weights[1] + 5kg : weights[1]')
    expect(script[0]).toMatchObject({
      type: 'assign',
      value: { type: 'ternary', ifTrue: { type: 'binary', op: '+' } },
    })

    const { script: precedence } = parseScript('var.x = 1 + 2 * 3')
    expect(precedence[0]).toMatchObject({
      value: { type: 'binary', op: '+', right: { type: 'binary', op: '*' } },
    })
  })

  it('places diagnostics inside the enclosing file', () => {
    const { diagnostics } = parseScript('nonsense = 1', 10, 20)
    expect(diagnostics[0]).toMatchObject({ line: 10, col: 20 })
  })
})

describe('parseProgramOrThrow', () => {
  it('returns the program when it is clean', () => {
    expect(parseProgramOrThrow(gzclpBuiltin).weeks[0].days).toHaveLength(4)
  })

  it('throws the first diagnostic when it is not', () => {
    expect(() => parseProgramOrThrow(unsupported)).toThrow(/update:/)
  })
})
