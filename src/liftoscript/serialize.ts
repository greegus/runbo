/**
 * Program → text. `parse → serialize → parse → serialize` must be stable, which
 * is what lets the program editor round-trip an imported program without
 * rewriting the user's training every time they open it.
 *
 * Stability is about the AST, not the characters: the writer normalises (a
 * standalone weight segment lands on the set groups, a continued line collapses
 * onto one, sections come out in a fixed order) and the second parse has to
 * produce exactly the tree the first one did.
 */

import type { Expr, ExerciseLine, Progression, Program, Sections, SetGroup, Stmt, WarmupSet, WeightExpr } from './types'

/** Longest one-line `{~ … ~}` we are willing to write before going multi-line. */
const INLINE_SCRIPT_LIMIT = 120

const INDENT = '  '

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/** `100`, `2.5` — never `100.0`, and never float noise from weight arithmetic. */
function formatNumber(value: number): string {
  return String(Math.round(value * 1e6) / 1e6)
}

/** Durations read better in minutes when they are whole ones: `2min`, `90s`. */
function formatDuration(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return `${formatNumber(seconds / 60)}min`
  return `${formatNumber(seconds)}s`
}

function serializeWeightExpr(expr: WeightExpr): string {
  switch (expr.kind) {
    case 'absolute':
      return `${formatNumber(expr.value)}${expr.unit}`
    case 'percent':
      return `${formatNumber(expr.value)}%`
    case 'ask':
      return '?+'
  }
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

// Only used to decide where parentheses are REQUIRED — redundant ones in the
// source are dropped, which is why two parses of the same tree agree.
const BINARY_PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '>': 4,
  '<': 4,
  '>=': 4,
  '<=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
}

const TERNARY_PRECEDENCE = 0
const UNARY_PRECEDENCE = 7
const PRIMARY_PRECEDENCE = 8

function precedenceOf(expr: Expr): number {
  if (expr.type === 'binary') return BINARY_PRECEDENCE[expr.op] ?? PRIMARY_PRECEDENCE
  if (expr.type === 'ternary') return TERNARY_PRECEDENCE
  if (expr.type === 'unary') return UNARY_PRECEDENCE
  return PRIMARY_PRECEDENCE
}

/** Renders `expr` as an operand, parenthesised when it binds looser than `minimum`. */
function operand(expr: Expr, minimum: number): string {
  const rendered = serializeExpr(expr)
  return precedenceOf(expr) < minimum ? `(${rendered})` : rendered
}

export function serializeExpr(expr: Expr): string {
  switch (expr.type) {
    case 'number':
      return formatNumber(expr.value)
    case 'weight':
      return `${formatNumber(expr.value.value)}${expr.value.unit}`
    case 'percent':
      return `${formatNumber(expr.value.value)}%`
    case 'var':
      if (expr.scope === 'state') return `state.${expr.name}`
      if (expr.scope === 'var') return `var.${expr.name}`
      return expr.name
    case 'index':
      return `${serializeExpr(expr.target)}[${serializeExpr(expr.index)}]`
    case 'unary':
      return `${expr.op}${operand(expr.operand, UNARY_PRECEDENCE)}`
    case 'binary': {
      const precedence = BINARY_PRECEDENCE[expr.op] ?? PRIMARY_PRECEDENCE
      // Left-associative: the right operand needs parentheses at equal precedence.
      return `${operand(expr.left, precedence)} ${expr.op} ${operand(expr.right, precedence + 1)}`
    }
    case 'ternary':
      return `${operand(expr.condition, TERNARY_PRECEDENCE + 1)} ? ${serializeExpr(expr.ifTrue)} : ${operand(expr.ifFalse, TERNARY_PRECEDENCE + 1)}`
    case 'call':
      return `${expr.name}(${expr.args.map(serializeExpr).join(', ')})`
  }
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

function serializeStmtLines(stmt: Stmt, level: number): string[] {
  const pad = INDENT.repeat(level)

  switch (stmt.type) {
    case 'assign':
      return [`${pad}${serializeExpr(stmt.target)} ${stmt.op} ${serializeExpr(stmt.value)}`]
    case 'expr':
      return [`${pad}${serializeExpr(stmt.expression)}`]
    case 'forIn':
      return [
        `${pad}for (${serializeExpr(stmt.variable)} in ${serializeExpr(stmt.iterable)}) {`,
        ...stmt.body.flatMap((inner) => serializeStmtLines(inner, level + 1)),
        `${pad}}`,
      ]
    case 'if': {
      const lines: string[] = []
      stmt.branches.forEach((branch, index) => {
        const keyword = index === 0 ? 'if' : '} else if'
        lines.push(`${pad}${keyword} (${serializeExpr(branch.condition)}) {`)
        lines.push(...branch.body.flatMap((inner) => serializeStmtLines(inner, level + 1)))
      })
      if (stmt.elseBody) {
        lines.push(`${pad}} else {`)
        lines.push(...stmt.elseBody.flatMap((inner) => serializeStmtLines(inner, level + 1)))
      }
      lines.push(`${pad}}`)
      return lines
    }
  }
}

/** Renders script statements without the `{~ ~}` delimiters, indented from `level`. */
export function serializeScript(script: Stmt[], level = 0): string {
  return script.flatMap((stmt) => serializeStmtLines(stmt, level)).join('\n')
}

/**
 * The one-line form, or `null` when the statement needs a block. Kept
 * deliberately narrow — a single guarded assignment is the shape that reads
 * better inline (`{~ if (completedReps[3] >= 25) { weights += 2.5kg } ~}`);
 * anything with a branch or a loop belongs on its own lines.
 */
function compactStmt(stmt: Stmt): string | null {
  if (stmt.type === 'assign' || stmt.type === 'expr') return serializeStmtLines(stmt, 0)[0]
  if (stmt.type !== 'if' || stmt.branches.length !== 1 || stmt.elseBody) return null

  const [branch] = stmt.branches
  if (branch.body.length !== 1) return null
  const inner = branch.body[0]
  if (inner.type !== 'assign' && inner.type !== 'expr') return null

  return `if (${serializeExpr(branch.condition)}) { ${serializeStmtLines(inner, 0)[0]} }`
}

/** `{~ … ~}`, on one line when it fits, otherwise a block indented from `level`. */
function serializeScriptBlock(script: Stmt[], level: number): string {
  if (script.length === 0) return '{~ ~}'

  if (script.length === 1) {
    const compact = compactStmt(script[0])
    if (compact && compact.length <= INLINE_SCRIPT_LIMIT) return `{~ ${compact} ~}`
  }

  return `{~\n${serializeScript(script, level + 1)}\n~}`
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function serializeWarmupSet(set: WarmupSet): string {
  return `${formatNumber(set.count)}x${formatNumber(set.reps)} ${serializeWeightExpr(set.weight)}`
}

function serializeProgression(progression: Progression): string {
  switch (progression.kind) {
    case 'none':
      return 'none'
    case 'lp': {
      const { increment, successesRequired, successCounter, deload, failuresRequired, failureCounter } =
        progression.args
      const isDefault =
        successesRequired === 1 &&
        successCounter === 0 &&
        failuresRequired === 0 &&
        failureCounter === 0 &&
        deload.kind === 'absolute' &&
        deload.value === 0
      if (isDefault) return `lp(${serializeWeightExpr(increment)})`
      const args = [
        serializeWeightExpr(increment),
        formatNumber(successesRequired),
        formatNumber(successCounter),
        serializeWeightExpr(deload),
        formatNumber(failuresRequired),
        formatNumber(failureCounter),
      ]
      return `lp(${args.join(', ')})`
    }
    case 'dp': {
      const { increment, minReps, maxReps } = progression.args
      return `dp(${serializeWeightExpr(increment)}, ${formatNumber(minReps)}, ${formatNumber(maxReps)})`
    }
    case 'sum':
      return `sum(${formatNumber(progression.args.target)}, ${serializeWeightExpr(progression.args.increment)})`
    case 'custom': {
      const inits = progression.stateInit.map((init) => `${init.name}: ${serializeExpr(init.value)}`).join(', ')
      return `custom(${inits}) ${serializeScriptBlock(progression.script, 0)}`
    }
  }
}

/**
 * Sections in a fixed order — `progress:` goes last because a `custom` script
 * may span lines, and everything after it would read as part of the block.
 */
function serializeSections(sections: Sections): string[] {
  const segments: string[] = []

  if (sections.warmup !== undefined) {
    const warmup = sections.warmup === 'none' ? 'none' : sections.warmup.map(serializeWarmupSet).join(', ')
    segments.push(`warmup: ${warmup}`)
  }
  if (sections.restSec !== undefined) segments.push(`rest: ${formatDuration(sections.restSec)}`)
  if (sections.tags?.length) segments.push(`id: tags(${sections.tags.map(formatNumber).join(', ')})`)
  if (sections.usedNone) segments.push('used: none')
  if (sections.progress) segments.push(`progress: ${serializeProgression(sections.progress)}`)

  return segments
}

// ---------------------------------------------------------------------------
// Set groups and exercise lines
// ---------------------------------------------------------------------------

/** `60s|30s` — the right side is `?` when the program leaves the rest open. */
function serializeTimer(group: SetGroup): string | undefined {
  if (group.setTimerSec === undefined) return undefined
  // Seconds on both sides, always: `1min|30s` is a legal but jarring way to
  // write back the `60s|30s` the user typed.
  const rest = group.restTimerSec === undefined ? '?' : `${formatNumber(group.restTimerSec)}s`
  return `${formatNumber(group.setTimerSec)}s|${rest}`
}

/** Renders one set group, e.g. `3x8-12 100kg @8+ 60s|30s (Top set)`. */
export function serializeSetGroup(group: SetGroup): string {
  const parts: string[] = []
  const isCardio = group.duration !== undefined || group.distance !== undefined

  if (isCardio) {
    const amount = group.distance
      ? `${formatNumber(group.distance.value)}${group.distance.unit}`
      : formatDuration(group.duration ?? 0)
    parts.push(group.count > 1 ? `${formatNumber(group.count)}x${amount}` : amount)
  } else {
    let reps = `${formatNumber(group.count)}x${formatNumber(group.reps)}`
    if (group.maxReps !== undefined) reps += `-${formatNumber(group.maxReps)}`
    if (group.isAmrap) reps += '+'
    parts.push(reps)
  }

  if (group.weight) parts.push(serializeWeightExpr(group.weight))
  else if (group.askWeight) parts.push('?+')

  if (group.zone !== undefined) parts.push(`@Z${formatNumber(group.zone)}`)
  else if (group.rpe !== undefined) parts.push(`@${formatNumber(group.rpe)}${group.rpeLog ? '+' : ''}`)

  const timer = serializeTimer(group)
  if (timer) parts.push(timer)

  if (group.label) parts.push(`(${group.label})`)

  return parts.join(' ')
}

function serializeExerciseLine(exercise: ExerciseLine): string[] {
  const lines: string[] = []

  if (exercise.description) {
    for (const line of exercise.description.split('\n')) lines.push(`// ${line}`.trimEnd())
  }

  const head = `${exercise.label ? `${exercise.label}: ` : ''}${exercise.name}${exercise.equipment ? `, ${exercise.equipment}` : ''}`
  const variations = exercise.setVariations.map((groups) => groups.map(serializeSetGroup).join(', ')).filter(Boolean)
  const segments = [...variations, ...serializeSections(exercise.sections)]

  lines.push([head, ...segments].join(' / '))
  return lines
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

/**
 * Renders a program back to Liftoscript.
 *
 * Canonical form (the second parse must reproduce the same AST):
 * - `# <week name>` / `## <day name>` headers, one blank line between days;
 * - `//` description lines above their exercise line;
 * - `[label: ]name[, equipment]` followed by ` / ` separated segments: every set
 *   variation in order, then `warmup:`, `rest:`, `id: tags(...)`, `used: none`
 *   and `progress:` last;
 * - weights are written on the set groups (a standalone weight segment from the
 *   source is normalised away), numbers without trailing zeros;
 * - a `custom(...)` progression keeps its script, re-indented two spaces per
 *   level inside `{~ … ~}`; a single guarded assignment stays on one line;
 * - `lp` / `dp` / `sum` nodes serialize back to their shorthand; a program that
 *   has already been desugared serializes as the `custom` it now is.
 */
export function serializeProgram(program: Program): string {
  const blocks: string[] = []

  for (const week of program.weeks) {
    const lines: string[] = [`# ${week.name}`]

    for (const day of week.days) {
      lines.push('', `## ${day.name}`)
      for (const exercise of day.exercises) lines.push(...serializeExerciseLine(exercise))
    }

    blocks.push(lines.join('\n'))
  }

  return `${blocks.join('\n\n')}\n`
}
