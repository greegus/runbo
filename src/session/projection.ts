/**
 * Where a lift is headed: the next few sessions of one exercise, as the
 * program's own progression would write them if every one of them went to plan.
 *
 * Nothing here knows what GZCLP is. Each step is the real engine round trip the
 * app makes after a session — `prescribe` the sets, log them through the same
 * set cycle the session screen uses, `evaluateSession` the result — so the
 * table cannot disagree with what the program will prescribe next, whatever
 * progression the athlete wrote.
 *
 * KNOWN LIMIT: every step is evaluated in the one program slot it is given. A
 * lift is found by key wherever it sits, which is exact for GZCLP (one line per
 * lift, one week block), but a program that writes the same lift differently
 * per week, or a script that branches on `week`/`day`, is projected as if the
 * current slot repeated.
 *
 * Pure: no Vue, no Firestore, no `Date`.
 */

import type { Diagnostic } from '@/liftoscript/diagnostics'
import { evaluateSession, prescribe } from '@/liftoscript/evaluator'
import type { EvalContext, PrescribedSet, Program } from '@/liftoscript/types'
import type { ExerciseState, SetLog, WeightValue } from '@/types'

import { tapSet, toLoggedSet, toSetLog } from './setCycle'

/** How far ahead the table looks by default — about a month of GZCLP for one lift. */
export const DEFAULT_PROJECTED_SESSIONS = 8

export interface ProjectedSession {
  /** 1 = the next session of this lift (or the current one, from inside a session). */
  index: number
  /** 1-based, like `setVariationIndex`. */
  stage: number
  sets: PrescribedSet[]
  /** The heaviest working set — the number the athlete loads. */
  weight: WeightValue
  /** The progression moved the lift back to an earlier stage to get here. */
  stageReset: boolean
}

export interface LiftProjection {
  sessions: ProjectedSession[]
  /** Non-empty when the engine refused a step; `sessions` stops just before it. */
  diagnostics: Diagnostic[]
}

export interface ProjectionOptions {
  /** How many sessions to list, the first one included. */
  count?: number
  /**
   * The weight on the bar right now, when it is newer than the stored state —
   * a weight the athlete typed in this session has not reached `programState`
   * yet, and an ask-weight lift has nothing stored at all.
   */
  workingWeight?: WeightValue | null
}

/**
 * DECISION: every set is logged at exactly its target reps, AMRAP sets
 * included. That is the "everything goes to plan" path — the one line a
 * projection can honestly draw. Logging an AMRAP above target would invent
 * reps, and a progression keyed on a big AMRAP (GZCLP's T3 +2.5 kg at 25 reps)
 * correctly stays flat until the athlete actually does them.
 */
function asCompleted(sets: PrescribedSet[]): SetLog[] {
  // One tap per row is exactly "done at target", AMRAP or not.
  return sets.map((set) => toSetLog(tapSet(toLoggedSet(set))))
}

function heaviest(sets: PrescribedSet[]): WeightValue {
  return sets.reduce((top, set) => (set.weight.value > top.value ? set.weight : top), sets[0].weight)
}

/**
 * The stored state with the weight on the bar substituted. An ask-weight lift
 * with a weight entered is a known lift for the purpose of looking ahead: the
 * flag only means "prompt before the first set", which the projection never does.
 */
function startingState(state: ExerciseState, workingWeight: WeightValue | null | undefined): ExerciseState {
  if (!workingWeight || !(workingWeight.value > 0)) return state

  // One weight replaces the list: `evaluateSession` collapses the stored
  // weights to a single entry after every session anyway, so a per-stage list
  // would not survive the first projected step.
  return { ...state, weights: [{ ...workingWeight }], askWeight: false }
}

/**
 * The next `count` sessions of `exerciseKey`, starting from `state`.
 *
 * A lift whose weight is not known yet (`askWeight` with nothing stored and no
 * `workingWeight`) projects nothing: `prescribe` would fall back to the weight
 * written in the program text, which is the author's seed, not this athlete's.
 */
export function projectLift(
  program: Program,
  exerciseKey: string,
  state: ExerciseState,
  ctx: EvalContext,
  options: ProjectionOptions = {},
): LiftProjection {
  const count = Math.max(0, Math.trunc(options.count ?? DEFAULT_PROJECTED_SESSIONS))
  let current = startingState(state, options.workingWeight)

  if (current.askWeight === true && current.weights.length === 0) return { sessions: [], diagnostics: [] }

  const sessions: ProjectedSession[] = []
  let previousStage = current.setVariationIndex

  for (let index = 1; index <= count; index++) {
    const { sets, diagnostics } = prescribe(program, exerciseKey, current, ctx)
    if (diagnostics.length > 0) return { sessions, diagnostics }
    if (sets.length === 0) break

    sessions.push({
      index,
      stage: current.setVariationIndex,
      sets,
      weight: heaviest(sets),
      stageReset: current.setVariationIndex < previousStage,
    })

    const result = evaluateSession(program, exerciseKey, current, asCompleted(sets), ctx)
    if (result.diagnostics.length > 0) return { sessions, diagnostics: result.diagnostics }

    previousStage = current.setVariationIndex
    current = result.nextState
  }

  return { sessions, diagnostics: [] }
}

/** `8-12` for a range, `5` otherwise — the reps as the program writes them, without the AMRAP `+`. */
export function repsRange(set: PrescribedSet): string {
  return set.minReps === undefined ? `${set.reps}` : `${set.minReps}-${set.reps}`
}

/**
 * `5×3+` — the sets as the program writes them, grouped by rep target. GZCLP's
 * four straight sets plus one AMRAP read as one scheme, not as `4×3, 1×3+`: the
 * AMRAP is always the last set of its group.
 */
export function setsLabel(sets: PrescribedSet[]): string {
  const groups: { count: number; reps: string; amrap: boolean }[] = []

  for (const set of sets) {
    const reps = repsRange(set)
    const last = groups.at(-1)
    if (last && last.reps === reps && !last.amrap) {
      last.count += 1
      last.amrap = set.isAmrap
    } else {
      groups.push({ count: 1, reps, amrap: set.isAmrap })
    }
  }

  return groups.map((group) => `${group.count}×${group.reps}${group.amrap ? '+' : ''}`).join(', ')
}
