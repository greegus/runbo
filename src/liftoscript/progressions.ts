/**
 * Desugaring of the shorthand progressions into `custom` scripts.
 *
 * One evaluation path is the whole point: `lp` / `dp` / `sum` are rewritten into
 * the equivalent script AST here, so the evaluator, the serializer and the
 * program editor only ever deal with `none` and `custom`.
 *
 * The rewrite builds AST nodes directly instead of generating text and parsing
 * it back — a desugared script can then never fail to parse, and the generated
 * nodes keep the `loc` of the `progress:` section that produced them, so a
 * runtime error still points at a real place in the user's program.
 */

import type {
  AssignOp,
  AssignStmt,
  BinaryExpr,
  BinaryOp,
  CallExpr,
  CustomProgression,
  Day,
  DpProgression,
  Expr,
  ExerciseLine,
  IfStmt,
  IndexExpr,
  Literal,
  Loc,
  LpProgression,
  NoneProgression,
  NumberLiteral,
  Program,
  Progression,
  StateInit,
  Stmt,
  SumProgression,
  VarRef,
  Week,
  WeightExpr,
} from './types'
import { percent, weight } from './weight'

// ---------------------------------------------------------------------------
// AST constructors — every generated node inherits the progression's `loc`
// ---------------------------------------------------------------------------

function number(value: number, loc: Loc): NumberLiteral {
  return { type: 'number', value, loc }
}

/** The literal a shorthand's weight argument stands for inside the script. */
function literalOf(expr: WeightExpr, loc: Loc): Literal {
  switch (expr.kind) {
    case 'absolute':
      return { type: 'weight', value: weight(expr.value, expr.unit), loc }
    case 'percent':
      return { type: 'percent', value: percent(expr.value), loc }
    // `?+` as an increment is meaningless; a zero step keeps the weight put.
    case 'ask':
      return number(0, loc)
  }
}

function bare(name: string, loc: Loc): VarRef {
  return { type: 'var', scope: 'bare', name, loc }
}

function state(name: string, loc: Loc): VarRef {
  return { type: 'var', scope: 'state', name, loc }
}

function at(target: VarRef, oneBasedIndex: number, loc: Loc): IndexExpr {
  return { type: 'index', target, index: number(oneBasedIndex, loc), loc }
}

function call(name: string, args: Expr[], loc: Loc): CallExpr {
  return { type: 'call', name, args, loc }
}

function binary(op: BinaryOp, left: Expr, right: Expr, loc: Loc): BinaryExpr {
  return { type: 'binary', op, left, right, loc }
}

function assign(op: AssignOp, target: VarRef | IndexExpr, value: Expr, loc: Loc): AssignStmt {
  return { type: 'assign', op, target, value, loc }
}

function ifThen(condition: Expr, body: Stmt[], elseBody: Stmt[] | undefined, loc: Loc): IfStmt {
  const node: IfStmt = { type: 'if', branches: [{ condition, body, loc }], loc }
  if (elseBody) node.elseBody = elseBody
  return node
}

function stateInit(name: string, value: number, loc: Loc): StateInit {
  return { name, value: number(value, loc), loc }
}

/** `zeroOrGte(completedReps, reps)` — the one definition of "the session went well". */
function successCondition(loc: Loc): Expr {
  return call('zeroOrGte', [bare('completedReps', loc), bare('reps', loc)], loc)
}

function custom(stateInits: StateInit[], script: Stmt[], loc: Loc): CustomProgression {
  return { kind: 'custom', stateInit: stateInits, script, loc }
}

// ---------------------------------------------------------------------------
// The three shorthands
// ---------------------------------------------------------------------------

/**
 * `lp(inc, successes, successCounter, deload, failures, failureCounter)`:
 *
 * ```
 * custom(successes: <successCounter>, failures: <failureCounter>) {~
 *   if (zeroOrGte(completedReps, reps)) {
 *     state.failures = 0
 *     state.successes += 1
 *     if (state.successes >= <successes>) {
 *       state.successes = 0
 *       weights += <inc>
 *     }
 *   } else {
 *     state.successes = 0
 *     state.failures += 1
 *     if (state.failures >= <failures>) {
 *       state.failures = 0
 *       weights -= <deload>
 *     }
 *   }
 * ~}
 * ```
 *
 * Both counters count CONSECUTIVE outcomes, so each branch clears the other's
 * counter. With `failures` at its default of 0 the deload half is dropped
 * entirely — the else branch then only breaks the success streak.
 */
function desugarLp(progression: LpProgression): CustomProgression {
  const loc = progression.loc
  const { increment, successesRequired, successCounter, deload, failuresRequired, failureCounter } = progression.args
  const deloads = failuresRequired > 0

  const onSuccess: Stmt[] = [
    ...(deloads ? [assign('=', state('failures', loc), number(0, loc), loc)] : []),
    assign('+=', state('successes', loc), number(1, loc), loc),
    ifThen(
      binary('>=', state('successes', loc), number(Math.max(1, successesRequired), loc), loc),
      [
        assign('=', state('successes', loc), number(0, loc), loc),
        assign('+=', bare('weights', loc), literalOf(increment, loc), loc),
      ],
      undefined,
      loc,
    ),
  ]

  const onFailure: Stmt[] = [
    assign('=', state('successes', loc), number(0, loc), loc),
    ...(deloads
      ? [
          assign('+=', state('failures', loc), number(1, loc), loc),
          ifThen(
            binary('>=', state('failures', loc), number(failuresRequired, loc), loc),
            [
              assign('=', state('failures', loc), number(0, loc), loc),
              assign('-=', bare('weights', loc), literalOf(deload, loc), loc),
            ],
            undefined,
            loc,
          ),
        ]
      : []),
  ]

  const inits = [
    stateInit('successes', successCounter, loc),
    ...(deloads ? [stateInit('failures', failureCounter, loc)] : []),
  ]

  return custom(inits, [ifThen(successCondition(loc), onSuccess, onFailure, loc)], loc)
}

/**
 * `dp(inc, minReps, maxReps)`:
 *
 * ```
 * custom() {~
 *   if (zeroOrGte(completedReps, reps)) {
 *     if (reps[1] >= <maxReps>) {
 *       reps = <minReps>
 *       weights += <inc>
 *     } else {
 *       reps += 1
 *     }
 *   }
 * ~}
 * ```
 *
 * The ceiling is read off the first set rather than the whole array: every set
 * of a double-progression group climbs together, and an indexed read is exact
 * even when a program mixes rep counts inside one variation.
 *
 * DECISION: `reps` is a writable script variable but `ExerciseState` has nowhere
 * to keep it, so the rep half only takes effect while a session is being
 * evaluated. Written against a program that already prescribes `maxReps`
 * (`3x10 / progress: dp(2.5kg, 6, 10)`) the weight half works exactly as
 * documented; persisting rep changes needs a field on `ExerciseState` first.
 */
function desugarDp(progression: DpProgression): CustomProgression {
  const loc = progression.loc
  const { increment, minReps, maxReps } = progression.args

  const atCeiling: Stmt[] = [
    assign('=', bare('reps', loc), number(minReps, loc), loc),
    assign('+=', bare('weights', loc), literalOf(increment, loc), loc),
  ]
  const addARep: Stmt[] = [assign('+=', bare('reps', loc), number(1, loc), loc)]

  const body = [ifThen(binary('>=', at(bare('reps', loc), 1, loc), number(maxReps, loc), loc), atCeiling, addARep, loc)]

  return custom([], [ifThen(successCondition(loc), body, undefined, loc)], loc)
}

/**
 * `sum(target, inc)`:
 *
 * ```
 * custom() {~
 *   if (sum(completedReps) >= <target>) {
 *     weights += <inc>
 *   }
 * ~}
 * ```
 *
 * Unlike `lp`/`dp` this ignores the per-set targets — only the total matters,
 * which is what makes it the right shape for AMRAP accessory work.
 */
function desugarSum(progression: SumProgression): CustomProgression {
  const loc = progression.loc
  const { target, increment } = progression.args

  const condition = binary('>=', call('sum', [bare('completedReps', loc)], loc), number(target, loc), loc)
  const body = [assign('+=', bare('weights', loc), literalOf(increment, loc), loc)]

  return custom([], [ifThen(condition, body, undefined, loc)], loc)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rewrites a progression into `custom`.
 *
 * `none` is returned untouched: an empty script and "no progression" behave
 * identically, and keeping the node lets the serializer write `progress: none`
 * back instead of an empty `custom() {~ ~}`. `custom` is returned untouched too,
 * so this is safe to call on an already-desugared program.
 */
export function desugarProgression(progression: Progression): NoneProgression | CustomProgression {
  switch (progression.kind) {
    case 'none':
    case 'custom':
      return progression
    case 'lp':
      return desugarLp(progression)
    case 'dp':
      return desugarDp(progression)
    case 'sum':
      return desugarSum(progression)
  }
}

/**
 * Desugars every exercise in the program, returning a new `Program`.
 *
 * The parser deliberately keeps `lp` / `dp` / `sum` as written so the program
 * editor can show the user their own text back; this runs on the way into the
 * evaluator, which only ever sees `none` and `custom`.
 */
export function desugarProgram(program: Program): Program {
  return {
    weeks: program.weeks.map((week): Week => ({
      ...week,
      days: week.days.map((day): Day => ({
        ...day,
        exercises: day.exercises.map((exercise): ExerciseLine => ({
          ...exercise,
          sections: exercise.sections.progress
            ? { ...exercise.sections, progress: desugarProgression(exercise.sections.progress) }
            : exercise.sections,
        })),
      })),
    })),
  }
}
