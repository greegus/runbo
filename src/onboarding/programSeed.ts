/**
 * The fresh-GZCLP path's arithmetic-free half: turning the per-lift rows the
 * wizard shows into the three `strengthTrack` fields the profile stores.
 *
 * Nothing here decides a training rule. `seedFromFiveRepMax` owns the tier
 * factors, `buildGzclpProgram` owns the program text and `initialProgramState`
 * owns the state shape — this module only maps between those and the form's
 * row list, which is the part a `.vue` file cannot be tested through.
 */

import { parseExerciseKey } from '@/onboarding/derivedRows'
import type { GymSettings, LiftSeedDraft, StrengthTrack } from '@/onboarding/types'
import {
  buildGzclpProgram,
  initialProgramState,
  seedFromFiveRepMax,
  type GzclpSeed,
  type GzclpSeedEntry,
} from '@/training/gzclp'
import { evalContextFromSettings } from '@/training/plates'
import type { ExerciseState } from '@/types'

/**
 * The keys of the built-in program grouped by the day that introduces them.
 * The two T3 lines appear once each — a lift trained on two days has one
 * working weight, so showing it twice would invite two answers to one question,
 * which is why A2 and B2 carry only what they add.
 *
 * The grouping lives here, not in the form: which lift belongs to which day is
 * program knowledge. A component that re-derived it by slicing index ranges out
 * of the flat list would break silently the moment a key moved.
 */
export const GZCLP_SEED_GROUPS: { day: string; keys: string[] }[] = [
  { day: 'A1', keys: ['T1:Squat', 'T2:Bench Press', 'T3:Lat Pulldown'] },
  { day: 'B1', keys: ['T1:Overhead Press', 'T2:Deadlift', 'T3:Bent Over Row'] },
  { day: 'A2', keys: ['T1:Bench Press', 'T2:Squat'] },
  { day: 'B2', keys: ['T1:Deadlift', 'T2:Overhead Press'] },
]

/** The same ten keys flattened, in the order the four days train them. */
export const GZCLP_SEED_KEYS: string[] = GZCLP_SEED_GROUPS.flatMap((group) => group.keys)

function tierOf(key: string): 1 | 2 | 3 {
  return parseExerciseKey(key).tier ?? 3
}

function isSeeded(draft: LiftSeedDraft): boolean {
  return draft.weight !== null && Number.isFinite(draft.weight) && draft.weight > 0
}

/**
 * A T3 line has one set variation, so its stage is always 1. Clamping here
 * rather than in the form means a stage that arrives out of range from an older
 * draft cannot reach `initialProgramState`, which would clamp it silently.
 */
function stageOf(draft: LiftSeedDraft): number {
  if (draft.tier === 3) return 1
  if (!Number.isFinite(draft.stage)) return 1
  return Math.min(Math.max(Math.round(draft.stage), 1), 3)
}

/**
 * One row per GZCLP key, pre-filled from a `programState` that already exists —
 * so re-entering the step (or opening this form in Settings) shows what is
 * stored rather than an empty grid.
 */
export function seedDraftsFrom(state: Record<string, ExerciseState>, units: 'kg' | 'lb'): LiftSeedDraft[] {
  return GZCLP_SEED_KEYS.map((key) => {
    const tier = tierOf(key)
    const stored = state[key]
    const weight = stored?.weights[0]
    // An explicit `askWeight` outranks a stale weight: it is the flag the first
    // session reads, so honouring it keeps the form and the gym in agreement.
    const known = weight && stored.askWeight !== true && weight.unit === units

    return {
      key,
      lift: parseExerciseKey(key).lift,
      tier,
      weight: known ? weight.value : null,
      stage: tier === 3 ? 1 : Math.min(Math.max(stored?.setVariationIndex ?? 1, 1), 3),
      fiveRm: null,
    }
  })
}

/**
 * The "I don't know" helper: 85 % of a 5RM for a T1, 65 % for a T2, 50 % for a
 * T3, rounded to what the athlete's own bar and plates can actually be loaded
 * to. The 5RM stays on the draft so going back a step does not lose it, and the
 * computed weight stays editable — it is a starting point, not a verdict.
 */
export function computeFromFiveRm(draft: LiftSeedDraft, settings: GymSettings): LiftSeedDraft {
  if (draft.fiveRm === null || !Number.isFinite(draft.fiveRm) || draft.fiveRm <= 0) return draft

  const entry = seedFromFiveRepMax(
    draft.key,
    { value: draft.fiveRm, unit: settings.units },
    evalContextFromSettings(settings),
  )

  return { ...draft, weight: entry.weight.value }
}

/** The rows that carry a weight, as the seed `buildGzclpProgram` consumes. Empty rows are ask-weight. */
export function gzclpSeedFrom(drafts: LiftSeedDraft[], units: 'kg' | 'lb'): GzclpSeed {
  const seed: GzclpSeed = {}

  for (const draft of drafts) {
    if (!isSeeded(draft)) continue

    const entry: GzclpSeedEntry = { weight: { value: draft.weight as number, unit: units }, stage: stageOf(draft) }
    seed[draft.key] = entry
  }

  return seed
}

/**
 * The fresh path's result. `rotationCursor` is 0 because a fresh program starts
 * at its first day — `GZCLP_ROTATION[0]` is A1, which is what Today must show
 * the moment the wizard finishes.
 */
export function strengthTrackFromDrafts(
  drafts: LiftSeedDraft[],
  base: StrengthTrack,
  units: 'kg' | 'lb',
): StrengthTrack {
  const seed = gzclpSeedFrom(drafts, units)
  const programText = buildGzclpProgram(seed)

  return { goal: base.goal, programText, programState: initialProgramState(programText, seed), rotationCursor: 0 }
}

/**
 * The import path's result: the adopted text and state are stored verbatim.
 * `adoptProgramText` never rewrites the paste, and neither does this — an
 * athlete who pastes their program must get their program back.
 */
export function strengthTrackFromAdoption(
  adopted: { programText: string; programState: Record<string, ExerciseState> },
  base: StrengthTrack,
  rotationCursor = 0,
): StrengthTrack {
  return {
    goal: base.goal,
    programText: adopted.programText,
    programState: adopted.programState,
    rotationCursor: Number.isFinite(rotationCursor) ? Math.max(Math.round(rotationCursor), 0) : 0,
  }
}
