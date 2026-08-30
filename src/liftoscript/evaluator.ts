/**
 * Runs a program: what to do next (`prescribe`) and what a finished session
 * changes (`evaluateSession`).
 *
 * The interpreter is deliberately small. Two rules explain most of it:
 * - set arrays are 1-INDEXED at the script boundary and 0-indexed everywhere
 *   inside, so exactly one `- 1` exists per read and per write;
 * - a bare array target (`weights += 5kg`) means "every set", an indexed one
 *   means "that set", and a comparison against a whole array means "every
 *   element satisfies it".
 *
 * Neither public entry point throws: a runtime failure comes back as a
 * diagnostic with the offending node's position and the state is left untouched,
 * because half-applied progression is worse than no progression.
 */

import type { ExerciseState, SetLog, WeightValue } from '@/types'

import { callBuiltin, compareScalars, isBuiltin } from './builtins'
import { createDiagnostic } from './diagnostics'
import { desugarProgression } from './progressions'
import {
  ARRAY_VARS,
  WRITABLE_VARS,
  type AssignOp,
  type BinaryOp,
  type CustomProgression,
  type Day,
  type EvalContext,
  type EvaluateResult,
  type Expr,
  type ExerciseLine,
  type Loc,
  type NoneProgression,
  type PrescribeResult,
  type PrescribedSet,
  type Program,
  type ScriptScalar,
  type ScriptValue,
  type SessionLog,
  type SetGroup,
  type Stmt,
  type WarmupPrescription,
  type WeightExpr,
} from './types'
import {
  add,
  applyPercent,
  calculate1RM,
  convert,
  divide,
  format,
  isPercent,
  isWeight,
  multiply,
  percent,
  ratio,
  roundWeight,
  subtract,
  weight,
  type Percent,
  type Weight,
} from './weight'

/** The mutable environment a script runs in; exposed for unit tests. */
export interface ScriptScope {
  /** Bare program variables, 0-indexed here — the 1-index shift happens at the boundary. */
  vars: Record<string, ScriptValue>
  /** `state.x`, persisted into `ExerciseState.state`. */
  state: Record<string, ScriptValue>
  /** `var.x`, discarded when the script finishes. */
  locals: Record<string, ScriptValue>
}

interface Env {
  scope: ScriptScope
  ctx: EvalContext
}

/** A runtime failure that knows where in the script it happened. */
class ScriptError extends Error {
  loc: Loc

  constructor(message: string, loc: Loc) {
    super(message)
    this.name = 'ScriptError'
    this.loc = loc
  }
}

const ORIGIN: Loc = { line: 1, col: 1 }

const ARRAY_VAR_SET = new Set<string>(ARRAY_VARS)
const WRITABLE_VAR_SET = new Set<string>(WRITABLE_VARS)

/** Bare variables whose elements are weights; anything else holds plain numbers. */
const WEIGHT_VAR_SET = new Set<string>(['weights', 'completedWeights', 'rm1', 'bodyweight'])

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

function isArray(value: ScriptValue): value is ScriptScalar[] {
  return Array.isArray(value)
}

function asWeightValue(value: WeightValue): Weight {
  return weight(value.value, value.unit)
}

function rm1Of(env: Env): Weight {
  const current = env.scope.vars.rm1
  if (isWeight(current)) return current
  if (typeof current === 'number') return weight(current, env.ctx.units)
  return weight(0, env.ctx.units)
}

/** A bare percentage is a percentage of the training max — that is what `rm1` is for. */
function resolvePercent(value: Percent, env: Env): Weight {
  return applyPercent(rm1Of(env), value)
}

function truthy(value: ScriptValue): boolean {
  if (isArray(value)) return value.length > 0 && value.every(truthy)
  if (typeof value === 'number') return value !== 0
  return value.value !== 0
}

function numberOp(op: BinaryOp, a: number, b: number, loc: Loc): number {
  switch (op) {
    case '+':
      return a + b
    case '-':
      return a - b
    case '*':
      return a * b
    case '/':
      if (b === 0) throw new ScriptError('division by zero', loc)
      return a / b
    case '%':
      if (b === 0) throw new ScriptError('division by zero', loc)
      return a % b
    default:
      throw new ScriptError(`operator ${op} cannot be used here`, loc)
  }
}

function arithmetic(op: BinaryOp, a: ScriptScalar, b: ScriptScalar, env: Env, loc: Loc): ScriptScalar {
  // `weights[1] * 85%` is a proportion of that weight, not of the training max.
  if (op === '*' && isWeight(a) && isPercent(b)) return applyPercent(a, b)
  if (op === '*' && isPercent(a) && isWeight(b)) return applyPercent(b, a)

  const left = isPercent(a) && isWeight(b) ? resolvePercent(a, env) : a
  const right = isPercent(b) && isWeight(left) ? resolvePercent(b, env) : b

  if (isPercent(left) || isPercent(right)) {
    const leftValue = isPercent(left) ? left.value : left
    const rightValue = isPercent(right) ? right.value : right
    if (typeof leftValue !== 'number' || typeof rightValue !== 'number') {
      throw new ScriptError(`cannot apply ${op} to these values`, loc)
    }
    return percent(numberOp(op, leftValue, rightValue, loc))
  }

  if (isWeight(left) && isWeight(right)) {
    switch (op) {
      case '+':
        return add(left, right)
      case '-':
        return subtract(left, right)
      case '/':
        return ratio(left, right)
      case '%':
        return weight(numberOp('%', left.value, convert(right, left.unit).value, loc), left.unit)
      default:
        throw new ScriptError(`cannot apply ${op} to two weights`, loc)
    }
  }

  if (isWeight(left) && typeof right === 'number') {
    switch (op) {
      case '*':
        return multiply(left, right)
      case '/':
        if (right === 0) throw new ScriptError('division by zero', loc)
        return divide(left, right)
      default:
        return arithmetic(op, left, weight(right, left.unit), env, loc)
    }
  }

  if (typeof left === 'number' && isWeight(right)) {
    if (op === '*') return multiply(right, left)
    return arithmetic(op, weight(left, right.unit), right, env, loc)
  }

  if (typeof left === 'number' && typeof right === 'number') return numberOp(op, left, right, loc)

  throw new ScriptError(`cannot apply ${op} to these values`, loc)
}

function comparison(op: BinaryOp, a: ScriptScalar, b: ScriptScalar, env: Env, loc: Loc): boolean {
  const left = isPercent(a) && isWeight(b) ? resolvePercent(a, env) : a
  const right = isPercent(b) && isWeight(left) ? resolvePercent(b, env) : b

  let order: -1 | 0 | 1
  try {
    order = compareScalars(left, right)
  } catch (error) {
    throw new ScriptError(error instanceof Error ? error.message : String(error), loc)
  }

  switch (op) {
    case '>':
      return order > 0
    case '<':
      return order < 0
    case '>=':
      return order >= 0
    case '<=':
      return order <= 0
    case '==':
      return order === 0
    case '!=':
      return order !== 0
    default:
      throw new ScriptError(`${op} is not a comparison`, loc)
  }
}

const COMPARISONS = new Set<BinaryOp>(['>', '<', '>=', '<=', '==', '!='])

/**
 * Broadcasts an operator over arrays. A comparison collapses to a single
 * true/false ("every element satisfies it"); arithmetic stays element-wise.
 */
function binaryValues(op: BinaryOp, left: ScriptValue, right: ScriptValue, env: Env, loc: Loc): ScriptValue {
  const length = isArray(left)
    ? isArray(right)
      ? Math.min(left.length, right.length)
      : left.length
    : isArray(right)
      ? right.length
      : -1

  if (COMPARISONS.has(op)) {
    if (length < 0) return comparison(op, left as ScriptScalar, right as ScriptScalar, env, loc) ? 1 : 0
    for (let index = 0; index < length; index++) {
      const a = isArray(left) ? left[index] : left
      const b = isArray(right) ? right[index] : right
      if (!comparison(op, a, b, env, loc)) return 0
    }
    return 1
  }

  if (length < 0) return arithmetic(op, left as ScriptScalar, right as ScriptScalar, env, loc)

  const result: ScriptScalar[] = []
  for (let index = 0; index < length; index++) {
    const a = isArray(left) ? left[index] : left
    const b = isArray(right) ? right[index] : right
    result.push(arithmetic(op, a, b, env, loc))
  }
  return result
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

function readVar(expr: Extract<Expr, { type: 'var' }>, env: Env): ScriptValue {
  const bag = expr.scope === 'state' ? env.scope.state : expr.scope === 'var' ? env.scope.locals : env.scope.vars
  const value = bag[expr.name]
  if (value === undefined) {
    const prefix = expr.scope === 'bare' ? '' : `${expr.scope}.`
    throw new ScriptError(`unknown variable ${prefix}${expr.name}`, expr.loc)
  }
  return value
}

function indexOf(expr: Expr, env: Env, loc: Loc): number {
  const value = evalExpr(expr, env)
  if (typeof value !== 'number') throw new ScriptError('an index must be a number', loc)
  const index = Math.round(value)
  if (index < 1) throw new ScriptError(`index ${String(index)} is out of range — sets are 1-indexed`, loc)
  return index - 1
}

function evalExpr(expr: Expr, env: Env): ScriptValue {
  switch (expr.type) {
    case 'number':
    case 'weight':
    case 'percent':
      return expr.value

    case 'var':
      return readVar(expr, env)

    case 'index': {
      const target = readVar(expr.target, env)
      if (!isArray(target)) throw new ScriptError(`${expr.target.name} is not a per-set list`, expr.loc)
      const index = indexOf(expr.index, env, expr.loc)
      const value = target[index]
      if (value === undefined) {
        throw new ScriptError(`${expr.target.name}[${String(index + 1)}] does not exist`, expr.loc)
      }
      return value
    }

    case 'unary': {
      const operand = evalExpr(expr.operand, env)
      if (expr.op === '!') return truthy(operand) ? 0 : 1
      if (isArray(operand)) return operand.map((item) => arithmetic('*', item, -1, env, expr.loc))
      return arithmetic('*', operand, -1, env, expr.loc)
    }

    case 'binary': {
      if (expr.op === '&&') {
        const left = evalExpr(expr.left, env)
        if (!truthy(left)) return 0
        return truthy(evalExpr(expr.right, env)) ? 1 : 0
      }
      if (expr.op === '||') {
        const left = evalExpr(expr.left, env)
        if (truthy(left)) return 1
        return truthy(evalExpr(expr.right, env)) ? 1 : 0
      }
      return binaryValues(expr.op, evalExpr(expr.left, env), evalExpr(expr.right, env), env, expr.loc)
    }

    case 'ternary':
      return truthy(evalExpr(expr.condition, env)) ? evalExpr(expr.ifTrue, env) : evalExpr(expr.ifFalse, env)

    case 'call': {
      if (!isBuiltin(expr.name)) throw new ScriptError(`unknown function ${expr.name}()`, expr.loc)
      const args = expr.args.map((arg) => evalExpr(arg, env))
      try {
        return callBuiltin(expr.name, args, env.ctx)
      } catch (error) {
        throw new ScriptError(error instanceof Error ? error.message : String(error), expr.loc)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

/** Coerces a written value to what the target variable holds. */
function coerceWrite(name: string, value: ScriptScalar, env: Env, loc: Loc): ScriptScalar {
  if (WEIGHT_VAR_SET.has(name)) {
    if (isWeight(value)) return value
    if (isPercent(value)) return resolvePercent(value, env)
    return weight(value, env.ctx.units)
  }
  if (isWeight(value)) throw new ScriptError(`${name} holds numbers, not weights`, loc)
  if (isPercent(value)) return value.value
  return value
}

function applyOp(op: AssignOp, current: ScriptValue, value: ScriptValue, env: Env, loc: Loc): ScriptValue {
  if (op === '=') return value
  const binaryOp = op.slice(0, 1) as BinaryOp
  return binaryValues(binaryOp, current, value, env, loc)
}

function assignBare(name: string, op: AssignOp, value: ScriptValue, env: Env, loc: Loc): void {
  if (!WRITABLE_VAR_SET.has(name)) throw new ScriptError(`${name} is read-only`, loc)

  const current = env.scope.vars[name]
  if (current === undefined) throw new ScriptError(`unknown variable ${name}`, loc)

  if (!isArray(current)) {
    const next = applyOp(op, current, value, env, loc)
    if (isArray(next)) throw new ScriptError(`${name} holds a single value`, loc)
    env.scope.vars[name] = coerceWrite(name, next, env, loc)
    return
  }

  // A bare target means every set — an array on the right replaces the list,
  // a single value is written into each slot.
  if (op === '=' && isArray(value)) {
    env.scope.vars[name] = value.map((item) => coerceWrite(name, item, env, loc))
    return
  }

  env.scope.vars[name] = current.map((element, index) => {
    const operand = isArray(value) ? value[index] : value
    if (operand === undefined) return element
    const next = applyOp(op, element, operand, env, loc)
    if (isArray(next)) throw new ScriptError(`${name}[${String(index + 1)}] holds a single value`, loc)
    return coerceWrite(name, next, env, loc)
  })
}

function assignScoped(
  bag: Record<string, ScriptValue>,
  scope: 'state' | 'var',
  name: string,
  op: AssignOp,
  value: ScriptValue,
  env: Env,
  loc: Loc,
): void {
  const current = bag[name]
  if (op === '=') {
    bag[name] = value
    return
  }
  if (current === undefined) throw new ScriptError(`unknown variable ${scope}.${name}`, loc)
  bag[name] = applyOp(op, current, value, env, loc)
}

function execAssign(stmt: Extract<Stmt, { type: 'assign' }>, env: Env): void {
  const value = evalExpr(stmt.value, env)

  if (stmt.target.type === 'var') {
    if (stmt.target.scope === 'state') {
      assignScoped(env.scope.state, 'state', stmt.target.name, stmt.op, value, env, stmt.loc)
      return
    }
    if (stmt.target.scope === 'var') {
      assignScoped(env.scope.locals, 'var', stmt.target.name, stmt.op, value, env, stmt.loc)
      return
    }
    assignBare(stmt.target.name, stmt.op, value, env, stmt.loc)
    return
  }

  const name = stmt.target.target.name
  if (stmt.target.target.scope !== 'bare') throw new ScriptError(`${name} cannot be indexed`, stmt.loc)
  if (!WRITABLE_VAR_SET.has(name) || !ARRAY_VAR_SET.has(name)) {
    throw new ScriptError(`${name} is read-only`, stmt.loc)
  }

  const current = env.scope.vars[name]
  if (!isArray(current)) throw new ScriptError(`${name} is not a per-set list`, stmt.loc)

  const index = indexOf(stmt.target.index, env, stmt.loc)
  const element = current[index]
  if (element === undefined) throw new ScriptError(`${name}[${String(index + 1)}] does not exist`, stmt.loc)

  const next = applyOp(stmt.op, element, value, env, stmt.loc)
  if (isArray(next)) throw new ScriptError(`${name}[${String(index + 1)}] holds a single value`, stmt.loc)
  current[index] = coerceWrite(name, next, env, stmt.loc)
}

function execStmt(stmt: Stmt, env: Env): void {
  switch (stmt.type) {
    case 'assign':
      execAssign(stmt, env)
      return

    case 'if': {
      for (const branch of stmt.branches) {
        if (truthy(evalExpr(branch.condition, env))) {
          execStmts(branch.body, env)
          return
        }
      }
      if (stmt.elseBody) execStmts(stmt.elseBody, env)
      return
    }

    case 'forIn': {
      const iterable = evalExpr(stmt.iterable, env)
      if (!isArray(iterable)) throw new ScriptError('only a per-set list can be iterated', stmt.loc)
      if (stmt.variable.scope !== 'var') throw new ScriptError('a loop variable must be a var.* name', stmt.loc)
      // Liftoscript iterates the 1-based INDEXES, so the body indexes the arrays itself.
      for (let index = 1; index <= iterable.length; index++) {
        env.scope.locals[stmt.variable.name] = index
        execStmts(stmt.body, env)
      }
      return
    }

    case 'expr':
      evalExpr(stmt.expression, env)
      return
  }
}

function execStmts(stmts: Stmt[], env: Env): void {
  for (const stmt of stmts) execStmt(stmt, env)
}

/** Executes statements against a scope, mutating it in place. Exposed for tests. */
export function runScript(script: Stmt[], scope: ScriptScope, ctx: EvalContext): ScriptScope {
  execStmts(script, { scope, ctx })
  return scope
}

// ---------------------------------------------------------------------------
// Program lookup and weight resolution
// ---------------------------------------------------------------------------

/**
 * The key an exercise's state is stored under in `Profile.strengthTrack.programState`.
 *
 * The label matters: GZCLP runs Squat as T1 on day A1 and as T2 on day A2, and those are two
 * independent progressions with their own weight and stage. Keying by name alone would make them
 * overwrite each other. Two lines that share a label and a name (the same lift programmed on two
 * days) intentionally share one state, which is how the same lift keeps one progression.
 *
 * Accepts either a parsed line or an already-split `{ label, name }`, so callers holding only a
 * logged session entry can rebuild the key without re-parsing the program.
 */
export function exerciseKey(exercise: { label?: string; name: string }): string {
  // The label is upper-cased because Liftosaur's own programs write `t1:` while
  // ours writes `T1:`, and the two must be one key: a lowercase `t1:Squat`
  // arriving from an imported program would otherwise miss the built-in's
  // `T1:Squat` and land as a lift with no weight — silently, since a missing key
  // reads as "never entered" rather than as an error.
  return exercise.label ? `${exercise.label.toUpperCase()}:${exercise.name}` : exercise.name
}

/**
 * Finds the line an exercise key refers to. The day in `ctx` wins when the same key sits on
 * several days, so a lookup during a session resolves to the line actually being trained.
 */
function findExercise(program: Program, exerciseName: string, ctx: EvalContext): ExerciseLine | undefined {
  const matches = (exercise: ExerciseLine) => exercise.name === exerciseName || exerciseKey(exercise) === exerciseName

  const days: Day[] = program.weeks[ctx.week - 1]?.days ?? []
  const onSlot = days[ctx.day - 1]?.exercises.find(matches)
  if (onSlot) return onSlot

  for (const week of program.weeks) {
    for (const day of week.days) {
      const found = day.exercises.find(matches)
      if (found) return found
    }
  }
  return undefined
}

function variationOf(exercise: ExerciseLine, index: number): SetGroup[] {
  if (exercise.setVariations.length === 0) return []
  const clamped = Math.min(Math.max(index, 1), exercise.setVariations.length)
  return exercise.setVariations[clamped - 1]
}

/** The weight the athlete is currently working with, as stored between sessions. */
function workingWeight(exerciseState: ExerciseState, groups: SetGroup[]): Weight | undefined {
  const stored = exerciseState.weights[exerciseState.setVariationIndex - 1] ?? exerciseState.weights.at(-1)
  if (stored) return asWeightValue(stored)

  const written = groups.find((group) => group.weight?.kind === 'absolute')?.weight
  if (written && written.kind === 'absolute') return weight(written.value, written.unit)
  return undefined
}

interface ResolvedWeight {
  weight: Weight
  askWeight?: boolean
}

function resolveWeightExpr(
  expr: WeightExpr | undefined,
  working: Weight | undefined,
  ctx: EvalContext,
): ResolvedWeight {
  if (!expr) {
    if (!working) return { weight: weight(0, ctx.units), askWeight: true }
    return { weight: roundWeight(working, ctx) }
  }

  switch (expr.kind) {
    case 'absolute':
      return { weight: roundWeight(weight(expr.value, expr.unit), ctx) }

    case 'percent': {
      if (!working) return { weight: weight(0, ctx.units), askWeight: true }
      return { weight: roundWeight(applyPercent(working, percent(expr.value)), ctx) }
    }

    case 'ask':
      if (!working) return { weight: weight(0, ctx.units), askWeight: true }
      return { weight: roundWeight(working, ctx), askWeight: true }
  }
}

function tierOf(exercise: ExerciseLine): 1 | 2 | 3 | undefined {
  const label = exercise.label?.toUpperCase()
  if (label === 'T1') return 1
  if (label === 'T2') return 2
  if (label === 'T3') return 3
  return undefined
}

/** The house ramp: empty bar, then two ascending singles-free sets under the work weight. */
function defaultWarmup(working: Weight | undefined, ctx: EvalContext): WarmupPrescription[] {
  const bar: WarmupPrescription = { reps: 5, weight: weight(ctx.barbellWeight, ctx.units) }
  if (!working) return [bar]

  const sets = [bar]
  for (const [reps, factor] of [
    [3, 0.55],
    [2, 0.75],
  ] as const) {
    const target = roundWeight(multiply(working, factor), ctx)
    if (target.value > ctx.barbellWeight) sets.push({ reps, weight: target })
  }
  return sets
}

function buildWarmup(exercise: ExerciseLine, working: Weight | undefined, ctx: EvalContext): WarmupPrescription[] {
  const declared = exercise.sections.warmup
  if (declared === 'none') return []

  if (Array.isArray(declared)) {
    const sets: WarmupPrescription[] = []
    for (const entry of declared) {
      const resolved = resolveWeightExpr(entry.weight, working, ctx)
      for (let index = 0; index < entry.count; index++) sets.push({ reps: entry.reps, weight: resolved.weight })
    }
    return sets
  }

  const tier = tierOf(exercise)
  return tier === 1 || tier === 2 ? defaultWarmup(working, ctx) : []
}

/**
 * Builds the prescription for the exercise's NEXT session.
 */
export function prescribe(
  program: Program,
  exerciseName: string,
  exerciseState: ExerciseState,
  ctx: EvalContext,
): PrescribeResult {
  const exercise = findExercise(program, exerciseName, ctx)
  if (!exercise) {
    return {
      sets: [],
      warmup: [],
      diagnostics: [createDiagnostic(`Exercise "${exerciseName}" is not in the program.`, ORIGIN, '')],
    }
  }

  const groups = variationOf(exercise, exerciseState.setVariationIndex)
  const working = workingWeight(exerciseState, groups)
  const askAll = exerciseState.askWeight === true
  // A weight written in the program text is only the SEED for this exercise:
  // once the state carries a working weight (the progression has run at least
  // once, or onboarding adopted one), that weight wins — otherwise every
  // session would be prescribed at the program's starting number forever.
  const stored = exerciseState.weights.length > 0

  const sets: PrescribedSet[] = []
  for (const group of groups) {
    const declared = stored && group.weight?.kind === 'absolute' ? undefined : group.weight
    const resolved = resolveWeightExpr(declared, working, ctx)
    const ask = resolved.askWeight === true || askAll
    for (let index = 0; index < group.count; index++) {
      sets.push({
        reps: group.maxReps ?? group.reps,
        ...(group.maxReps === undefined ? {} : { minReps: group.reps }),
        // The trailing '+' marks the group's LAST set as the AMRAP one (GZCLP's
        // `5x3+` is four straight sets plus one max-rep set) — the group-level
        // flag stays as written so the serializer can print `5x3+` back.
        isAmrap: group.isAmrap && index === group.count - 1,
        weight: { value: resolved.weight.value, unit: resolved.weight.unit },
        ...(ask ? { askWeight: true } : {}),
        ...(group.rpe === undefined ? {} : { rpe: group.rpe }),
        ...(group.setTimerSec === undefined ? {} : { timerSec: group.setTimerSec }),
        ...(group.restTimerSec === undefined ? {} : { restTimerSec: group.restTimerSec }),
        ...(group.label === undefined ? {} : { label: group.label }),
      })
    }
  }

  return { sets, warmup: buildWarmup(exercise, working, ctx), diagnostics: [] }
}

// ---------------------------------------------------------------------------
// Session evaluation
// ---------------------------------------------------------------------------

/** Best Epley estimate the session produced; percentages in scripts resolve against it. */
function estimate1RM(sessionLog: SessionLog, fallback: Weight | undefined, ctx: EvalContext): Weight {
  let best: Weight | undefined
  for (const set of sessionLog) {
    if (!set.completedReps) continue
    const candidate = calculate1RM(asWeightValue(set.weight), set.completedReps)
    if (!best || compareScalars(candidate, best) > 0) best = candidate
  }
  return best ?? fallback ?? weight(0, ctx.units)
}

function buildScope(
  exercise: ExerciseLine,
  exerciseState: ExerciseState,
  sessionLog: SessionLog,
  ctx: EvalContext,
  desugared?: NoneProgression | CustomProgression,
): ScriptScope {
  const groups = variationOf(exercise, exerciseState.setVariationIndex)
  const working = workingWeight(exerciseState, groups)

  const logged: SetLog[] = sessionLog
  const weights = logged.map((set) => asWeightValue(set.weight))
  const fallbackWeights = exerciseState.weights.map(asWeightValue)

  const vars: Record<string, ScriptValue> = {
    weights: weights.length > 0 ? weights : fallbackWeights,
    completedWeights: weights.length > 0 ? weights : fallbackWeights,
    reps: logged.map((set) => set.prescribedReps),
    minReps: logged.map((set) => set.minReps ?? set.prescribedReps),
    completedReps: logged.map((set) => set.completedReps ?? 0),
    RPE: logged.map(() => 0),
    completedRPE: logged.map(() => 0),
    amraps: logged.map((set) => (set.isAmrap ? 1 : 0)),
    timers: logged.map(() => 0),
    numberOfSets: logged.length,
    setVariationIndex: exerciseState.setVariationIndex,
    week: ctx.week,
    day: ctx.day,
    rm1: estimate1RM(sessionLog, working, ctx),
    bodyweight: ctx.bodyweight ? asWeightValue(ctx.bodyweight) : weight(0, ctx.units),
  }

  const state: Record<string, ScriptValue> = {}
  // The DESUGARED progression owns the state seeds: `lp` counts its streaks in
  // state vars that the shorthand never mentions, so reading them off the
  // written `progress:` section would leave them undefined.
  const progression = desugared ?? exercise.sections.progress
  if (progression?.kind === 'custom') {
    for (const init of progression.stateInit) state[init.name] = init.value.value
  }
  for (const [name, value] of Object.entries(exerciseState.state)) {
    state[name] = typeof value === 'number' ? value : asWeightValue(value)
  }

  return { vars, state, locals: {} }
}

function toStoredValue(value: ScriptValue): number | WeightValue | undefined {
  const scalar = isArray(value) ? value[0] : value
  if (scalar === undefined) return undefined
  if (typeof scalar === 'number') return scalar
  if (isWeight(scalar)) return { value: scalar.value, unit: scalar.unit }
  return scalar.value
}

/** Collapses the per-set weights the script produced back into the stored working weights. */
function storedWeights(value: ScriptValue, previous: WeightValue[]): WeightValue[] {
  const list = isArray(value) ? value : [value]
  const weights = list.filter(isWeight)
  if (weights.length === 0) return previous

  const distinct: WeightValue[] = []
  for (const item of weights) {
    const last = distinct.at(-1)
    if (last && last.value === item.value && last.unit === item.unit) continue
    distinct.push({ value: item.value, unit: item.unit })
  }
  return distinct.length === 1 ? distinct : [distinct[0]]
}

function formatVariation(groups: SetGroup[]): string {
  return groups
    .map((group) => {
      const range = group.maxReps === undefined ? String(group.reps) : `${String(group.reps)}-${String(group.maxReps)}`
      return `${String(group.count)}x${range}${group.isAmrap ? '+' : ''}`
    })
    .join(', ')
}

function describeChange(
  exercise: ExerciseLine,
  exerciseName: string,
  before: { index: number; weight: WeightValue | undefined },
  after: { index: number; weight: WeightValue | undefined },
): string {
  const parts: string[] = []

  const beforeWeight = before.weight ? format(asWeightValue(before.weight)) : undefined
  const afterWeight = after.weight ? format(asWeightValue(after.weight)) : undefined
  const weightChanged = beforeWeight !== afterWeight
  const stageChanged = before.index !== after.index

  if (stageChanged) {
    const beforeSets = formatVariation(variationOf(exercise, before.index))
    const afterSets = formatVariation(variationOf(exercise, after.index))
    if (after.index < before.index) parts.push(`reset to ${afterSets}`)
    else parts.push(`${beforeSets} -> ${afterSets}`)
  }

  if (weightChanged && beforeWeight && afterWeight) parts.push(`${beforeWeight} -> ${afterWeight}`)
  else if (stageChanged && afterWeight) parts.push(`weight held at ${afterWeight}`)
  else if (!stageChanged && afterWeight) parts.push(`unchanged at ${afterWeight}`)
  else if (parts.length === 0) parts.push('unchanged')

  return `${exerciseName}: ${parts.join(', ')}`
}

/**
 * Applies the exercise's progression to a finished session and reports what it
 * did in one human line.
 */
export function evaluateSession(
  program: Program,
  exerciseName: string,
  exerciseState: ExerciseState,
  sessionLog: SessionLog,
  ctx: EvalContext,
): EvaluateResult {
  const unchanged: ExerciseState = {
    weights: exerciseState.weights.map((item) => ({ ...item })),
    setVariationIndex: exerciseState.setVariationIndex,
    state: { ...exerciseState.state },
    ...(exerciseState.askWeight === undefined ? {} : { askWeight: exerciseState.askWeight }),
  }

  const exercise = findExercise(program, exerciseName, ctx)
  if (!exercise) {
    return {
      nextState: unchanged,
      summary: `${exerciseName}: unchanged`,
      diagnostics: [createDiagnostic(`Exercise "${exerciseName}" is not in the program.`, ORIGIN, '')],
    }
  }

  const declared = exercise.sections.progress
  let progression: NoneProgression | CustomProgression | undefined
  try {
    // `custom` and `none` need no rewriting, and skipping the call keeps a
    // program that uses neither shorthand independent of the desugarer.
    progression =
      declared === undefined || declared.kind === 'custom' || declared.kind === 'none'
        ? declared
        : desugarProgression(declared)
  } catch (error) {
    return {
      nextState: unchanged,
      summary: `${exerciseName}: unchanged`,
      diagnostics: [
        createDiagnostic(error instanceof Error ? error.message : String(error), declared?.loc ?? ORIGIN, ''),
      ],
    }
  }

  if (!progression || progression.kind === 'none') {
    return { nextState: unchanged, summary: `${exerciseName}: unchanged`, diagnostics: [] }
  }

  const scope = buildScope(exercise, exerciseState, sessionLog, ctx, progression)
  const beforeWeights = storedWeights(scope.vars.weights, unchanged.weights)
  const beforeIndex = exerciseState.setVariationIndex

  try {
    runScript(progression.script, scope, ctx)
  } catch (error) {
    const loc = error instanceof ScriptError ? error.loc : progression.loc
    return {
      nextState: unchanged,
      summary: `${exerciseName}: unchanged`,
      diagnostics: [createDiagnostic(error instanceof Error ? error.message : String(error), loc, '')],
    }
  }

  const rawIndex = scope.vars.setVariationIndex
  const variationCount = Math.max(1, exercise.setVariations.length)
  const nextIndex =
    typeof rawIndex === 'number' ? Math.min(Math.max(Math.round(rawIndex), 1), variationCount) : beforeIndex

  const nextWeights = storedWeights(scope.vars.weights, beforeWeights)

  const nextStateVars: Record<string, number | WeightValue> = {}
  for (const [name, value] of Object.entries(scope.state)) {
    const stored = toStoredValue(value)
    if (stored !== undefined) nextStateVars[name] = stored
  }

  const nextState: ExerciseState = {
    weights: nextWeights,
    setVariationIndex: nextIndex,
    state: nextStateVars,
    ...(exerciseState.askWeight === undefined ? {} : { askWeight: exerciseState.askWeight }),
  }

  const summary = describeChange(
    exercise,
    exerciseName,
    { index: beforeIndex, weight: beforeWeights[0] },
    { index: nextIndex, weight: nextWeights[0] },
  )

  return { nextState, summary, diagnostics: [] }
}
