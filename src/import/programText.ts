/**
 * Adoption of a pasted Liftoscript program: parse it, read the working weights
 * it already declares, and hand back the three `strengthTrack` fields the
 * profile needs (`programText`, `programState`, and the seed the fallback runs
 * on) plus the parser's diagnostics, untouched.
 *
 * Two rules shape this module:
 * - the diagnostics belong to the parser. They are passed through in order and
 *   with their wording intact, because `UNSUPPORTED_CONSTRUCTS` owns that
 *   wording and `DiagnosticsList` renders it;
 * - the weights are read from the AST, never from the text. The parser skips a
 *   line it cannot support but keeps the rest of the program, so a paste that
 *   fails adoption still yields the weights of every line that did parse —
 *   which is exactly what the "keep the detected weights, run the built-in
 *   GZCLP" fallback needs.
 */

import type { Diagnostic } from '@/liftoscript/diagnostics'
import { exerciseKey } from '@/liftoscript/evaluator'
import { parseProgram } from '@/liftoscript/parser'
import type { ExerciseLine, Program } from '@/liftoscript/types'
import { buildGzclpProgram, initialProgramState, type GzclpSeed } from '@/training/gzclp'
import type { ExerciseState } from '@/types'

/** What adopting a pasted program produced. */
export interface AdoptedProgram {
  /** The pasted source, unchanged. Adoption never rewrites program text. */
  programText: string
  /** The parse result, partial when lines were skipped. */
  program: Program
  /** Straight from `parseProgram`: same order, same wording, nothing filtered. */
  diagnostics: Diagnostic[]
  /** False when the program cannot be run as pasted — the caller offers the fallback. */
  adopted: boolean
  /** Empty unless `adopted`; a half-adopted state would silently mis-prescribe. */
  programState: Record<string, ExerciseState>
  /**
   * The working weight the program declares per `exerciseKey()`, collected even
   * from a program that failed adoption. This is the fallback's seed.
   */
  detected: GzclpSeed
  /** Keys whose weight the program does not know (`?+`), in program order. */
  askWeightKeys: string[]
}

/** The built-in GZCLP carrying weights detected elsewhere. */
export interface GzclpFallback {
  programText: string
  programState: Record<string, ExerciseState>
}

function eachExercise(program: Program): ExerciseLine[] {
  return program.weeks.flatMap((week) => week.days.flatMap((day) => day.exercises))
}

/**
 * The first absolute weight written on a line, or `undefined` when the line
 * only ever says `?+` or a percentage.
 *
 * DECISION: a line whose sole weight is a percentage (`3x5 75%`) counts as
 * unknown. A percentage is relative to a working weight the text does not
 * state, so there is nothing to adopt — the same reading `buildGzclpProgram`
 * takes when it leaves percentages alone.
 */
function declaredWeight(exercise: ExerciseLine): GzclpSeed[string] | undefined {
  for (const variation of exercise.setVariations) {
    for (const group of variation) {
      if (group.weight?.kind === 'absolute') {
        // The stage is not written in the text — it lives in `ExerciseState`,
        // so an adopted program always starts at variation 1. `deriveState`
        // recovers the real stage when a history export is available.
        return { weight: { value: group.weight.value, unit: group.weight.unit } }
      }
    }
  }
  return undefined
}

/**
 * Every working weight the program declares, keyed the way
 * `Profile.strengthTrack.programState` is keyed. The same lift on two days
 * shares one entry and the first line wins — the rule `initialProgramState`
 * already applies, mirrored here so the two cannot disagree.
 */
export function detectWeights(program: Program): GzclpSeed {
  const seed: GzclpSeed = {}
  for (const exercise of eachExercise(program)) {
    const key = exerciseKey(exercise)
    if (seed[key]) continue

    const entry = declaredWeight(exercise)
    if (entry) seed[key] = entry
  }
  return seed
}

/** The keys the program mentions but has no weight for, first line wins, in order. */
function askWeightKeysOf(program: Program, detected: GzclpSeed): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const exercise of eachExercise(program)) {
    const key = exerciseKey(exercise)
    if (seen.has(key)) continue
    seen.add(key)
    if (!detected[key]) keys.push(key)
  }
  return keys
}

/**
 * Parse a pasted program and adopt it: the weights it declares become the
 * profile's `programState`, and a lift written `?+` stays unknown so the first
 * session asks for it.
 *
 * A program with an error diagnostic is not adopted at all. Running a program
 * whose unsupported lines were silently dropped would prescribe a workout the
 * athlete never wrote, which is worse than refusing and offering the fallback.
 */
export function adoptProgramText(source: string): AdoptedProgram {
  const { program, diagnostics } = parseProgram(source)
  const detected = detectWeights(program)
  const askWeightKeys = askWeightKeysOf(program, detected)

  const base: AdoptedProgram = {
    programText: source,
    program,
    diagnostics,
    adopted: false,
    programState: {},
    detected,
    askWeightKeys,
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return base

  try {
    // `initialProgramState` re-parses and refuses ANY diagnostic, warnings
    // included, so a warning-only program cannot be adopted through it either.
    // DECISION: catch rather than pre-filter — the throw is the one authority
    // on what that helper accepts, and duplicating its precondition here is how
    // the two would drift apart.
    return { ...base, adopted: true, programState: initialProgramState(source, detected) }
  } catch {
    return base
  }
}

/**
 * The fallback the wizard offers when a paste cannot be adopted: keep the
 * weights we did detect, run the built-in GZCLP. Keys the built-in does not
 * have are simply not used, and its own lifts that the seed does not mention
 * come out as `?+`.
 */
export function gzclpFallback(detected: GzclpSeed): GzclpFallback {
  const programText = buildGzclpProgram(detected)
  return { programText, programState: initialProgramState(programText, detected) }
}
