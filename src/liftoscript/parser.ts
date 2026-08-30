/**
 * Liftoscript parser: source text → `Program` + diagnostics.
 *
 * The parser never throws and never bails on the first problem: an imported
 * program is only useful if it reports everything that is wrong with it at
 * once, so a broken line is reported, skipped, and the rest keeps parsing.
 */

import {
  createDiagnostic,
  type Diagnostic,
  formatDiagnostic,
  UNSUPPORTED_CONSTRUCTS,
  unsupportedDiagnostic,
} from './diagnostics'
import { resolveReuse } from './resolveReuse'
import { type Token, tokenize } from './tokenizer'
import {
  ARRAY_VARS,
  type AssignOp,
  type AssignStmt,
  type BinaryOp,
  BUILTIN_FUNCTIONS,
  type Day,
  type ExerciseLine,
  type Expr,
  type ForInStmt,
  type IfStmt,
  type IndexExpr,
  type Literal,
  type Loc,
  type ParseResult,
  type Program,
  type Progression,
  type ReuseRef,
  READONLY_VARS,
  type Sections,
  type SetGroup,
  type StateInit,
  type Stmt,
  VAR_ALIASES,
  type VarRef,
  type VarScope,
  type WarmupSet,
  type Week,
  type WeightExpr,
  WRITABLE_VARS,
} from './types'
import { percent, type Unit, weight } from './weight'

const KNOWN_VARS = new Set<string>([...READONLY_VARS, ...WRITABLE_VARS, ...ARRAY_VARS])
const WRITABLE = new Set<string>(WRITABLE_VARS)
const ARRAYS = new Set<string>(ARRAY_VARS)
const BUILTINS = new Set<string>(BUILTIN_FUNCTIONS)

const ASSIGN_OPS = new Set<string>(['=', '+=', '-=', '*=', '/='])

/** Binding power per binary operator, loosest first. */
const BINARY_PRECEDENCE: { ops: BinaryOp[] }[] = [
  { ops: ['||'] },
  { ops: ['&&'] },
  { ops: ['==', '!='] },
  { ops: ['>', '<', '>=', '<='] },
  { ops: ['+', '-'] },
  { ops: ['*', '/', '%'] },
]

interface ParseCtx {
  diagnostics: Diagnostic[]
  lineAt: (line: number) => string
}

function report(ctx: ParseCtx, message: string, loc: Loc): void {
  ctx.diagnostics.push(createDiagnostic(message, loc, ctx.lineAt(loc.line)))
}

// ---------------------------------------------------------------------------
// Token cursor
// ---------------------------------------------------------------------------

class Cursor {
  tokens: Token[]
  pos: number

  constructor(tokens: Token[]) {
    this.tokens = tokens
    this.pos = 0
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset]
  }

  next(): Token | undefined {
    const token = this.tokens[this.pos]
    this.pos += 1
    return token
  }

  atEnd(): boolean {
    return this.pos >= this.tokens.length
  }

  /** Consumes and returns the next token when its text matches. */
  eat(value: string): Token | undefined {
    if (this.peek()?.value === value) return this.next()
    return undefined
  }

  /** Position for a diagnostic when the stream has already run out. */
  loc(): Loc {
    return this.peek()?.loc ?? this.tokens[this.tokens.length - 1]?.loc ?? { line: 1, col: 1 }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a whole program. Never throws.
 *
 * Structure:
 * - `# text` opens a week, `## text` opens a day. Exercise lines before any
 *   header belong to an implicit `Week 1` / `Day 1`.
 * - `// text` lines accumulate into the `description` of the next exercise
 *   line; `/// text` lines are dropped.
 * - An exercise line is `[label ':'] name [',' equipment] ('/' segment)+`, and a
 *   trailing `\` continues it on the next physical line.
 * - Each segment is either a set spec (`5x3+ 100kg @8+ 60s|30s (Top set)`,
 *   comma-separated groups) or a section (`progress:`, `warmup:`, `rest:`,
 *   `id: tags(...)`, `used: none`). Consecutive set specs are SET VARIATIONS,
 *   in written order; `setVariationIndex` is 1-based over them.
 * - A segment that is only a weight (`100kg`, `?+`) or only a timer (`60s|30s`)
 *   is not a variation: it applies to every set group that carries none itself.
 * - Cardio extension: a set group may be `[N 'x'] (duration | distance) [@Zn | @n]`.
 * - `lp` / `dp` / `sum` are parsed into their own node kinds; desugaring to
 *   `custom` happens in `progressions.ts`, never here.
 *
 * Every construct in `UNSUPPORTED_CONSTRUCTS` is checked BEFORE the line is
 * parsed further and reported with that table's exact message plus the column
 * where the construct starts. Parsing then skips the line and continues, so one
 * import reports every problem at once.
 */
export function parseProgram(source: string): ParseResult {
  const { tokens, diagnostics, lines } = tokenize(source)
  const ctx: ParseCtx = { diagnostics, lineAt: (line) => lines[line - 1] ?? '' }

  const rejected = scanUnsupported(lines, ctx)

  const program: Program = { weeks: [] }
  let description: string[] = []

  function currentWeek(loc: Loc): Week {
    if (program.weeks.length === 0) program.weeks.push({ name: 'Week 1', days: [], loc })
    return program.weeks[program.weeks.length - 1]
  }

  function currentDay(loc: Loc): Day {
    const week = currentWeek(loc)
    if (week.days.length === 0) week.days.push({ name: 'Day 1', exercises: [], loc })
    return week.days[week.days.length - 1]
  }

  for (const logical of logicalLines(tokens)) {
    const first = logical.tokens[0]
    if (!first) {
      description = []
      continue
    }

    if (first.type === 'comment') {
      // `///` is an author's note; only `//` reaches the athlete.
      if (!first.value.startsWith('///')) description.push(first.value.replace(/^\/\/\s?/, ''))
      continue
    }

    if (first.value === '#' || first.value === '##') {
      const name = ctx
        .lineAt(first.loc.line)
        .slice(first.loc.col - 1 + first.value.length)
        .trim()
      if (first.value === '#') {
        program.weeks.push({ name: name || `Week ${program.weeks.length + 1}`, days: [], loc: first.loc })
      } else {
        const week = currentWeek(first.loc)
        week.days.push({ name: name || `Day ${week.days.length + 1}`, exercises: [], loc: first.loc })
      }
      description = []
      continue
    }

    // A line carrying an unsupported construct was already reported; parsing it
    // further would only add noise on top of the real cause.
    let skip = false
    for (let line = logical.startLine; line <= logical.endLine; line++) {
      if (rejected.has(line)) skip = true
    }
    if (skip) {
      description = []
      continue
    }

    const exercise = parseExerciseLine(logical.tokens, ctx)
    if (exercise) {
      if (description.length > 0) exercise.description = description.join('\n')
      currentDay(first.loc).exercises.push(exercise)
    }
    description = []
  }

  resolveReuse(program, diagnostics, ctx.lineAt)

  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col)

  return { program, diagnostics }
}

/**
 * Parses the body of a `{~ ~}` block on its own — used by the program editor to
 * validate a progression snippet, and by tests. `startLine`/`startCol` place the
 * snippet inside the surrounding file so diagnostics point at real positions.
 */
export function parseScript(
  source: string,
  startLine = 1,
  startCol = 1,
): { script: Stmt[]; diagnostics: ParseResult['diagnostics'] } {
  const { tokens, diagnostics, lines } = tokenize(source)
  const ctx: ParseCtx = {
    diagnostics,
    lineAt: (line) => lines[line - startLine] ?? '',
  }
  const script = parseStatements(new Cursor(offsetTokens(tokens, startLine, startCol)), ctx, null)
  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col)
  return { script, diagnostics }
}

/** Convenience for tests: throws with the first diagnostic if the program is not clean. */
export function parseProgramOrThrow(source: string): Program {
  const { program, diagnostics } = parseProgram(source)
  const error = diagnostics.find((diagnostic) => diagnostic.severity === 'error')
  if (error) throw new Error(formatDiagnostic(error))
  return program
}

// ---------------------------------------------------------------------------
// Line level
// ---------------------------------------------------------------------------

interface LogicalLine {
  tokens: Token[]
  startLine: number
  endLine: number
}

/**
 * Groups tokens into logical lines. The tokenizer already swallowed `\`
 * continuations and whole `{~ ~}` blocks, so a `newline` token always ends a
 * complete statement of the program syntax.
 */
function logicalLines(tokens: Token[]): LogicalLine[] {
  const result: LogicalLine[] = []
  let current: Token[] = []

  for (const token of tokens) {
    if (token.type === 'newline' || token.type === 'eof') {
      result.push({
        tokens: current,
        startLine: current[0]?.loc.line ?? token.loc.line,
        endLine: token.loc.line,
      })
      current = []
      continue
    }
    current.push(token)
  }

  return result
}

/**
 * Reports every unsupported construct and returns the physical lines that must
 * not be parsed further. Comment lines are exempt (a construct named in prose
 * is not a construct), and inside a multi-line script body only the checks that
 * describe script syntax run — `||` in a condition is not an exercise variation.
 */
function scanUnsupported(lines: string[], ctx: ParseCtx): Set<number> {
  const rejected = new Set<number>()
  let insideScript = false

  lines.forEach((text, offset) => {
    const line = offset + 1
    const opensScript = text.includes('{~')
    const closesScript = text.includes('~}')
    const bodyOnly = insideScript && !opensScript

    // The loose patterns describe program syntax, so they only see the part of
    // the line before `{~`: `||` in a condition is not an exercise variation.
    const scriptStart = text.indexOf('{~')
    const programPart = bodyOnly ? '' : scriptStart === -1 ? text : text.slice(0, scriptStart)

    if (!/^\s*\/\//.test(text)) {
      for (const construct of UNSUPPORTED_CONSTRUCTS) {
        const match = construct.pattern.exec(construct.id === 'crossExerciseState' ? text : programPart)
        if (!match) continue
        const col = (match.index ?? 0) + 1 + leadingOffset(match[0])
        ctx.diagnostics.push(unsupportedDiagnostic(construct.id, { line, col }, text))
        rejected.add(line)
      }
    }

    if (opensScript && !closesScript) insideScript = true
    else if (closesScript) insideScript = false
  })

  return rejected
}

/** Points the caret at the construct itself, not at the whitespace a pattern ate. */
function leadingOffset(match: string): number {
  return match.length - match.trimStart().length
}

// ---------------------------------------------------------------------------
// Exercise line
// ---------------------------------------------------------------------------

function parseExerciseLine(tokens: Token[], ctx: ParseCtx): ExerciseLine | null {
  const loc = tokens[0].loc
  const segments = splitSegments(tokens)
  const head = segments.shift() ?? []
  if (head.length === 0) {
    report(ctx, 'Expected an exercise name before the first `/`.', loc)
    return null
  }

  const rawHead = rawRange(head, ctx)
  let label: string | undefined
  let rest = rawHead
  const colon = rawHead.indexOf(':')
  if (colon !== -1) {
    label = rawHead.slice(0, colon).trim()
    rest = rawHead.slice(colon + 1)
  }
  const comma = rest.indexOf(',')
  const name = (comma === -1 ? rest : rest.slice(0, comma)).trim()
  const equipment = comma === -1 ? undefined : rest.slice(comma + 1).trim() || undefined

  if (!name) {
    report(ctx, 'Expected an exercise name.', loc)
    return null
  }

  const exercise: ExerciseLine = { name, setVariations: [], sections: {}, loc }
  if (label) exercise.label = label
  if (equipment) exercise.equipment = equipment

  let sharedWeight: WeightExpr | undefined
  let sharedSetTimer: number | undefined
  let sharedRestTimer: number | undefined

  for (const segment of segments) {
    if (segment.length === 0) continue

    if (isSection(segment)) {
      parseSection(segment, exercise.sections, ctx)
      continue
    }

    // `/ ...t3: Lat Pulldown[1]` stands where the sets would be; `resolveReuse`
    // copies them in once the whole program is parsed.
    if (segment[0]?.value === '...') {
      const ref = parseReuseRef(new Cursor(segment), ctx)
      if (ref) exercise.reuseSets = ref
      continue
    }

    const parsed = parseSetSpec(segment, ctx)
    if (parsed.kind === 'weight') {
      sharedWeight = parsed.weight
      if (parsed.restTimerSec !== undefined) sharedRestTimer = parsed.restTimerSec
    } else if (parsed.kind === 'timer') {
      sharedSetTimer = parsed.setTimerSec
      sharedRestTimer = parsed.restTimerSec
    } else if (parsed.kind === 'sets' && parsed.groups.length > 0) {
      exercise.setVariations.push(parsed.groups)
    }
  }

  // A standalone weight/timer segment is written once and meant for every set.
  for (const variation of exercise.setVariations) {
    for (const group of variation) {
      if (!group.weight && sharedWeight) {
        group.weight = sharedWeight
        if (sharedWeight.kind === 'ask') group.askWeight = true
      }
      if (group.setTimerSec === undefined && sharedSetTimer !== undefined) group.setTimerSec = sharedSetTimer
      if (group.restTimerSec === undefined && sharedRestTimer !== undefined) group.restTimerSec = sharedRestTimer
    }
  }

  if (exercise.setVariations.length === 0 && !exercise.reuseSets) {
    // A line with no `/` at all is almost never a broken exercise — it is a
    // heading someone forgot to comment out. Saying "expected sets" sends them
    // looking for the wrong mistake.
    report(
      ctx,
      segments.length === 0
        ? `\`${name}\` has no sets. If this is a heading, comment it out with \`//\` or make it a day with \`## ${name}\`.`
        : 'Expected at least one set, e.g. `/ 3x8`.',
      loc,
    )
  }

  return exercise
}

/** Splits a line on its top-level `/`; the first chunk is the exercise head. */
function splitSegments(tokens: Token[]): Token[][] {
  const segments: Token[][] = [[]]
  let depth = 0

  for (const token of tokens) {
    if (token.value === '(' || token.value === '[' || token.value === '{' || token.value === '{~') depth += 1
    else if (token.value === ')' || token.value === ']' || token.value === '}' || token.value === '~}') depth -= 1

    if (token.value === '/' && depth === 0) {
      segments.push([])
      continue
    }
    segments[segments.length - 1].push(token)
  }

  return segments
}

function splitOn(tokens: Token[], separator: string): Token[][] {
  const parts: Token[][] = [[]]
  let depth = 0

  for (const token of tokens) {
    if (token.value === '(' || token.value === '[' || token.value === '{' || token.value === '{~') depth += 1
    else if (token.value === ')' || token.value === ']' || token.value === '}' || token.value === '~}') depth -= 1

    if (token.value === separator && depth === 0) {
      parts.push([])
      continue
    }
    parts[parts.length - 1].push(token)
  }

  return parts.filter((part) => part.length > 0)
}

/** The source text a token run covers, verbatim — the only way to keep the spacing of a name. */
function rawRange(tokens: Token[], ctx: ParseCtx): string {
  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  const text = ctx.lineAt(first.loc.line)
  const end = last.loc.line === first.loc.line ? last.loc.col - 1 + last.value.length : text.length
  return text.slice(first.loc.col - 1, end).trim()
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** `key: value` is always a section — a set spec can only start with a number. */
function isSection(segment: Token[]): boolean {
  return segment[0]?.type === 'ident' && segment[1]?.value === ':'
}

function parseSection(segment: Token[], sections: Sections, ctx: ParseCtx): void {
  const key = segment[0].value.toLowerCase()
  const cursor = new Cursor(segment.slice(2))
  const loc = segment[0].loc

  switch (key) {
    case 'progress': {
      sections.progress = parseProgression(cursor, ctx, loc)
      break
    }
    case 'warmup': {
      sections.warmup = parseWarmup(segment.slice(2), ctx, loc)
      break
    }
    case 'rest': {
      const seconds = parseDuration(cursor, ctx)
      if (seconds !== undefined) sections.restSec = seconds
      break
    }
    case 'id': {
      sections.tags = parseTags(cursor, ctx, loc)
      break
    }
    case 'used': {
      if (cursor.peek()?.value === 'none') sections.usedNone = true
      else report(ctx, 'Only `used: none` is supported.', cursor.loc())
      break
    }
    default:
      report(ctx, `Unknown section \`${key}:\`.`, loc)
  }
}

function parseTags(cursor: Cursor, ctx: ParseCtx, loc: Loc): number[] {
  const tags: number[] = []
  if (cursor.peek()?.value !== 'tags') {
    report(ctx, 'Expected `id: tags(1, 2)`.', loc)
    return tags
  }
  cursor.next()
  if (!cursor.eat('(')) {
    report(ctx, 'Expected `(` after `tags`.', cursor.loc())
    return tags
  }
  while (!cursor.atEnd() && cursor.peek()?.value !== ')') {
    const token = cursor.next()
    if (token?.type === 'number') tags.push(Number(token.value))
    else if (token?.value !== ',') report(ctx, 'Expected a numeric tag.', token?.loc ?? loc)
  }
  cursor.eat(')')
  return tags
}

function parseWarmup(tokens: Token[], ctx: ParseCtx, loc: Loc): WarmupSet[] | 'none' {
  if (tokens.length === 1 && tokens[0].value === 'none') return 'none'

  const sets: WarmupSet[] = []
  for (const part of splitOn(tokens, ',')) {
    const cursor = new Cursor(part)
    const setLoc = part[0].loc
    let count = 1
    if (cursor.peek()?.type === 'number' && cursor.peek(1)?.value === 'x') {
      count = Number(cursor.next()!.value)
      cursor.next()
    }
    const repsToken = cursor.peek()
    if (repsToken?.type !== 'number') {
      report(ctx, 'Expected warmup reps, e.g. `1x5 20kg`.', setLoc)
      continue
    }
    cursor.next()
    const weightExpr = parseWeightExpr(cursor)
    if (!weightExpr) {
      report(ctx, 'Expected a warmup weight, e.g. `20kg` or `55%`.', cursor.loc())
      continue
    }
    sets.push({ count, reps: Number(repsToken.value), weight: weightExpr, loc: setLoc })
  }

  if (sets.length === 0) report(ctx, 'Expected warmup sets or `warmup: none`.', loc)
  return sets
}

// ---------------------------------------------------------------------------
// Set specs
// ---------------------------------------------------------------------------

type SetSpec =
  | { kind: 'sets'; groups: SetGroup[] }
  | { kind: 'weight'; weight: WeightExpr; restTimerSec?: number }
  | { kind: 'timer'; setTimerSec?: number; restTimerSec?: number }

function parseSetSpec(segment: Token[], ctx: ParseCtx): SetSpec {
  const parts = splitOn(segment, ',')

  if (parts.length === 1) {
    const only = parts[0]
    const standaloneWeight = wholeWeight(only)
    if (standaloneWeight) return { kind: 'weight', weight: standaloneWeight }

    // `60% 90s` — a weight for every set followed by the rest between them.
    // Liftosaur's GZCLP writes its T3 line this way.
    const weightThenRest = wholeWeightWithRest(only)
    if (weightThenRest) return { kind: 'weight', ...weightThenRest }

    const standaloneTimer = wholeTimer(only)
    if (standaloneTimer) return { kind: 'timer', ...standaloneTimer }
  }

  const groups: SetGroup[] = []
  for (const part of parts) {
    const group = parseSetGroup(part, ctx)
    if (group) groups.push(group)
  }
  return { kind: 'sets', groups }
}

/** `100kg`, `80%`, `?+` written as a whole segment — a weight for every set. */
function wholeWeight(tokens: Token[]): WeightExpr | undefined {
  if (tokens.length === 1 && tokens[0].value === '?+') return { kind: 'ask', loc: tokens[0].loc }
  if (tokens.length === 2 && tokens[0].type === 'number' && tokens[1].type === 'unit') {
    return weightExprFrom(Number(tokens[0].value), tokens[1].value, tokens[0].loc)
  }
  return undefined
}

/** `60% 90s` / `100kg 2min` — a weight plus the rest that follows every set. */
function wholeWeightWithRest(tokens: Token[]): { weight: WeightExpr; restTimerSec: number } | undefined {
  if (tokens.length !== 4) return undefined

  const weight = wholeWeight(tokens.slice(0, 2))
  if (!weight) return undefined

  const [value, unit] = tokens.slice(2)
  if (value.type !== 'number' || unit.type !== 'unit') return undefined
  if (unit.value !== 's' && unit.value !== 'min' && unit.value !== 'h') return undefined

  return { weight, restTimerSec: toSeconds(Number(value.value), unit.value) }
}

/** `60s|30s` written as a whole segment — a timer for every set. */
function wholeTimer(tokens: Token[]): { setTimerSec?: number; restTimerSec?: number } | undefined {
  if (tokens.length < 4 || tokens[2]?.value !== '|') return undefined
  const cursor = new Cursor(tokens)
  const timer = parseTimer(cursor)
  if (!timer || !cursor.atEnd()) return undefined
  return timer
}

function parseSetGroup(tokens: Token[], ctx: ParseCtx): SetGroup | null {
  const cursor = new Cursor(tokens)
  const loc = tokens[0].loc

  const group: SetGroup = { count: 1, reps: 1, isAmrap: false, loc }

  // `6x3min` / `3x8-12`: the count is only a count when an `x` follows it.
  if (cursor.peek()?.type === 'number' && cursor.peek(1)?.value === 'x') {
    group.count = Number(cursor.next()!.value)
    cursor.next()
  }

  const head = cursor.peek()
  if (head?.type !== 'number') {
    report(ctx, 'Expected a rep count, a duration or a distance, e.g. `3x8`.', loc)
    return null
  }
  const headValue = Number(head.value)
  const headUnit = cursor.peek(1)?.type === 'unit' ? cursor.peek(1)!.value : undefined
  // `3x60s|30s` writes a timer where the load would go; the modifier loop takes it.
  const isTimer = cursor.peek(2)?.value === '|'

  if (headUnit === undefined) {
    cursor.next()
    group.reps = headValue
    if (cursor.peek()?.value === '-' && cursor.peek(1)?.type === 'number') {
      cursor.next()
      group.maxReps = Number(cursor.next()!.value)
    }
    if (cursor.peek()?.value === '+') {
      cursor.next()
      group.isAmrap = true
    }
  } else if (!isTimer && (headUnit === 's' || headUnit === 'min' || headUnit === 'h')) {
    cursor.next()
    cursor.next()
    group.duration = toSeconds(headValue, headUnit)
  } else if (!isTimer && (headUnit === 'm' || headUnit === 'km')) {
    cursor.next()
    cursor.next()
    group.distance = { value: headValue, unit: headUnit }
  } else if (!isTimer) {
    report(ctx, 'Expected reps, a duration or a distance before the weight.', loc)
    return null
  }

  // Weight, RPE, timer and label may be written in any order after the sets.
  while (!cursor.atEnd()) {
    const token = cursor.peek()!

    const weightExpr = parseWeightExpr(cursor)
    if (weightExpr) {
      group.weight = weightExpr
      if (weightExpr.kind === 'ask') group.askWeight = true
      continue
    }

    if (token.value === '@') {
      cursor.next()
      const marker = cursor.peek()
      const zone = marker?.type === 'ident' ? /^Z([1-5])$/.exec(marker.value) : null
      if (zone) {
        cursor.next()
        group.zone = Number(zone[1]) as 1 | 2 | 3 | 4 | 5
      } else if (marker?.type === 'number') {
        cursor.next()
        group.rpe = Number(marker.value)
        if (cursor.peek()?.value === '+') {
          cursor.next()
          group.rpeLog = true
        }
      } else {
        report(ctx, 'Expected an RPE (`@8`) or a zone (`@Z2`) after `@`.', token.loc)
      }
      continue
    }

    const timer = parseTimer(cursor)
    if (timer) {
      group.setTimerSec = timer.setTimerSec
      group.restTimerSec = timer.restTimerSec
      continue
    }

    // A lone duration after the load is the rest between sets — `3x15 60% 90s`.
    // Only after `parseTimer` has had its chance, so `60s|30s` still wins.
    if (token.type === 'number' && ['s', 'min', 'h'].includes(cursor.peek(1)?.value ?? '')) {
      const unit = cursor.peek(1)!.value
      cursor.next()
      cursor.next()
      group.restTimerSec = toSeconds(Number(token.value), unit)
      continue
    }

    if (token.value === '(') {
      const close = tokens.findIndex((candidate, index) => index > cursor.pos && candidate.value === ')')
      const text = ctx.lineAt(token.loc.line)
      const end = close === -1 ? text.length : tokens[close].loc.col - 1
      group.label = text.slice(token.loc.col, end).trim()
      cursor.pos = close === -1 ? tokens.length : close + 1
      continue
    }

    report(ctx, `Unexpected \`${token.value}\` in a set.`, token.loc)
    cursor.next()
  }

  return group
}

function parseWeightExpr(cursor: Cursor): WeightExpr | undefined {
  const token = cursor.peek()
  if (token?.value === '?+') {
    cursor.next()
    return { kind: 'ask', loc: token.loc }
  }
  const unit = cursor.peek(1)
  if (token?.type !== 'number' || unit?.type !== 'unit') return undefined
  if (unit.value !== 'kg' && unit.value !== 'lb' && unit.value !== '%') return undefined
  cursor.next()
  cursor.next()
  return weightExprFrom(Number(token.value), unit.value, token.loc)
}

function weightExprFrom(value: number, unit: string, loc: Loc): WeightExpr | undefined {
  if (unit === '%') return { kind: 'percent', value, loc }
  if (unit === 'kg' || unit === 'lb') return { kind: 'absolute', value, unit, loc }
  return undefined
}

/** `60s|30s` or `60s|?` — a set timer and the rest that follows it. */
function parseTimer(cursor: Cursor): { setTimerSec?: number; restTimerSec?: number } | undefined {
  const value = cursor.peek()
  const unit = cursor.peek(1)
  if (value?.type !== 'number' || unit?.type !== 'unit' || !isDurationUnit(unit.value)) return undefined
  if (cursor.peek(2)?.value !== '|') return undefined

  cursor.next()
  cursor.next()
  cursor.next()

  const setTimerSec = toSeconds(Number(value.value), unit.value)

  if (cursor.peek()?.value === '?') {
    cursor.next()
    return { setTimerSec }
  }
  const restValue = cursor.peek()
  const restUnit = cursor.peek(1)
  if (restValue?.type === 'number' && restUnit?.type === 'unit' && isDurationUnit(restUnit.value)) {
    cursor.next()
    cursor.next()
    return { setTimerSec, restTimerSec: toSeconds(Number(restValue.value), restUnit.value) }
  }
  return { setTimerSec }
}

function parseDuration(cursor: Cursor, ctx: ParseCtx): number | undefined {
  const value = cursor.peek()
  const unit = cursor.peek(1)
  if (value?.type !== 'number' || unit?.type !== 'unit' || !isDurationUnit(unit.value)) {
    report(ctx, 'Expected a duration, e.g. `90s` or `2min`.', cursor.loc())
    return undefined
  }
  cursor.next()
  cursor.next()
  return toSeconds(Number(value.value), unit.value)
}

// Inside a set group `m` means metres (`8x100m`); in a duration it means
// minutes (`rest: 2m`). The two never meet: durations are only read where a
// distance makes no sense.
function isDurationUnit(unit: string): boolean {
  return unit === 's' || unit === 'min' || unit === 'm' || unit === 'h'
}

function toSeconds(value: number, unit: string): number {
  if (unit === 'h') return value * 3600
  if (unit === 's') return value
  return value * 60
}

// ---------------------------------------------------------------------------
// Progressions
// ---------------------------------------------------------------------------

function parseProgression(cursor: Cursor, ctx: ParseCtx, loc: Loc): Progression {
  const head = cursor.peek()
  if (head?.type !== 'ident') {
    report(ctx, 'Expected `none`, `lp(...)`, `dp(...)`, `sum(...)` or `custom(...)`.', loc)
    return { kind: 'none', loc }
  }
  cursor.next()

  switch (head.value) {
    case 'none':
      return { kind: 'none', loc }
    case 'lp':
      return parseLp(cursor, ctx, loc)
    case 'dp':
      return parseDp(cursor, ctx, loc)
    case 'sum':
      return parseSum(cursor, ctx, loc)
    case 'custom':
      return parseCustom(cursor, ctx, loc)
    default:
      report(ctx, `Unknown progression \`${head.value}\`. Use none, lp, dp, sum or custom.`, head.loc)
      return { kind: 'none', loc }
  }
}

/** Reads the comma-separated arguments of `lp(...)` and friends. */
function parseArgs(cursor: Cursor, ctx: ParseCtx): Literal[] {
  if (!cursor.eat('(')) {
    report(ctx, 'Expected `(` after the progression name.', cursor.loc())
    return []
  }
  const args: Literal[] = []
  while (!cursor.atEnd() && cursor.peek()?.value !== ')') {
    if (cursor.eat(',')) continue
    const literal = parseLiteral(cursor)
    if (literal) args.push(literal)
    else {
      report(ctx, 'Expected a number or a weight.', cursor.loc())
      cursor.next()
    }
  }
  if (!cursor.eat(')')) report(ctx, 'Expected `)`.', cursor.loc())
  return args
}

function parseLiteral(cursor: Cursor): Literal | undefined {
  const negative = cursor.peek()?.value === '-' && cursor.peek(1)?.type === 'number'
  if (negative) cursor.next()
  const token = cursor.peek()
  if (token?.type !== 'number') return undefined
  cursor.next()
  const value = negative ? -Number(token.value) : Number(token.value)
  const unit = cursor.peek()
  if (unit?.type === 'unit') {
    if (unit.value === 'kg' || unit.value === 'lb') {
      cursor.next()
      return { type: 'weight', value: weight(value, unit.value), loc: token.loc }
    }
    if (unit.value === '%') {
      cursor.next()
      return { type: 'percent', value: percent(value), loc: token.loc }
    }
    // `s`/`min` inside a script are plain second counts (`timers[1] = 60s`).
    cursor.next()
    return { type: 'number', value: toSeconds(value, unit.value), loc: token.loc }
  }
  return { type: 'number', value, loc: token.loc }
}

function literalToWeightExpr(literal: Literal | undefined, loc: Loc): WeightExpr {
  if (!literal) return { kind: 'absolute', value: 0, unit: 'kg', loc }
  if (literal.type === 'weight') {
    return { kind: 'absolute', value: literal.value.value, unit: literal.value.unit, loc: literal.loc }
  }
  if (literal.type === 'percent') return { kind: 'percent', value: literal.value.value, loc: literal.loc }
  return { kind: 'absolute', value: literal.value, unit: 'kg', loc: literal.loc }
}

function literalNumber(literal: Literal | undefined, fallback: number): number {
  if (!literal) return fallback
  if (literal.type === 'number') return literal.value
  return literal.value.value
}

/** `lp(inc)` or the full `lp(inc, successes, counter, deload, failures, counter)`. */
function parseLp(cursor: Cursor, ctx: ParseCtx, loc: Loc): Progression {
  const args = parseArgs(cursor, ctx)
  if (args.length === 0) report(ctx, '`lp(...)` needs at least an increment, e.g. `lp(5kg)`.', loc)
  const increment = literalToWeightExpr(args[0], loc)
  const zeroUnit: Unit = increment.kind === 'absolute' ? increment.unit : 'kg'
  return {
    kind: 'lp',
    args: {
      increment,
      successesRequired: literalNumber(args[1], 1),
      successCounter: literalNumber(args[2], 0),
      deload: args[3] ? literalToWeightExpr(args[3], loc) : { kind: 'absolute', value: 0, unit: zeroUnit, loc },
      failuresRequired: literalNumber(args[4], 0),
      failureCounter: literalNumber(args[5], 0),
    },
    loc,
  }
}

function parseDp(cursor: Cursor, ctx: ParseCtx, loc: Loc): Progression {
  const args = parseArgs(cursor, ctx)
  if (args.length < 3) report(ctx, '`dp(...)` needs an increment, a min and a max rep count.', loc)
  return {
    kind: 'dp',
    args: {
      increment: literalToWeightExpr(args[0], loc),
      minReps: literalNumber(args[1], 1),
      maxReps: literalNumber(args[2], literalNumber(args[1], 1)),
    },
    loc,
  }
}

function parseSum(cursor: Cursor, ctx: ParseCtx, loc: Loc): Progression {
  const args = parseArgs(cursor, ctx)
  if (args.length < 2) report(ctx, '`sum(...)` needs a target rep total and an increment.', loc)
  return {
    kind: 'sum',
    args: { target: literalNumber(args[0], 0), increment: literalToWeightExpr(args[1], loc) },
    loc,
  }
}

/**
 * `...t1: Squat`, `...Squat[1]`, `...Squat[2:1]`, with the leading `...` already
 * in front of the cursor. One bracket number is a day, two are week and day.
 */
function parseReuseRef(cursor: Cursor, ctx: ParseCtx): ReuseRef | undefined {
  const start = cursor.loc()
  if (!cursor.eat('...')) return undefined

  // The name runs to `[` or the end — it may contain spaces ('Lat Pulldown') and
  // an optional `label:` prefix, so it is read as text rather than as tokens.
  const parts: string[] = []
  while (!cursor.atEnd() && cursor.peek()!.value !== '[' && cursor.peek()!.value !== '}') {
    parts.push(cursor.next()!.value)
  }

  const raw = parts
    .join(' ')
    .replace(/\s*:\s*/g, ': ')
    .trim()
  if (!raw) {
    report(ctx, 'Expected an exercise name after `...`.', start)
    return undefined
  }

  const colon = raw.indexOf(':')
  const label = colon === -1 ? undefined : raw.slice(0, colon).trim()
  const name = (colon === -1 ? raw : raw.slice(colon + 1)).trim()

  const ref: ReuseRef = { name, loc: start }
  if (label) ref.label = label

  if (cursor.eat('[')) {
    const numbers: number[] = []
    while (!cursor.atEnd() && cursor.peek()!.value !== ']') {
      const token = cursor.next()!
      if (token.type === 'number') numbers.push(Number(token.value))
    }
    if (!cursor.eat(']')) report(ctx, 'Expected `]`.', cursor.loc())

    if (numbers.length === 1) ref.day = numbers[0]
    else if (numbers.length >= 2) {
      ref.week = numbers[0]
      ref.day = numbers[1]
    }
  }

  return ref
}

function parseCustom(cursor: Cursor, ctx: ParseCtx, loc: Loc): Progression {
  const stateInit: StateInit[] = []

  if (!cursor.eat('(')) {
    report(ctx, 'Expected `(` after `custom`.', cursor.loc())
  } else {
    while (!cursor.atEnd() && cursor.peek()?.value !== ')') {
      if (cursor.eat(',')) continue
      const name = cursor.peek()
      if (name?.type !== 'ident') {
        report(ctx, 'Expected a state variable name, e.g. `custom(inc: 5kg)`.', cursor.loc())
        cursor.next()
        continue
      }
      cursor.next()
      if (!cursor.eat(':')) {
        report(ctx, `Expected \`:\` after \`${name.value}\`.`, cursor.loc())
        continue
      }
      const value = parseLiteral(cursor)
      if (!value) {
        report(ctx, `Expected a value for \`${name.value}\`.`, cursor.loc())
        continue
      }
      stateInit.push({ name: name.value, value, loc: name.loc })
    }
    if (!cursor.eat(')')) report(ctx, 'Expected `)`.', cursor.loc())
  }

  // `custom(...) { ...t1: Squat }` — single braces, and a reference instead of a
  // body. The script comes from there; `stateInit` above stays this line's own.
  if (cursor.peek()?.value === '{' && cursor.peek(1)?.value === '...') {
    cursor.next()
    const reuseFrom = parseReuseRef(cursor, ctx)
    if (!cursor.eat('}')) report(ctx, 'Expected `}` after the reused exercise.', cursor.loc())
    return reuseFrom
      ? { kind: 'custom', stateInit, script: [], reuseFrom, loc }
      : { kind: 'custom', stateInit, script: [], loc }
  }

  if (!cursor.eat('{~')) {
    report(ctx, 'Expected a `{~ ... ~}` script after `custom(...)`.', cursor.loc())
    return { kind: 'custom', stateInit, script: [], loc }
  }

  const body = cursor.peek()
  let script: Stmt[] = []
  if (body?.type === 'script') {
    cursor.next()
    script = parseScriptBody(body.value, body.loc, ctx)
  }
  cursor.eat('~}')

  return { kind: 'custom', stateInit, script, loc }
}

// ---------------------------------------------------------------------------
// Script language
// ---------------------------------------------------------------------------

/** Re-tokenizes a raw `{~ ~}` body and moves every position into the enclosing file. */
function parseScriptBody(source: string, start: Loc, ctx: ParseCtx): Stmt[] {
  const { tokens, diagnostics } = tokenize(source)
  for (const diagnostic of diagnostics) {
    const loc = offsetLoc({ line: diagnostic.line, col: diagnostic.col }, start.line, start.col)
    ctx.diagnostics.push(createDiagnostic(diagnostic.message, loc, ctx.lineAt(loc.line), diagnostic.severity))
  }
  return parseStatements(new Cursor(offsetTokens(tokens, start.line, start.col)), ctx, null)
}

function offsetLoc(loc: Loc, startLine: number, startCol: number): Loc {
  return loc.line === 1
    ? { line: startLine, col: startCol + loc.col - 1 }
    : { line: startLine + loc.line - 1, col: loc.col }
}

function offsetTokens(tokens: Token[], startLine: number, startCol: number): Token[] {
  return tokens
    .filter((token) => token.type !== 'newline' && token.type !== 'eof')
    .map((token) => ({ ...token, loc: offsetLoc(token.loc, startLine, startCol) }))
}

function parseStatements(cursor: Cursor, ctx: ParseCtx, terminator: string | null): Stmt[] {
  const statements: Stmt[] = []

  while (!cursor.atEnd()) {
    if (terminator && cursor.peek()?.value === terminator) break
    if (cursor.eat(';')) continue

    const before = cursor.pos
    const statement = parseStatement(cursor, ctx)
    if (statement) statements.push(statement)
    if (cursor.pos === before) cursor.next() // never spin on a token nobody consumed
  }

  return statements
}

function parseStatement(cursor: Cursor, ctx: ParseCtx): Stmt | null {
  const token = cursor.peek()
  if (!token) return null

  if (token.type === 'ident' && token.value === 'if') return parseIf(cursor, ctx)
  if (token.type === 'ident' && token.value === 'for') return parseForIn(cursor, ctx)

  const expression = parseExpression(cursor, ctx)
  if (!expression) {
    report(ctx, `Unexpected \`${token.value}\` in a progression script.`, token.loc)
    cursor.next()
    return null
  }

  const operator = cursor.peek()
  if (operator && ASSIGN_OPS.has(operator.value)) {
    cursor.next()
    const value = parseExpression(cursor, ctx)
    if (!value) {
      report(ctx, 'Expected a value on the right-hand side of the assignment.', cursor.loc())
      return null
    }
    if (expression.type !== 'var' && expression.type !== 'index') {
      report(ctx, 'Only variables can be assigned to.', expression.loc)
      return null
    }
    checkAssignable(expression, ctx)
    const assignment: AssignStmt = {
      type: 'assign',
      op: operator.value as AssignOp,
      target: expression,
      value,
      loc: expression.loc,
    }
    return assignment
  }

  return { type: 'expr', expression, loc: expression.loc }
}

function checkAssignable(target: VarRef | IndexExpr, ctx: ParseCtx): void {
  const reference = target.type === 'index' ? target.target : target
  if (reference.scope !== 'bare') return
  // An unknown name was already reported; naming it read-only on top is noise.
  if (KNOWN_VARS.has(reference.name) && !WRITABLE.has(reference.name)) {
    report(ctx, `\`${reference.name}\` is read-only and cannot be assigned.`, reference.loc)
  }
}

function parseBlock(cursor: Cursor, ctx: ParseCtx): Stmt[] {
  if (!cursor.eat('{')) {
    report(ctx, 'Expected `{`.', cursor.loc())
    return []
  }
  const body = parseStatements(cursor, ctx, '}')
  if (!cursor.eat('}')) report(ctx, 'Expected `}`.', cursor.loc())
  return body
}

function parseIf(cursor: Cursor, ctx: ParseCtx): IfStmt | null {
  const loc = cursor.loc()
  cursor.next()
  const branches: IfStmt['branches'] = []

  const condition = parseCondition(cursor, ctx)
  if (!condition) return null
  branches.push({ condition, body: parseBlock(cursor, ctx), loc })

  let elseBody: Stmt[] | undefined
  while (cursor.peek()?.value === 'else') {
    const elseLoc = cursor.loc()
    cursor.next()
    if (cursor.peek()?.value === 'if') {
      cursor.next()
      const nextCondition = parseCondition(cursor, ctx)
      if (!nextCondition) break
      branches.push({ condition: nextCondition, body: parseBlock(cursor, ctx), loc: elseLoc })
      continue
    }
    elseBody = parseBlock(cursor, ctx)
    break
  }

  const statement: IfStmt = { type: 'if', branches, loc }
  if (elseBody) statement.elseBody = elseBody
  return statement
}

function parseCondition(cursor: Cursor, ctx: ParseCtx): Expr | null {
  if (!cursor.eat('(')) {
    report(ctx, 'Expected `(` after `if`.', cursor.loc())
    return null
  }
  const condition = parseExpression(cursor, ctx)
  if (!condition) {
    report(ctx, 'Expected a condition.', cursor.loc())
    return null
  }
  if (!cursor.eat(')')) report(ctx, 'Expected `)`.', cursor.loc())
  return condition
}

function parseForIn(cursor: Cursor, ctx: ParseCtx): ForInStmt | null {
  const loc = cursor.loc()
  cursor.next()
  if (!cursor.eat('(')) {
    report(ctx, 'Expected `(` after `for`.', cursor.loc())
    return null
  }
  const variable = parseExpression(cursor, ctx)
  if (!variable || variable.type !== 'var' || variable.scope !== 'var') {
    report(ctx, 'A `for` loop variable must be a `var.name`, e.g. `for (var.i in completedReps)`.', cursor.loc())
    return null
  }
  if (cursor.peek()?.value !== 'in') {
    report(ctx, 'Expected `in`.', cursor.loc())
    return null
  }
  cursor.next()
  const iterable = parseExpression(cursor, ctx)
  if (!iterable) {
    report(ctx, 'Expected something to iterate over.', cursor.loc())
    return null
  }
  if (!cursor.eat(')')) report(ctx, 'Expected `)`.', cursor.loc())
  return { type: 'forIn', variable, iterable, body: parseBlock(cursor, ctx), loc }
}

function parseExpression(cursor: Cursor, ctx: ParseCtx): Expr | null {
  return parseTernary(cursor, ctx)
}

function parseTernary(cursor: Cursor, ctx: ParseCtx): Expr | null {
  const condition = parseBinary(cursor, ctx, 0)
  if (!condition) return null
  if (cursor.peek()?.value !== '?') return condition

  cursor.next()
  const ifTrue = parseTernary(cursor, ctx)
  if (!ifTrue) return null
  if (!cursor.eat(':')) {
    report(ctx, 'Expected `:` in a ternary.', cursor.loc())
    return null
  }
  const ifFalse = parseTernary(cursor, ctx)
  if (!ifFalse) return null
  return { type: 'ternary', condition, ifTrue, ifFalse, loc: condition.loc }
}

function parseBinary(cursor: Cursor, ctx: ParseCtx, level: number): Expr | null {
  if (level >= BINARY_PRECEDENCE.length) return parseUnary(cursor, ctx)

  let left = parseBinary(cursor, ctx, level + 1)
  if (!left) return null

  for (;;) {
    const token = cursor.peek()
    const op =
      token && (BINARY_PRECEDENCE[level].ops as string[]).includes(token.value) ? (token.value as BinaryOp) : undefined
    if (!op) return left
    cursor.next()
    const right = parseBinary(cursor, ctx, level + 1)
    if (!right) return null
    left = { type: 'binary', op, left, right, loc: left.loc }
  }
}

function parseUnary(cursor: Cursor, ctx: ParseCtx): Expr | null {
  const token = cursor.peek()
  if (token?.value === '-' || token?.value === '!') {
    cursor.next()
    const operand = parseUnary(cursor, ctx)
    if (!operand) return null
    return { type: 'unary', op: token.value, operand, loc: token.loc }
  }
  return parsePrimary(cursor, ctx)
}

function parsePrimary(cursor: Cursor, ctx: ParseCtx): Expr | null {
  const token = cursor.peek()
  if (!token) return null

  if (token.value === '(') {
    cursor.next()
    const inner = parseExpression(cursor, ctx)
    if (!cursor.eat(')')) report(ctx, 'Expected `)`.', cursor.loc())
    return inner
  }

  if (token.type === 'number') return parseLiteral(cursor) ?? null

  if (token.type === 'ident') {
    cursor.next()

    if (cursor.peek()?.value === '(') {
      cursor.next()
      const args: Expr[] = []
      while (!cursor.atEnd() && cursor.peek()?.value !== ')') {
        if (cursor.eat(',')) continue
        const argument = parseExpression(cursor, ctx)
        if (!argument) break
        args.push(argument)
      }
      if (!cursor.eat(')')) report(ctx, 'Expected `)`.', cursor.loc())
      if (!BUILTINS.has(token.value)) {
        report(ctx, `Unknown function \`${token.value}\`.`, token.loc)
      }
      return { type: 'call', name: token.value, args, loc: token.loc }
    }

    const reference = varRefFrom(token.value, token.loc, ctx)

    if (cursor.peek()?.value === '[') {
      cursor.next()
      const index = parseExpression(cursor, ctx)
      if (!index) {
        report(ctx, 'Expected an index.', cursor.loc())
        return reference
      }
      if (!cursor.eat(']')) report(ctx, 'Expected `]`.', cursor.loc())
      if (reference.scope === 'bare' && !ARRAYS.has(reference.name)) {
        report(ctx, `\`${reference.name}\` holds a single value and cannot be indexed.`, token.loc)
      }
      return { type: 'index', target: reference, index, loc: token.loc }
    }

    return reference
  }

  return null
}

function varRefFrom(raw: string, loc: Loc, ctx: ParseCtx): VarRef {
  const dot = raw.indexOf('.')
  if (dot !== -1) {
    const prefix = raw.slice(0, dot)
    const name = raw.slice(dot + 1)
    if (prefix === 'state' || prefix === 'var') return { type: 'var', scope: prefix as VarScope, name, loc }
    report(ctx, `Unknown namespace \`${prefix}\`. Only \`state.\` and \`var.\` exist.`, loc)
    return { type: 'var', scope: 'var', name, loc }
  }

  // Aliases are resolved here, at the only place a bare name enters the AST, so
  // the evaluator, the serializer and every downstream check keep dealing with
  // exactly one spelling per variable.
  const name = VAR_ALIASES[raw] ?? raw

  if (!KNOWN_VARS.has(name)) {
    report(
      ctx,
      `Unknown variable \`${raw}\`. Use \`state.${raw}\` to persist it or \`var.${raw}\` for a scratch value.`,
      loc,
    )
  }
  return { type: 'var', scope: 'bare', name, loc }
}
