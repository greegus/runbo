/**
 * The built-in GZCLP program: its source text, the seeding helpers onboarding
 * uses to substitute starting weights, and the rotation/interference helpers
 * the calendar composer asks about a program day.
 *
 * Everything here goes through the Liftoscript engine — the program is parsed,
 * the AST is edited and re-serialized. String surgery on program text would
 * silently produce something that no longer parses.
 */

import { exerciseKey } from '@/liftoscript/evaluator'
import { parseProgram } from '@/liftoscript/parser'
import { desugarProgression } from '@/liftoscript/progressions'
import { serializeProgram } from '@/liftoscript/serialize'
import type { Day, EvalContext, ExerciseLine, Program, SetGroup } from '@/liftoscript/types'
import type { Weight } from '@/liftoscript/weight'
import { divide, multiply, roundWeight, weight } from '@/liftoscript/weight'
import type { ExerciseState, WeightValue } from '@/types'

/**
 * Verbatim copy of `liftoscript/__tests__/fixtures/gzclp-builtin.txt`, which is
 * covered by the engine's own tests (parses with zero diagnostics, round-trips,
 * and produces the GZCLP progression behaviour the plan lists as acceptance
 * criteria). The two must stay identical — `gzclp.spec.ts` asserts it.
 */
export const GZCLP_PROGRAM_SOURCE = `/// runbo's built-in GZCLP program. One week block of four days; the scheduler
/// cycles A1 -> B1 -> A2 -> B2 through \`rotationCursor\`, so week repetition is
/// never needed. T1/T2/T3 labels drive rest-timer and warmup defaults.
/// \`completedReps >= reps\` (not zeroOrGte) is deliberate: in GZCLP a set you did
/// not do is a failed session, and at T1 stage 3 (10x1+) a miss IS a zero, which
/// zeroOrGte would forgive - the stage would never reset.
/// \`state.inc\` carries the per-lift increment: 5kg for Squat/Deadlift,
/// 2.5kg for Bench Press/Overhead Press.
# Week 1
## A1
T1: Squat / 5x3+ / 6x2+ / 10x1+ / 100kg / warmup: 1x5 20kg, 1x3 55%, 1x2 75% / progress: custom(inc: 5kg, resetFactor: 0.85) {~
  if (completedReps >= reps) {
    weights += state.inc
  } else if (setVariationIndex >= 3) {
    setVariationIndex = 1
    weights = roundWeight(weights[1] * state.resetFactor)
  } else {
    setVariationIndex += 1
  }
~}
T2: Bench Press / 3x10 / 3x8 / 3x6 / 60kg / warmup: 1x5 20kg, 1x3 55% / progress: custom(inc: 2.5kg, resetFactor: 0.85) {~
  if (completedReps >= reps) {
    weights += state.inc
  } else if (setVariationIndex >= 3) {
    setVariationIndex = 1
    weights = roundWeight(weights[1] * state.resetFactor)
  } else {
    setVariationIndex += 1
  }
~}
T3: Lat Pulldown / 3x15+ / 40kg / warmup: none / progress: custom() {~ if (completedReps[3] >= 25) { weights += 2.5kg } ~}

## B1
T1: Overhead Press / 5x3+ / 6x2+ / 10x1+ / 45kg / warmup: 1x5 20kg, 1x3 55%, 1x2 75% / progress: custom(inc: 2.5kg, resetFactor: 0.85) {~
  if (completedReps >= reps) {
    weights += state.inc
  } else if (setVariationIndex >= 3) {
    setVariationIndex = 1
    weights = roundWeight(weights[1] * state.resetFactor)
  } else {
    setVariationIndex += 1
  }
~}
T2: Deadlift / 3x10 / 3x8 / 3x6 / 90kg / warmup: 1x5 60kg, 1x3 55% / progress: custom(inc: 5kg, resetFactor: 0.85) {~
  if (completedReps >= reps) {
    weights += state.inc
  } else if (setVariationIndex >= 3) {
    setVariationIndex = 1
    weights = roundWeight(weights[1] * state.resetFactor)
  } else {
    setVariationIndex += 1
  }
~}
T3: Bent Over Row / 3x15+ / 40kg / warmup: none / progress: custom() {~ if (completedReps[3] >= 25) { weights += 2.5kg } ~}

## A2
T1: Bench Press / 5x3+ / 6x2+ / 10x1+ / 80kg / warmup: 1x5 20kg, 1x3 55%, 1x2 75% / progress: custom(inc: 2.5kg, resetFactor: 0.85) {~
  if (completedReps >= reps) {
    weights += state.inc
  } else if (setVariationIndex >= 3) {
    setVariationIndex = 1
    weights = roundWeight(weights[1] * state.resetFactor)
  } else {
    setVariationIndex += 1
  }
~}
T2: Squat / 3x10 / 3x8 / 3x6 / 75kg / warmup: 1x5 20kg, 1x3 55% / progress: custom(inc: 5kg, resetFactor: 0.85) {~
  if (completedReps >= reps) {
    weights += state.inc
  } else if (setVariationIndex >= 3) {
    setVariationIndex = 1
    weights = roundWeight(weights[1] * state.resetFactor)
  } else {
    setVariationIndex += 1
  }
~}
T3: Lat Pulldown / 3x15+ / 40kg / warmup: none / progress: custom() {~ if (completedReps[3] >= 25) { weights += 2.5kg } ~}

## B2
T1: Deadlift / 5x3+ / 6x2+ / 10x1+ / 120kg / warmup: 1x5 60kg, 1x3 55%, 1x2 75% / progress: custom(inc: 5kg, resetFactor: 0.85) {~
  if (completedReps >= reps) {
    weights += state.inc
  } else if (setVariationIndex >= 3) {
    setVariationIndex = 1
    weights = roundWeight(weights[1] * state.resetFactor)
  } else {
    setVariationIndex += 1
  }
~}
T2: Overhead Press / 3x10 / 3x8 / 3x6 / 35kg / warmup: 1x5 20kg, 1x3 55% / progress: custom(inc: 2.5kg, resetFactor: 0.85) {~
  if (completedReps >= reps) {
    weights += state.inc
  } else if (setVariationIndex >= 3) {
    setVariationIndex = 1
    weights = roundWeight(weights[1] * state.resetFactor)
  } else {
    setVariationIndex += 1
  }
~}
T3: Bent Over Row / 3x15+ / 40kg / warmup: none / progress: custom() {~ if (completedReps[3] >= 25) { weights += 2.5kg } ~}
`

/** The four program days, in the order the scheduler cycles them. */
export const GZCLP_ROTATION = ['A1', 'B1', 'A2', 'B2'] as const

export type GzclpProgramDay = (typeof GZCLP_ROTATION)[number]

/** Rest-timer defaults per tier, in seconds (`Profile.settings.restTimers`). */
export const DEFAULT_REST_TIMERS = { t1: 180, t2: 120, t3: 60 } as const

export type RestTimers = { t1: number; t2: number; t3: number }

export type Tier = 1 | 2 | 3

/**
 * What onboarding knows about one lift: the working weight and the stage
 * (`setVariationIndex`) it is at. A lift missing from the seed is unknown and
 * becomes an ask-weight (`?+`) line.
 */
export interface GzclpSeedEntry {
  weight: WeightValue
  stage?: number // 1-based, like Liftoscript; defaults to 1
}

/** Keyed by `exerciseKey()`: `'T1:Squat'`, `'T2:Bench Press'`, `'T3:Lat Pulldown'`, … */
export type GzclpSeed = Record<string, GzclpSeedEntry>

/**
 * The part of an `EvalContext` that weight rounding needs. Callers holding only
 * `Profile.settings` should not have to invent a week/day to round a weight.
 */
export type LoadContext = Pick<EvalContext, 'units' | 'plates' | 'barbellWeight'>

function roundingContext(load: LoadContext): EvalContext {
  return { ...load, week: 1, day: 1 }
}

function parseOrThrow(source: string): Program {
  const { program, diagnostics } = parseProgram(source)
  if (diagnostics.length > 0) {
    const first = diagnostics[0]
    throw new Error(`GZCLP program does not parse (line ${first.line}, col ${first.col}): ${first.message}`)
  }
  return program
}

let builtinCache: Program | undefined

/** The parsed built-in program. Parsed once — the source is a constant. */
export function gzclpProgram(): Program {
  builtinCache ??= parseOrThrow(GZCLP_PROGRAM_SOURCE)
  return builtinCache
}

function eachExercise(program: Program): ExerciseLine[] {
  return program.weeks.flatMap((week) => week.days.flatMap((day) => day.exercises))
}

// ---------------------------------------------------------------------------
// Tiers and rest timers
// ---------------------------------------------------------------------------

/**
 * The tier a line is labelled with. The engine keeps its own private copy for
 * warmup defaults but does not export it, and the UI needs the same answer for
 * rest timers and tier blocks.
 */
export function tierOf(exercise: { label?: string }): Tier | undefined {
  switch (exercise.label?.toUpperCase()) {
    case 'T1':
      return 1
    case 'T2':
      return 2
    case 'T3':
      return 3
    default:
      return undefined
  }
}

/**
 * Default rest between sets. An explicit timer in the program text (`60s|30s`)
 * always wins over this — the caller checks `PrescribedSet.restTimerSec` first.
 */
export function restTimerFor(tier: Tier | undefined, timers: RestTimers = DEFAULT_REST_TIMERS): number {
  switch (tier) {
    case 1:
      return timers.t1
    case 2:
      return timers.t2
    default:
      // An unlabelled accessory is a T3 in everything but name.
      return timers.t3
  }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/** T1 works at 85 % of a 5RM, T2 at 65 %; a T3 is a 15-rep set, so far lighter. */
function tierFactor(tier: Tier | undefined): number {
  switch (tier) {
    case 1:
      return 0.85
    case 2:
      return 0.65
    default:
      // DECISION: the plan only fixes T1/T2. A 3x15+ set at ~50 % of a 5RM is
      // the conventional GZCLP T3 starting point.
      return 0.5
  }
}

function tierOfKey(lift: string): Tier | undefined {
  const label = lift.includes(':') ? lift.slice(0, lift.indexOf(':')) : ''
  return tierOf({ label })
}

function asWeight(value: WeightValue): Weight {
  return weight(value.value, value.unit)
}

/**
 * Starting weight for `lift` (an `exerciseKey()`, e.g. `'T1:Squat'`) from a
 * known 5RM, rounded to something the athlete can actually load.
 */
export function seedFromFiveRepMax(lift: string, fiveRm: WeightValue, load: LoadContext): GzclpSeedEntry {
  const target = multiply(asWeight(fiveRm), tierFactor(tierOfKey(lift)))
  const rounded = roundWeight(target, roundingContext(load))
  return { weight: { value: rounded.value, unit: rounded.unit }, stage: 1 }
}

/**
 * Same, from a 1RM. Epley (`1RM = w × (1 + reps / 30)`) inverted at five reps —
 * the engine's `calculate1RM` is the forward direction of exactly this.
 */
export function seedFromOneRepMax(lift: string, oneRm: WeightValue, load: LoadContext): GzclpSeedEntry {
  const fiveRm = divide(asWeight(oneRm), 1 + 5 / 30)
  return seedFromFiveRepMax(lift, { value: fiveRm.value, unit: fiveRm.unit }, load)
}

// ---------------------------------------------------------------------------
// Program text with the seeded weights
// ---------------------------------------------------------------------------

function applySeedToGroup(group: SetGroup, entry: GzclpSeedEntry | undefined): void {
  // A percentage is relative to the working weight (warmup-style ramps inside a
  // set variation) and stays meaningful whatever the seed is.
  if (group.weight?.kind === 'percent') return

  if (entry) {
    group.weight = { kind: 'absolute', value: entry.weight.value, unit: entry.weight.unit, loc: group.loc }
    delete group.askWeight
    return
  }

  group.weight = { kind: 'ask', loc: group.loc }
  group.askWeight = true
}

/**
 * The built-in program with every lift's starting weight substituted. Lifts the
 * seed does not mention become `?+`, so the first session asks for the weight.
 */
export function buildGzclpProgram(seed: GzclpSeed, source: string = GZCLP_PROGRAM_SOURCE): string {
  const program = parseOrThrow(source)

  for (const exercise of eachExercise(program)) {
    const entry = seed[exerciseKey(exercise)]
    for (const variation of exercise.setVariations) {
      for (const group of variation) applySeedToGroup(group, entry)
    }
  }

  return serializeProgram(program)
}

// ---------------------------------------------------------------------------
// Initial program state
// ---------------------------------------------------------------------------

function initialStateVars(exercise: ExerciseLine): Record<string, number | WeightValue> {
  const declared = exercise.sections.progress
  if (!declared || declared.kind === 'none') return {}

  const progression = declared.kind === 'custom' ? declared : desugarProgression(declared)
  if (progression.kind !== 'custom') return {}

  const vars: Record<string, number | WeightValue> = {}
  for (const init of progression.stateInit) {
    // A percent literal has no representation in `ExerciseState.state`
    // (`number | WeightValue`); leaving it out is safe because the evaluator
    // re-seeds every state var from the program text before applying the
    // stored ones, so a percent init keeps its declared value.
    if (init.value.type === 'number') vars[init.name] = init.value.value
    else if (init.value.type === 'weight') vars[init.name] = { ...init.value.value }
  }
  return vars
}

function clampStage(stage: number, variations: number): number {
  return Math.min(Math.max(Math.trunc(stage), 1), Math.max(variations, 1))
}

/**
 * The `programState` a fresh profile starts with: one entry per exercise key,
 * carrying the seeded working weight, the stage and the progression's state
 * vars. Unseeded lifts get no weight and `askWeight`.
 */
export function initialProgramState(programSource: string, seed: GzclpSeed): Record<string, ExerciseState> {
  const program = parseOrThrow(programSource)
  const states: Record<string, ExerciseState> = {}

  for (const exercise of eachExercise(program)) {
    const key = exerciseKey(exercise)
    // The same lift on two days shares one progression, so the first line wins.
    if (states[key]) continue

    const entry = seed[key]
    const state: ExerciseState = {
      weights: entry ? [{ ...entry.weight }] : [],
      setVariationIndex: clampStage(entry?.stage ?? 1, exercise.setVariations.length),
      state: initialStateVars(exercise),
    }
    if (!entry) state.askWeight = true

    states[key] = state
  }

  return states
}

// ---------------------------------------------------------------------------
// Rotation and interference
// ---------------------------------------------------------------------------

function wrap(cursor: number, length: number): number {
  return ((Math.trunc(cursor) % length) + length) % length
}

/** The program day a `rotationCursor` points at; wraps in both directions. */
export function programDayAt(cursor: number): GzclpProgramDay {
  return GZCLP_ROTATION[wrap(cursor, GZCLP_ROTATION.length)]
}

/** The cursor after one strength session. */
export function nextCursor(cursor: number): number {
  return wrap(cursor + 1, GZCLP_ROTATION.length)
}

function findDay(program: Program, programDay: string): Day | undefined {
  for (const week of program.weeks) {
    const day = week.days.find((candidate) => candidate.name === programDay)
    if (day) return day
  }
  return undefined
}

function isSquat(name: string): boolean {
  return /squat/i.test(name)
}

function isDeadlift(name: string): boolean {
  return /dead\s*lift/i.test(name)
}

/**
 * Does this day work squat or deadlift at all (T1 or T2)? True for every GZCLP
 * day — see `isHeavyLowerDay` for the distinction the composer actually needs.
 */
export function containsLowerLift(programDay: string, program: Program = gzclpProgram()): boolean {
  const day = findDay(program, programDay)
  if (!day) return false

  return day.exercises.some((exercise) => {
    const tier = tierOf(exercise)
    return (tier === 1 || tier === 2) && (isSquat(exercise.name) || isDeadlift(exercise.name))
  })
}

/**
 * Is this day heavy enough on the legs that a hard cardio session the day
 * before would compromise it? The composer uses this for its interference rules.
 *
 * WHAT THE PROGRAM ACTUALLY SAYS: all four GZCLP days train a squat or a
 * deadlift — A1 = T1 Squat, B1 = T2 Deadlift, A2 = T2 Squat, B2 = T1 Deadlift.
 * So "contains a T1 or T2 squat/deadlift" (that is `containsLowerLift`) is true
 * for A2 as well and would make the interference rule vacuous — it would block
 * every day. The plan's list of heavy days (A1/B1/B2) therefore has to come
 * from a finer rule, and this is the one that reproduces it exactly:
 * a deadlift at ANY tier (it taxes the posterior chain and the CNS even as
 * 3x10 back-off work) or a squat as the day's T1 max-effort lift. A2's squat is
 * T2 volume work under a T1 bench press, which is the one leg day that survives
 * a hard run the evening before.
 */
export function isHeavyLowerDay(programDay: string, program: Program = gzclpProgram()): boolean {
  const day = findDay(program, programDay)
  if (!day) return false

  return day.exercises.some((exercise) => {
    const tier = tierOf(exercise)
    if (isDeadlift(exercise.name)) return tier === 1 || tier === 2
    return tier === 1 && isSquat(exercise.name)
  })
}
