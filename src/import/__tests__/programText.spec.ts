import {
  EXPECTED_UNSUPPORTED,
  gzclpBuiltin,
  gzclpLiftosaurReal,
  gzclpStock,
  misc,
  unsupported,
} from '@/liftoscript/__tests__/fixtures'
import { unsupportedMessage } from '@/liftoscript/diagnostics'
import { buildGzclpProgram } from '@/training/gzclp'

import { adoptProgramText, detectWeights, gzclpFallback } from '../programText'

/**
 * The working weights both GZCLP fixtures declare, in kg. The built-in and the
 * stock Liftosaur copy are the same program written two ways, so adoption must
 * read exactly the same numbers out of both.
 */
const GZCLP_WEIGHTS: Record<string, number> = {
  'T1:Squat': 100,
  'T2:Bench Press': 60,
  'T3:Lat Pulldown': 40,
  'T1:Overhead Press': 45,
  'T2:Deadlift': 90,
  'T3:Bent Over Row': 40,
  'T1:Bench Press': 80,
  'T2:Squat': 75,
  'T1:Deadlift': 120,
  'T2:Overhead Press': 35,
}

describe('adoptProgramText', () => {
  it('adopts the built-in GZCLP with every declared weight', () => {
    const result = adoptProgramText(gzclpBuiltin)

    expect(result.diagnostics).toEqual([])
    expect(result.adopted).toBe(true)
    expect(result.programText).toBe(gzclpBuiltin)
    expect(Object.keys(result.programState).sort()).toEqual(Object.keys(GZCLP_WEIGHTS).sort())

    for (const [key, value] of Object.entries(GZCLP_WEIGHTS)) {
      expect(result.programState[key].weights, key).toEqual([{ value, unit: 'kg' }])
      expect(result.programState[key].setVariationIndex, key).toBe(1)
      expect(result.programState[key].askWeight, key).toBeUndefined()
    }
  })

  it('reads the same weights out of the stock Liftosaur GZCLP', () => {
    const stock = adoptProgramText(gzclpStock)

    expect(stock.diagnostics).toEqual([])
    expect(stock.adopted).toBe(true)
    // `T2: Bench Press, Barbell` keys as `T2:Bench Press` — equipment is not part
    // of the key, so the two spellings of the same program agree.
    expect(stock.detected).toEqual(adoptProgramText(gzclpBuiltin).detected)
  })

  it('seeds the state vars of a shorthand progression', () => {
    const stock = adoptProgramText(gzclpStock)

    // `progress: lp(5kg, 1, 0, 15kg, 1, 0)` desugars into a custom progression
    // whose counters live in `ExerciseState.state`.
    expect(Object.keys(stock.programState['T1:Squat'].state).length).toBeGreaterThan(0)
  })

  it('turns a `?+` weight into askWeight', () => {
    const result = adoptProgramText(misc)

    expect(result.diagnostics).toEqual([])
    expect(result.detected['T3:Lat Pulldown']).toBeUndefined()
    expect(result.programState['T3:Lat Pulldown']).toEqual({
      weights: [],
      setVariationIndex: 1,
      state: {},
      askWeight: true,
    })
    expect(result.askWeightKeys).toContain('T3:Lat Pulldown')
  })

  it('treats a percentage-only line as a lift with no known weight', () => {
    const result = adoptProgramText(misc)

    // `1x5 60%, 1x3 70%, 3x5 80%` is relative to a working weight the text never
    // states, so there is nothing to adopt.
    expect(result.detected['T2:Bench Press']).toBeUndefined()
    expect(result.programState['T2:Bench Press'].askWeight).toBe(true)
    // A line with no weight segment at all reads the same way.
    expect(result.programState['Plank'].askWeight).toBe(true)
  })

  it('adopts an all-unknown program, so "skip setup" lands on ask-weight prompts', () => {
    const blank = buildGzclpProgram({})
    const result = adoptProgramText(blank)

    expect(result.adopted).toBe(true)
    expect(result.detected).toEqual({})
    expect(result.askWeightKeys.sort()).toEqual(Object.keys(GZCLP_WEIGHTS).sort())
    for (const state of Object.values(result.programState)) {
      expect(state.askWeight).toBe(true)
      expect(state.weights).toEqual([])
    }
  })
})

describe('unsupported constructs', () => {
  it('surfaces every parser diagnostic with the exact message and line', () => {
    const result = adoptProgramText(unsupported)

    // The import layer must not filter, re-sort or re-word what the parser said:
    // `UNSUPPORTED_CONSTRUCTS` owns the wording and `DiagnosticsList` renders it.
    for (const expected of EXPECTED_UNSUPPORTED) {
      const match = result.diagnostics.find(
        (diagnostic) => diagnostic.line === expected.line && diagnostic.message === unsupportedMessage(expected.id),
      )
      expect(match, `${expected.id} on line ${expected.line}`).toBeDefined()
      expect(match!.col).toBeGreaterThan(0)
    }
  })

  it('refuses to adopt, rather than running the lines that happened to parse', () => {
    const result = adoptProgramText(unsupported)

    expect(result.adopted).toBe(false)
    expect(result.programState).toEqual({})
  })
})

describe('the built-in GZCLP fallback', () => {
  it('carries the weights detected from a program that failed to adopt', () => {
    // A paste that is GZCLP down to the last line except for one construct the
    // engine refuses: everything else still yields its weight.
    const broken = `${gzclpStock}\nT3: Face Pull / ...Lat Pulldown\n`
    const result = adoptProgramText(broken)

    expect(result.adopted).toBe(false)
    expect(result.programState).toEqual({})
    expect(result.detected['T1:Squat']).toEqual({ weight: { value: 100, unit: 'kg' } })

    const fallback = gzclpFallback(result.detected)

    for (const [key, value] of Object.entries(GZCLP_WEIGHTS)) {
      expect(fallback.programState[key].weights, key).toEqual([{ value, unit: 'kg' }])
      expect(fallback.programState[key].askWeight, key).toBeUndefined()
    }
    // The fallback text is real program text, not string surgery.
    expect(adoptProgramText(fallback.programText).diagnostics).toEqual([])
  })

  it('leaves the built-in lifts an empty seed does not mention as ask-weight', () => {
    const fallback = gzclpFallback({})

    for (const key of Object.keys(GZCLP_WEIGHTS)) {
      expect(fallback.programState[key].askWeight, key).toBe(true)
      expect(fallback.programState[key].weights, key).toEqual([])
    }
  })
})

describe('detectWeights', () => {
  it('keeps the first line when the same lift appears on two days', () => {
    // The two `T3: Lat Pulldown` lines declare DIFFERENT weights, so a
    // last-line-wins reading would return 45 — the built-in's own duplicate
    // carries the same weight on both days and cannot tell the two apart.
    const twoDays = `# Week 1
## A1
T3: Lat Pulldown / 3x15 / 40kg / progress: lp(2.5kg)
## A2
T3: Lat Pulldown / 3x15 / 45kg / progress: lp(2.5kg)
`
    const { program } = adoptProgramText(twoDays)
    const seed = detectWeights(program)

    expect(Object.keys(seed)).toEqual(['T3:Lat Pulldown'])
    expect(seed['T3:Lat Pulldown']).toEqual({ weight: { value: 40, unit: 'kg' } })
  })

  it('collects one entry per lift across the whole built-in program', () => {
    const { program } = adoptProgramText(gzclpBuiltin)

    expect(Object.keys(detectWeights(program))).toHaveLength(Object.keys(GZCLP_WEIGHTS).length)
  })
})

describe('a real Liftosaur GZCLP', () => {
  /**
   * The only real-world program this repo has, pasted verbatim. It exercises
   * every construct the engine grew for it: `ns`, `descriptionIndex`, sets and
   * progression reuse, and a `60% 90s` weight-plus-rest segment.
   */
  const REAL_WEIGHTS: Record<string, number> = {
    'T1:Squat': 77.5,
    'T2:Bench Press': 40,
    'T1:Overhead Press': 32.5,
    'T2:Deadlift': 62.5,
    'T1:Bench Press': 50,
    'T2:Squat': 57.5,
    'T1:Deadlift': 70,
    'T2:Overhead Press': 22.5,
  }

  /** The athlete's own paste has a bare `DAY 3` where a comment was meant. */
  const corrected = gzclpLiftosaurReal.replace(/^DAY 3$/m, '// DAY 3')

  it("reports the athlete's stray heading, and nothing else", () => {
    const { diagnostics } = adoptProgramText(gzclpLiftosaurReal)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].message).toContain('has no sets')
    // The message has to name the fix: "expected at least one set" would send
    // someone hunting for a broken exercise instead of an uncommented heading.
    expect(diagnostics[0].message).toContain('comment it out')
  })

  it('adopts once that heading is commented out', () => {
    const adopted = adoptProgramText(corrected)

    expect(adopted.diagnostics).toEqual([])
    expect(adopted.adopted).toBe(true)
    expect(Object.keys(adopted.programState)).toHaveLength(10)
  })

  it('keeps every declared working weight', () => {
    const { programState } = adoptProgramText(corrected)

    for (const [key, value] of Object.entries(REAL_WEIGHTS)) {
      expect(programState[key].weights, key).toEqual([{ value, unit: 'kg' }])
    }
    // Its T3 lines are written `60% 90s` — a percentage of a weight the text
    // never states, so they stay unknown rather than inventing a number.
    expect(programState['T3:Lat Pulldown'].weights).toEqual([])
    expect(programState['T3:Bent Over Row'].weights).toEqual([])
  })

  it("gives each reused progression its own state, not the source lift's", () => {
    // Six lines run Squat's script via `{ ...t1: Squat }`. If reuse copied the
    // state too, every lift would jump by Squat's 5 kg and GZCLP would be wrong
    // for the presses.
    const { programState } = adoptProgramText(corrected)

    expect(programState['T1:Squat'].state.increase).toEqual({ value: 5, unit: 'kg' })
    expect(programState['T1:Overhead Press'].state.increase).toEqual({ value: 2.5, unit: 'kg' })
    expect(programState['T1:Bench Press'].state.increase).toEqual({ value: 2.5, unit: 'kg' })
  })

  it('still finds every weight even when the program will not parse', () => {
    // The fallback's promise, tested against the uncorrected paste.
    expect(
      Object.fromEntries(
        Object.entries(adoptProgramText(gzclpLiftosaurReal).detected).map(([key, entry]) => [key, entry.weight.value]),
      ),
    ).toEqual(REAL_WEIGHTS)
  })

  it('carries those weights onto the built-in GZCLP', () => {
    const { programState } = gzclpFallback(adoptProgramText(gzclpLiftosaurReal).detected)

    for (const [key, value] of Object.entries(REAL_WEIGHTS)) {
      expect(programState[key].weights[0], key).toEqual({ value, unit: 'kg' })
      expect(programState[key].askWeight, key).toBeUndefined()
    }
    expect(programState['T3:Lat Pulldown'].askWeight).toBe(true)
  })
})
