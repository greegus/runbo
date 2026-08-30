/**
 * Everything the strength session screen has to decide, as plain functions over
 * plain data: which lines the day prescribes, what document to create before the
 * first set, how to rehydrate a half-logged session after a reload, how to
 * project the logged sets back for persistence, and whether finishing is allowed.
 *
 * Pure: no Vue, no Firestore, no `Date`. Every number here comes from the engine
 * (`prescribe`, `restTimerFor`, `roundToLoadable`) — this module only sequences
 * those calls, because the view must not.
 */

import { createDiagnostic, type Diagnostic } from '@/liftoscript/diagnostics'
import { exerciseKey, prescribe } from '@/liftoscript/evaluator'
import { parseProgram } from '@/liftoscript/parser'
import type { ExerciseLine, PrescribedSet, Program, WarmupPrescription } from '@/liftoscript/types'
import type { SessionDraft } from '@/stores/sessions'
import { resolveExercise } from '@/training/exercises'
import { restTimerFor, tierOf } from '@/training/gzclp'
import { evalContextFromSettings } from '@/training/plates'
import type { ReadinessInput } from '@/training/readiness'
import type { ExerciseState, Profile, Session, SetLog, WeightValue } from '@/types'

import { fromSetLog, isLogged, toLoggedSet, toSetLog } from './setCycle'
import type { LoggedSet } from './types'

/** Where a synthesised (non-parser) diagnostic points: the top of the program text. */
const ORIGIN = { line: 1, col: 1 }

export interface PrescribedExercise {
  /** `exerciseKey(line)` — 'T1:Squat'. The key into `programState`. */
  key: string
  /** The program line's name — what goes on `Session.exercises[].name`. */
  name: string
  tier: 1 | 2 | 3 | undefined
  sets: PrescribedSet[]
  warmup: WarmupPrescription[]
  defaultRestSec: number
  askWeight: boolean
  workingWeight: WeightValue | null
  showPlates: boolean
  diagnostics: Diagnostic[]
}

export interface StrengthPlan {
  programDay: string
  /** 1-based slot in the parsed program — what `EvalContext` needs to find the line. */
  week: number
  day: number
  exercises: PrescribedExercise[]
  /** Program-level. Non-empty => the caller MUST refuse to start. */
  diagnostics: Diagnostic[]
}

/** A state stub for a line the profile has never seen: unknown weight, stage 1. */
function unknownState(): ExerciseState {
  return { weights: [], setVariationIndex: 1, state: {}, askWeight: true }
}

/**
 * The slot is found by day NAME, never from `rotationCursor`: a claim or a swap
 * moves the day the athlete actually trains off the stored cursor, and
 * `prescribe` resolves the line by `ctx.week`/`ctx.day`, so the wrong slot
 * silently prescribes another day's lifts.
 */
function slotOf(program: Program, programDay: string): { week: number; day: number } | null {
  for (const [weekIndex, week] of program.weeks.entries()) {
    const dayIndex = week.days.findIndex((day) => day.name === programDay)
    if (dayIndex >= 0) return { week: weekIndex + 1, day: dayIndex + 1 }
  }

  return null
}

/** The state's working weight for the active variation, or `null` when none is known. */
function workingWeightOf(state: ExerciseState, sets: PrescribedSet[]): WeightValue | null {
  const stored = state.weights[Math.max(0, state.setVariationIndex - 1)] ?? state.weights.at(-1)
  if (stored && Number.isFinite(stored.value) && stored.value > 0) return { ...stored }

  // DECISION: an ask-weight line with nothing stored has NO working weight, even
  // though `prescribe` still resolves the weight written in the program text.
  // That number is the program author's seed, not this athlete's weight, and
  // returning it would let the screen log a session at a weight nobody chose.
  if (state.askWeight === true) return null

  const seeded = sets.find((set) => Number.isFinite(set.weight?.value) && set.weight.value > 0)

  return seeded ? { ...seeded.weight } : null
}

function prescribeLine(profile: Profile, program: Program, line: ExerciseLine, slot: { week: number; day: number }) {
  const key = exerciseKey(line)
  const state = profile.strengthTrack.programState[key] ?? unknownState()
  const ctx = evalContextFromSettings(profile.settings, slot)
  const { sets, warmup, diagnostics } = prescribe(program, key, state, ctx)
  const tier = tierOf(line)

  const exercise: PrescribedExercise = {
    key,
    name: line.name,
    tier,
    sets,
    warmup,
    defaultRestSec: restTimerFor(tier, profile.settings.restTimers),
    // Any ask-weight set makes the whole line ask: GZCLP's `askWeight` is a
    // property of the lift, not of one row, and one working weight drives them all.
    askWeight: state.askWeight === true || sets.some((set) => set.askWeight === true),
    workingWeight: workingWeightOf(state, sets),
    // Only a barbell lift has plates to hang; a machine's "20 + 25/20" is a lie.
    showPlates: resolveExercise(line.name)?.kind === 'barbell',
    diagnostics,
  }

  return exercise
}

/**
 * The day's prescription, in program order (T1, T2, T3).
 *
 * `profile.strengthTrack.programText` is parsed — never `gzclpProgram()`, which
 * carries the built-in seed weights instead of the athlete's own.
 */
export function buildStrengthPlan(profile: Profile, programDay: string): StrengthPlan {
  const { program, diagnostics } = parseProgram(profile.strengthTrack.programText)

  if (diagnostics.length > 0) {
    return { programDay, week: 1, day: 1, exercises: [], diagnostics }
  }

  const slot = slotOf(program, programDay)

  if (!slot) {
    return {
      programDay,
      week: 1,
      day: 1,
      exercises: [],
      diagnostics: [createDiagnostic(`Day "${programDay}" is not in the program.`, ORIGIN, '')],
    }
  }

  const lines = program.weeks[slot.week - 1]?.days[slot.day - 1]?.exercises ?? []

  return {
    programDay,
    week: slot.week,
    day: slot.day,
    exercises: lines.map((line) => prescribeLine(profile, program, line, slot)),
    diagnostics: [],
  }
}

/** The prescribed set as it is first stored: nothing completed yet. */
function initialSetLog(set: PrescribedSet): SetLog {
  return toSetLog(toLoggedSet(set))
}

/**
 * The document created BEFORE the athlete touches a set — that is what makes a
 * half-logged session survive a locked phone.
 *
 * `tier` is written whenever the line has one: `finishSession` rebuilds the
 * `programState` key as `exerciseKey({ name, label: 'T' + tier })`, so omitting
 * it silently skips the progression. Optional keys are omitted rather than set
 * to `undefined`, which Firestore rejects.
 */
export function draftFromPlan(plan: StrengthPlan, dateIso: string, readiness?: ReadinessInput): SessionDraft {
  return {
    date: dateIso,
    kind: 'strength',
    programDay: plan.programDay,
    ...(readiness ? { readiness } : {}),
    exercises: plan.exercises.map((exercise) => ({
      name: exercise.name,
      ...(exercise.tier === undefined ? {} : { tier: exercise.tier }),
      // Working sets ONLY. A warmup in here would be fed to the progression
      // script and counted as working volume by the stats.
      sets: exercise.sets.map(initialSetLog),
    })),
  }
}

/** Rehydrate after a reload. Skipped-vs-untouched is lost; both were `null` and both are the same miss. */
export function loggedSetsFromSession(session: Session): LoggedSet[][] {
  return (session.exercises ?? []).map((exercise) => exercise.sets.map(fromSetLog))
}

/** Project the in-memory sets back onto the document for persistence. */
export function applyLoggedSets(session: Session, logged: LoggedSet[][]): Session {
  return {
    ...session,
    exercises: (session.exercises ?? []).map((exercise, index) => ({
      ...exercise,
      sets: (logged[index] ?? []).length > 0 ? logged[index].map(toSetLog) : exercise.sets,
    })),
  }
}

/** An explicit rest written in the program text ALWAYS wins over the tier default. */
export function restSecFor(exercise: PrescribedExercise, setIndex: number): number {
  return exercise.sets[setIndex]?.restTimerSec ?? exercise.defaultRestSec
}

/**
 * One working weight per exercise. An UNTOUCHED set is rewritten because it has
 * not happened yet; a logged one is left alone because it records what was
 * actually lifted.
 *
 * With one exception: a set carrying no weight at all. Zero is not something
 * anyone lifted — it is the placeholder an ask-weight lift starts at.
 *
 * The screen prevents that combination today: `TierBlock` disables every row of
 * a lift with no weight, and `SetRow.commit` guards on it rather than trusting
 * the styling. But the two rules disagree in principle — this one refuses to
 * touch a logged set, while `finishBlockedReason` rejects any set at zero — and
 * that disagreement has only one outcome if the guard ever moves: a session that
 * cannot be finished, only deleted. Left as a lift at zero would be, this is the
 * cheaper side of the trade.
 */
export function applyWorkingWeight(sets: LoggedSet[], weight: WeightValue): LoggedSet[] {
  return sets.map((set) =>
    set.phase === 'untouched' || !(set.weight?.value > 0) ? { ...set, weight: { ...weight } } : set,
  )
}

/**
 * Why finishing is blocked, or `null`.
 *
 * A partially logged session IS finishable: an untouched set is a miss, and a
 * miss is exactly what the GZCLP stage advance is looking for. An entirely empty
 * session is a mis-tap, not data.
 */
export function finishBlockedReason(plan: StrengthPlan, logged: LoggedSet[][]): string | null {
  for (const [index, exercise] of plan.exercises.entries()) {
    const sets = logged[index] ?? []
    if (sets.some((set) => !Number.isFinite(set.weight?.value) || set.weight.value <= 0)) {
      return `Enter a weight for ${exercise.name}`
    }
  }

  const anyLogged = logged.some((sets) => sets.some(isLogged))

  return anyLogged ? null : 'Log at least one set before finishing'
}
