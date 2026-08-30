/**
 * Diagnostics for everything the engine refuses to guess about.
 *
 * An imported program that quietly loses a construct would silently prescribe
 * the wrong training, so every unsupported construct has one exact, actionable
 * message here — the parser must not invent its own wording for these.
 */

import type { Loc } from './types'

export type Severity = 'error' | 'warning'

export interface Diagnostic {
  line: number // 1-based
  col: number // 1-based
  message: string
  sourceLine: string // the offending line verbatim, for the caret rendering
  severity: Severity
}

export function createDiagnostic(
  message: string,
  loc: Loc,
  sourceLine: string,
  severity: Severity = 'error',
): Diagnostic {
  return { line: loc.line, col: loc.col, message, sourceLine, severity }
}

/** Ids of the constructs we deliberately do not implement. */
export type UnsupportedConstructId =
  | 'updateCustom'
  | 'superset'
  | 'weekRepetition'
  | 'exerciseVariations'
  | 'crossExerciseState'
  | 'descriptionIndex'
  | 'bodyweightMath'

export interface UnsupportedConstruct {
  id: UnsupportedConstructId
  /** Human label for the diagnostics list UI. */
  label: string
  /** A minimal line that triggers it — used by the fixtures and the docs. */
  example: string
  /**
   * Detects the construct in a single source line. Cheap and deliberately
   * loose: the parser runs these before it tries to make sense of a line, so a
   * rejected program reports the real cause instead of a syntax error further on.
   */
  pattern: RegExp
  /** The exact message the parser must emit. */
  message: string
}

export const UNSUPPORTED_CONSTRUCTS: UnsupportedConstruct[] = [
  {
    id: 'updateCustom',
    label: 'update: custom',
    example: 'Squat / 5x5 / 100kg / update: custom() {~ weights = 100kg ~}',
    pattern: /\bupdate\s*:/,
    message:
      '`update:` blocks are not supported. Move the logic into `progress: custom(...) {~ ... ~}`, which runs after the session instead of during it.',
  },
  {
    id: 'superset',
    label: 'superset:',
    example: 'Squat / 5x5 / 100kg / superset: Bench Press',
    pattern: /\bsuperset\s*:/,
    message: 'Supersets are not supported. Write each exercise on its own line; they are performed in order.',
  },
  {
    id: 'weekRepetition',
    label: 'week repetition (Name[1-4])',
    example: 'Squat[1-4] / 5x5 / 100kg',
    pattern: /^\s*(?:T\d\s*:\s*)?[^/[\n]+\[\s*\d+\s*-\s*\d+\s*\]/,
    message:
      'Week repetition (`Name[1-4]`) is not supported. Repeat the exercise line under each `# Week` it belongs to.',
  },
  {
    id: 'exerciseVariations',
    label: 'exercise variations (A | B | C)',
    example: 'Squat / 5x5 / 100kg | Front Squat / 5x5 / 80kg',
    // A `|` that is not the separator of a set timer (`60s|30s`, `60s|?`).
    pattern: /(?<!\d(?:s|min|m|h))\|/,
    message:
      'Exercise variations (`A | B | C`) are not supported. Write each variation as its own exercise line. (`|` is only allowed inside a set timer, as in `60s|30s`.)',
  },
  {
    id: 'crossExerciseState',
    label: 'cross-exercise state (state[1].x)',
    example: 'Squat / 5x5 / 100kg / progress: custom() {~ state[1].foo = 1 ~}',
    pattern: /\bstate\s*\[/,
    message:
      'Cross-exercise state (`state[1].x`) is not supported. A progression may only read and write `state.x` of its own exercise.',
  },
  {
    id: 'descriptionIndex',
    label: 'descriptionIndex',
    example: 'Squat / 5x5 / 100kg / descriptionIndex: 2',
    pattern: /\bdescriptionIndex\b/,
    message: '`descriptionIndex` is not supported. An exercise shows the `//` comment lines directly above it.',
  },
  {
    id: 'bodyweightMath',
    label: 'bodyweight exercise math',
    example: 'Pull Up / 3x8 / bodyweight+10kg',
    pattern: /\bbodyweight\s*[+\-*/]/,
    message:
      'Bodyweight math in a set weight is not supported. Use an absolute weight or a percentage of the working weight; `bodyweight` is readable inside `progress:` scripts only.',
  },
]

const BY_ID = new Map(UNSUPPORTED_CONSTRUCTS.map((construct) => [construct.id, construct]))

/** The exact message for an unsupported construct. Throws on an unknown id. */
export function unsupportedMessage(id: UnsupportedConstructId): string {
  const construct = BY_ID.get(id)
  if (!construct) throw new Error(`unknown unsupported construct: ${id}`)
  return construct.message
}

/** Builds the diagnostic for an unsupported construct found at `loc`. */
export function unsupportedDiagnostic(id: UnsupportedConstructId, loc: Loc, sourceLine: string): Diagnostic {
  return createDiagnostic(unsupportedMessage(id), loc, sourceLine)
}

/**
 * Renders a diagnostic for a terminal or a `<pre>`:
 *
 * ```
 * 4:24 error: Supersets are not supported. …
 *   Squat / 5x5 / 100kg / superset: Bench Press
 *                         ^
 * ```
 */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const header = `${diagnostic.line}:${diagnostic.col} ${diagnostic.severity}: ${diagnostic.message}`
  if (!diagnostic.sourceLine) return header
  const caret = `${' '.repeat(Math.max(0, diagnostic.col - 1))}^`
  return `${header}\n  ${diagnostic.sourceLine}\n  ${caret}`
}
