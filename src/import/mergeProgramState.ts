/**
 * Merging an edited program's fresh seed into the `programState` the athlete
 * already earned.
 *
 * `adoptProgramText` re-seeds from the text every time it is called: every lift
 * comes back at the weight the text declares, at stage 1, with the progression's
 * initial state vars. Saving that verbatim would be correct exactly once — on
 * the first adoption — and destructive on every later edit, because a lift that
 * has been trained for eight weeks carries its accumulated working weight and
 * its stage in the STATE, never in the text.
 *
 * DECISION: merge, never wipe. An existing key keeps its whole `ExerciseState`;
 * only a key the text has just introduced takes the seed. A key the text no
 * longer mentions is dropped and REPORTED, so the view can name it before the
 * save rather than after — a lift disappearing silently is the worse failure.
 */

import { exerciseKey } from '@/liftoscript/evaluator'
import type { ExerciseLine, Program } from '@/liftoscript/types'
import type { ExerciseState } from '@/types'

export interface ProgramStateMerge {
  programState: Record<string, ExerciseState>
  /** Keys carried over with their accumulated progression. */
  kept: string[]
  /** New keys taking the adopted seed. */
  seeded: string[]
  /** Keys that no longer exist in the new program text. */
  dropped: string[]
}

function eachExercise(program: Program): ExerciseLine[] {
  return program.weeks.flatMap((week) => week.days.flatMap((day) => day.exercises))
}

/**
 * How many set variations (stages) each exercise key has in this program.
 *
 * The same lift on two days shares one entry and the first line wins — the rule
 * `initialProgramState` already applies, mirrored here so the two cannot
 * disagree about which line owns a key.
 */
export function variationCounts(program: Program): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const exercise of eachExercise(program)) {
    const key = exerciseKey(exercise)
    if (counts[key] !== undefined) continue

    counts[key] = exercise.setVariations.length
  }

  return counts
}

/** Plain data, no reactive proxies: this object is written straight to Firestore. */
function cloneState(state: ExerciseState): ExerciseState {
  return {
    weights: state.weights.map((item) => ({ ...item })),
    setVariationIndex: state.setVariationIndex,
    state: Object.fromEntries(
      Object.entries(state.state).map(([name, value]) => [name, typeof value === 'number' ? value : { ...value }]),
    ),
    ...(state.askWeight === undefined ? {} : { askWeight: state.askWeight }),
  }
}

/**
 * The `programState` to save alongside an edited program text.
 *
 * `variationCounts` is optional because the two records alone cannot say how
 * many stages the NEW text gives a lift — the count lives in the AST. Pass it
 * (via `variationCounts(program)`) whenever the parsed program is at hand, or a
 * lift whose stage list shrank keeps an index the evaluator would have to clamp
 * silently on every prescription.
 */
export function mergeProgramState(
  existing: Record<string, ExerciseState>,
  adopted: Record<string, ExerciseState>,
  options: { variationCounts?: Record<string, number> } = {},
): ProgramStateMerge {
  const programState: Record<string, ExerciseState> = {}
  const kept: string[] = []
  const seeded: string[] = []
  const dropped: string[] = []

  for (const key of Object.keys(adopted)) {
    const prior = existing[key]

    if (!prior) {
      programState[key] = cloneState(adopted[key])
      seeded.push(key)
      continue
    }

    const count = options.variationCounts?.[key]
    const state = cloneState(prior)

    // Stages are 1-based (`ExerciseState.setVariationIndex`, like Liftoscript).
    // A program edited from three stages down to two leaves a lift sitting on
    // stage 3, which `variationOf` would clamp on every prescription without
    // ever telling the athlete — so the clamp is made once, here, and the key
    // is still reported as kept because everything else about it survives.
    if (count !== undefined && count > 0) {
      state.setVariationIndex = Math.min(Math.max(state.setVariationIndex, 1), count)
    }

    programState[key] = state
    kept.push(key)
  }

  for (const key of Object.keys(existing)) {
    if (adopted[key] === undefined) dropped.push(key)
  }

  return { programState, kept, seeded, dropped }
}
