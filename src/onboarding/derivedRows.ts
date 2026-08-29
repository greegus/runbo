/**
 * The confirmation screen's data shaping: turning what `deriveState` reports
 * into the editable row list the user confirms, and turning the edited rows
 * back into a `programState`.
 *
 * Two things force this module to exist rather than living in the component.
 *
 * **The report is not the row list.** `report.exercises` only covers lifts with
 * logged history; the table must also show every program lift that has none, so
 * the row list is a merge of the program's own order, `programState` and the
 * report. Doing that merge in a template means doing it wrong.
 *
 * **Writing an edit back is domain discipline.** `askWeight` is *omitted*, never
 * set to `false`, and the custom-progression `state` vars must survive
 * untouched. That rule belongs next to a test, not next to an input.
 */

import type { DerivedState, ExerciseDerivation, UnmatchedExercise } from '@/import/deriveState'
import { exerciseKey } from '@/liftoscript/evaluator'
import type { ExerciseLine, Program } from '@/liftoscript/types'
import { reviewReasonsFor } from '@/onboarding/deriveCopy'
import type { CursorRow, DerivedRow } from '@/onboarding/types'
import type { ExerciseState } from '@/types'

/**
 * Splits `'T1:Squat'` into its tier and its lift name.
 *
 * `tierOfKey` is private to `deriveState`, and a lift with no history has no
 * derivation to read a name or a tier off — so the key itself is the only
 * source. Split on the FIRST colon: an exercise name may contain one, a label
 * may not.
 */
export function parseExerciseKey(key: string): { tier: 1 | 2 | 3 | undefined; lift: string } {
  const colon = key.indexOf(':')
  if (colon < 0) return { tier: undefined, lift: key }

  const label = key.slice(0, colon)
  const match = /^T([123])$/i.exec(label)

  return match ? { tier: Number(match[1]) as 1 | 2 | 3, lift: key.slice(colon + 1) } : { tier: undefined, lift: key }
}

/** Every exercise line of the program, in the order the text writes them. */
function eachExercise(program: Program): ExerciseLine[] {
  return program.weeks.flatMap((week) => week.days.flatMap((day) => day.exercises))
}

/** Program order, first line wins — the same rule `initialProgramState` applies. */
function orderedKeys(program: Program, programState: Record<string, ExerciseState>): string[] {
  const keys: string[] = []
  const seen = new Set<string>()

  for (const exercise of eachExercise(program)) {
    const key = exerciseKey(exercise)
    if (seen.has(key)) continue
    seen.add(key)
    if (programState[key]) keys.push(key)
  }

  // A key the program does not name but the state carries would otherwise be
  // invisible and silently kept — the user must at least see what they are
  // confirming.
  for (const key of Object.keys(programState)) if (!seen.has(key)) keys.push(key)

  return keys
}

/** How many set variations the program line for this key declares. */
function variationCountOf(program: Program, key: string): number {
  for (const exercise of eachExercise(program)) {
    if (exerciseKey(exercise) === key) return Math.max(exercise.setVariations.length, 1)
  }
  return 1
}

/**
 * The unit every row is edited in.
 *
 * DECISION: `buildDerivedRows` is given no `GymSettings`, so the unit is read
 * from the data itself — the first weight the state or the log carries — and
 * falls back to `'kg'` only when there is not a single weight anywhere. A row
 * whose weight is empty has no unit of its own, and defaulting the whole table
 * to kg for an lb athlete would relabel every number they then type.
 */
function tableUnit(programState: Record<string, ExerciseState>, derivations: ExerciseDerivation[]): 'kg' | 'lb' {
  for (const state of Object.values(programState)) if (state.weights[0]) return state.weights[0].unit
  for (const derivation of derivations) if (derivation.weight.value) return derivation.weight.value.unit
  return 'kg'
}

function clampStage(stage: number, count: number): number {
  if (!Number.isFinite(stage)) return 1
  return Math.min(Math.max(Math.round(stage), 1), Math.max(count, 1))
}

/**
 * One row per lift the program will prescribe — with history or without.
 *
 * The editable half is seeded from `programState`, i.e. from what the app will
 * prescribe NEXT, not from what the log says was lifted. The observed weight
 * rides along as evidence so the screen can show both and say which is which.
 */
export function buildDerivedRows(
  derived: DerivedState,
  programState: Record<string, ExerciseState>,
  program: Program,
): DerivedRow[] {
  const byKey = new Map(derived.report.exercises.map((exercise) => [exercise.key, exercise]))
  const unit = tableUnit(programState, derived.report.exercises)

  return orderedKeys(program, programState).map((key) => {
    const state = programState[key]
    const derivation = byKey.get(key)
    const { tier, lift } = parseExerciseKey(key)
    const variationCount = variationCountOf(program, key)
    const reviewReasons = reviewReasonsFor(derivation)
    const stored = state?.weights[0]
    // An empty `weights` and an explicit `askWeight` mean the same thing here:
    // the app has no weight and will ask at the gym.
    const askWeight = !stored || state.askWeight === true

    return {
      key,
      lift,
      tier,
      observedWeight: derivation?.weight.value ? { ...derivation.weight.value } : null,
      observedShape: derivation?.variation.loggedShape ?? '',
      weightConfidence: derivation?.weight.confidence ?? null,
      variationConfidence: derivation?.variation.confidence ?? null,
      matchKind: derivation?.variation.match ?? null,
      keyResolution: derivation?.keyResolution ?? 'none',
      lastLoggedDate: derivation?.lastLoggedDate ?? null,
      tiedCandidates: derivation?.variation.tiedCandidates?.map((candidate) => ({ ...candidate })) ?? [],
      replayFailed: derivation ? !derivation.replayed : false,
      replayDiagnostics: derivation?.replayDiagnostics ?? [],
      needsReview: reviewReasons.length > 0,
      reviewReasons,
      weight: askWeight ? null : stored.value,
      unit: stored?.unit ?? unit,
      stage: clampStage(state?.setVariationIndex ?? 1, variationCount),
      variationCount,
    }
  })
}

/**
 * The cursor block above the table.
 *
 * `deriveState` does not return the parsed program, so the day names it would
 * take to render a picker have to come from the program the caller already
 * holds — which is why this takes one.
 */
export function buildCursorRow(derived: DerivedState, program: Program): CursorRow {
  const cursor = derived.report.cursor

  return {
    value: derived.rotationCursor,
    dayNames: program.weeks.flatMap((week) => week.days.map((day) => day.name)),
    source: cursor.source,
    confidence: cursor.confidence,
    suspect: cursor.suspect,
    ...(cursor.lastProgramDay === undefined ? {} : { lastProgramDay: cursor.lastProgramDay }),
    ...(cursor.nextProgramDay === undefined ? {} : { nextProgramDay: cursor.nextProgramDay }),
  }
}

/**
 * One entry per unmatched lift, newest sighting kept.
 *
 * `deriveState` dedupes one of its two unmatched branches and not the other, so
 * a lift the program cannot key yields one entry per session it appeared in. A
 * keyed `v-for` over that list drops rows; a list of decisions that repeats the
 * same decision four times is worse.
 */
export function dedupeUnmatched(unmatched: UnmatchedExercise[]): UnmatchedExercise[] {
  const byKey = new Map<string, UnmatchedExercise>()

  for (const entry of unmatched) {
    const existing = byKey.get(entry.key)
    if (!existing) {
      byKey.set(entry.key, { ...entry, ...(entry.candidateKeys ? { candidateKeys: [...entry.candidateKeys] } : {}) })
      continue
    }

    if (entry.lastLoggedDate > existing.lastLoggedDate) existing.lastLoggedDate = entry.lastLoggedDate
    if (entry.candidateKeys) {
      existing.candidateKeys = [...new Set([...(existing.candidateKeys ?? []), ...entry.candidateKeys])]
    }
  }

  return [...byKey.values()]
}

/**
 * The edited rows written back onto the derived state.
 *
 * `askWeight` is deleted rather than set to `false` — the domain layer omits
 * the key entirely, and a `false` would be a shape nothing else in the app
 * produces. The custom-progression `state` vars are carried through untouched:
 * they are the progression's memory, and rebuilding them here would reset it.
 */
export function applyRowEdits(rows: DerivedRow[], base: Record<string, ExerciseState>): Record<string, ExerciseState> {
  const next: Record<string, ExerciseState> = { ...base }

  for (const row of rows) {
    const state = base[row.key] ?? { weights: [], setVariationIndex: 1, state: {} }
    const stage = clampStage(row.stage, row.variationCount)

    if (row.weight === null || !Number.isFinite(row.weight) || row.weight <= 0) {
      next[row.key] = { ...state, weights: [], setVariationIndex: stage, askWeight: true }
      continue
    }

    const updated: ExerciseState = {
      ...state,
      weights: [{ value: row.weight, unit: row.unit }],
      setVariationIndex: stage,
    }
    delete updated.askWeight
    next[row.key] = updated
  }

  return next
}
