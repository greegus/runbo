/**
 * The complete Liftoscript AST and the engine's public API types.
 *
 * This module is the contract between the tokenizer, the parser, the evaluator
 * and the serializer — it contains declarations only, never logic.
 *
 * Two conventions run through the whole engine:
 * - every node carries a `loc` so any failure can be reported with line/column;
 * - set arrays are 1-INDEXED at the script boundary (`completedReps[1]` is the
 *   first set). TS arrays inside the engine stay 0-indexed; the evaluator
 *   converts only when a script reads or writes an index.
 */

import type { ExerciseState, SetLog, WeightValue } from '@/types'

import type { Diagnostic } from './diagnostics'
import type { Percent, Plate, Unit, Weight } from './weight'

/** Source position, both 1-based (line 1, column 1 is the first character). */
export interface Loc {
  line: number
  col: number
}

// ---------------------------------------------------------------------------
// Program structure
// ---------------------------------------------------------------------------

/** A parsed program: the whole `programText` of a strength track. */
export interface Program {
  weeks: Week[]
}

/** `# Week 1` and everything until the next week header. */
export interface Week {
  name: string
  days: Day[]
  loc: Loc
}

/** `## A1` and everything until the next day or week header. */
export interface Day {
  name: string
  exercises: ExerciseLine[]
  loc: Loc
}

/**
 * One exercise line, e.g.
 * `T1: Squat, Barbell / 5x3+ / 6x2+ / 100kg / warmup: … / progress: …`
 *
 * `setVariations` holds one entry per consecutive set-spec segment; the active
 * one is `ExerciseState.setVariationIndex` (1-based). A standalone weight
 * segment (`/ 100kg /`, `/ ?+ /`) is not a variation: the parser applies it to
 * every set group of every variation that has no weight of its own.
 */
export interface ExerciseLine {
  label?: string // 'T1' | 'T2' | 'T3' — drives rest-timer and warmup defaults
  name: string // exercise name as written; also the key into `programState`
  equipment?: string // the part after the comma, e.g. 'Barbell'
  description?: string // joined `//` comment lines directly above this line
  setVariations: SetGroup[][]
  sections: Sections
  loc: Loc
}

/**
 * One comma-separated set group: `5x3+ 100kg @8+ 60s|30s (Top set)`.
 *
 * `reps` is the number written first; `maxReps` is only set for a range
 * (`8-12` → `reps: 8, maxReps: 12`). The prescription layer targets
 * `maxReps ?? reps` and reports `reps` as the range minimum.
 *
 * `duration`, `distance` and `zone` are the runbo cardio extension and are
 * mutually exclusive with `reps` being meaningful (`count` may be absent for a
 * single continuous effort, in which case it is 1).
 */
export interface SetGroup {
  count: number // number of sets in this group
  reps: number
  maxReps?: number
  isAmrap: boolean // trailing '+'
  weight?: WeightExpr
  rpe?: number
  rpeLog?: boolean // '@8+' — ask the user to log the actual RPE
  askWeight?: boolean // '?+' — prompt for the weight before the first set
  setTimerSec?: number // left side of `60s|30s`
  restTimerSec?: number // right side of `60s|30s`; undefined for '?'
  label?: string // '(Top set)'
  duration?: number // cardio: seconds of work per set ('3min' → 180)
  distance?: { value: number; unit: 'm' | 'km' } // cardio: '100m', '5km'
  zone?: 1 | 2 | 3 | 4 | 5 // cardio: '@Z2'
  loc: Loc
}

/** The weight written on a set group or as a standalone segment. */
export type WeightExpr =
  | { kind: 'absolute'; value: number; unit: Unit; loc: Loc } // '100kg'
  | { kind: 'percent'; value: number; loc: Loc } // '75%' — of the working weight
  | { kind: 'ask'; loc: Loc } // '?+' — unknown until the user enters it

/** One warmup set from the `warmup:` section: `1x3 55%`. */
export interface WarmupSet {
  count: number
  reps: number
  weight: WeightExpr
  loc: Loc
}

/** The `/ key: value /` segments of an exercise line. */
export interface Sections {
  progress?: Progression
  warmup?: WarmupSet[] | 'none' // 'none' disables the auto-generated warmup
  restSec?: number // `rest: 2min` — cardio extension, rest between set groups
  tags?: number[] // `id: tags(1, 2)`
  usedNone?: boolean // `used: none` — exercise does not consume program state
}

// ---------------------------------------------------------------------------
// Progressions
// ---------------------------------------------------------------------------

/** `progress: none` — the weight never changes on its own. */
export interface NoneProgression {
  kind: 'none'
  loc: Loc
}

/**
 * `lp(inc)` / `lp(inc, successes, successCounter, deload, failures, failureCounter)`.
 * Defaults: successes 1, counters 0, deload 0, failures 0 (never deload).
 */
export interface LpProgression {
  kind: 'lp'
  args: {
    increment: WeightExpr
    successesRequired: number
    successCounter: number
    deload: WeightExpr
    failuresRequired: number
    failureCounter: number
  }
  loc: Loc
}

/** `dp(inc, minReps, maxReps)` — add a rep up to `maxReps`, then add weight and reset. */
export interface DpProgression {
  kind: 'dp'
  args: {
    increment: WeightExpr
    minReps: number
    maxReps: number
  }
  loc: Loc
}

/** `sum(target, inc)` — total completed reps across all sets reaches `target`. */
export interface SumProgression {
  kind: 'sum'
  args: {
    target: number
    increment: WeightExpr
  }
  loc: Loc
}

/** `custom(inc: 5kg, resetFactor: 0.85) {~ … ~}` — the single evaluation path. */
export interface CustomProgression {
  kind: 'custom'
  stateInit: StateInit[]
  script: Stmt[]
  loc: Loc
}

/**
 * The parser emits `lp` / `dp` / `sum` as parsed; `progressions.ts` desugars them
 * into `custom` before evaluation, so the evaluator only ever sees
 * `NoneProgression | CustomProgression`.
 */
export type Progression = NoneProgression | LpProgression | DpProgression | SumProgression | CustomProgression

/** One `name: literal` pair inside `custom(...)`, seeding `state.name`. */
export interface StateInit {
  name: string
  value: Literal
  loc: Loc
}

// ---------------------------------------------------------------------------
// Script language (inside `{~ ~}`)
// ---------------------------------------------------------------------------

export type AssignOp = '=' | '+=' | '-=' | '*=' | '/='

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '>' | '<' | '>=' | '<=' | '==' | '!=' | '&&' | '||'

export type UnaryOp = '-' | '!'

/**
 * `weights += 5kg` (bare target — applies to every set) or
 * `weights[2] = 100kg` (indexed — one set, 1-based).
 */
export interface AssignStmt {
  type: 'assign'
  op: AssignOp
  target: VarRef | IndexExpr
  value: Expr
  loc: Loc
}

/** `if (…) { … } else if (…) { … } else { … }` — `branches[0]` is the `if`. */
export interface IfStmt {
  type: 'if'
  branches: { condition: Expr; body: Stmt[]; loc: Loc }[]
  elseBody?: Stmt[]
  loc: Loc
}

/** `for (var.i in completedReps) { … }` — `variable` is always a `var.*` reference. */
export interface ForInStmt {
  type: 'forIn'
  variable: VarRef
  iterable: Expr
  body: Stmt[]
  loc: Loc
}

/** A bare expression statement — only meaningful for a ternary with side effects. */
export interface ExprStmt {
  type: 'expr'
  expression: Expr
  loc: Loc
}

export type Stmt = AssignStmt | IfStmt | ForInStmt | ExprStmt

export interface NumberLiteral {
  type: 'number'
  value: number
  loc: Loc
}

export interface WeightLiteral {
  type: 'weight'
  value: Weight
  loc: Loc
}

export interface PercentLiteral {
  type: 'percent'
  value: Percent
  loc: Loc
}

export type Literal = NumberLiteral | WeightLiteral | PercentLiteral

/**
 * Where a name lives:
 * - `bare`   — a program variable (`weights`, `week`, `numberOfSets`, …)
 * - `state`  — `state.x`, persisted in `ExerciseState.state` between sessions
 * - `var`    — `var.x`, scratch, discarded when the script finishes
 */
export type VarScope = 'bare' | 'state' | 'var'

export interface VarRef {
  type: 'var'
  scope: VarScope
  name: string
  loc: Loc
}

/** `completedReps[1]`, `weights[var.i]` — the index is 1-based in the script. */
export interface IndexExpr {
  type: 'index'
  target: VarRef
  index: Expr
  loc: Loc
}

export interface UnaryExpr {
  type: 'unary'
  op: UnaryOp
  operand: Expr
  loc: Loc
}

export interface BinaryExpr {
  type: 'binary'
  op: BinaryOp
  left: Expr
  right: Expr
  loc: Loc
}

export interface TernaryExpr {
  type: 'ternary'
  condition: Expr
  ifTrue: Expr
  ifFalse: Expr
  loc: Loc
}

/** `roundWeight(weights[1] * 0.85)` — `name` is one of `BUILTIN_FUNCTIONS`. */
export interface CallExpr {
  type: 'call'
  name: string
  args: Expr[]
  loc: Loc
}

export type Expr = Literal | VarRef | IndexExpr | UnaryExpr | BinaryExpr | TernaryExpr | CallExpr

/**
 * A value a script expression can produce. Arrays are the per-set variables;
 * a comparison against a whole array means "every element satisfies it".
 */
export type ScriptScalar = number | Weight | Percent
export type ScriptValue = ScriptScalar | ScriptScalar[]

/** Names a script may read. `weights` and friends are arrays, 1-indexed in script. */
export const READONLY_VARS = [
  'weights',
  'completedWeights',
  'reps',
  'completedReps',
  'RPE',
  'completedRPE',
  'amraps',
  'numberOfSets',
  'setVariationIndex',
  'week',
  'day',
  'rm1',
  'bodyweight',
] as const

/** Names a script may assign to. Everything else is a diagnostic. */
export const WRITABLE_VARS = ['weights', 'reps', 'minReps', 'RPE', 'timers', 'setVariationIndex', 'rm1'] as const

/** Bare names that hold a per-set array and therefore accept `[n]`. */
export const ARRAY_VARS = [
  'weights',
  'completedWeights',
  'reps',
  'minReps',
  'completedReps',
  'RPE',
  'completedRPE',
  'amraps',
  'timers',
] as const

export const BUILTIN_FUNCTIONS = [
  'floor',
  'ceil',
  'round',
  'sum',
  'min',
  'max',
  'increment',
  'decrement',
  'roundWeight',
  'calculate1RM',
  'zeroOrGte',
  'rpeMultiplier',
] as const

export type ReadonlyVarName = (typeof READONLY_VARS)[number]
export type WritableVarName = (typeof WRITABLE_VARS)[number]
export type ArrayVarName = (typeof ARRAY_VARS)[number]
export type BuiltinName = (typeof BUILTIN_FUNCTIONS)[number]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Everything the engine needs about the athlete and the current slot in the
 * program. Never derived from the clock inside the engine — the caller passes
 * `week` and `day` in.
 */
export interface EvalContext {
  units: Unit
  plates: Plate[] // per side, from `Profile.settings.plates`
  barbellWeight: number // in `units`
  week: number // 1-based index into `Program.weeks`
  day: number // 1-based index into the week's days
  bodyweight?: WeightValue
}

/** What the user logged for one exercise, in set order (0-indexed TS array). */
export type SessionLog = SetLog[]

/** `parseProgram` never throws: a broken program comes back with diagnostics. */
export interface ParseResult {
  program: Program
  diagnostics: Diagnostic[]
}

/** One set as the session screen shows it. */
export interface PrescribedSet {
  reps: number // the target: `SetGroup.maxReps ?? SetGroup.reps`
  minReps?: number // only for a range — `SetGroup.reps`
  isAmrap: boolean
  weight: WeightValue
  askWeight?: boolean // weight unknown; prompt before the first set
  rpe?: number
  timerSec?: number // set timer, for timed sets
  restTimerSec?: number // explicit rest from the program text; wins over defaults
  label?: string
}

/** One generated or declared warmup set. */
export interface WarmupPrescription {
  reps: number
  weight: WeightValue
}

export interface PrescribeResult {
  sets: PrescribedSet[]
  warmup: WarmupPrescription[]
  /** Empty on success — a missing exercise or a broken script never throws. */
  diagnostics: Diagnostic[]
}

/** The result of running a finished session through the progression script. */
export interface EvaluateResult {
  nextState: ExerciseState
  summary: string // 'Squat: 5x3+ -> 6x2+, weight held at 100 kg'
  /** Empty on success; on a runtime failure the state comes back unchanged. */
  diagnostics: Diagnostic[]
}
