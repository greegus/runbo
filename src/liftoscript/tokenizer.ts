/**
 * Lexer for both halves of the notation: the line-oriented program syntax and
 * the expression language inside `{~ ~}`. One tokenizer serves both because the
 * two share literals (`5kg`, `75%`, `3min`) and because a `{~ ~}` block can
 * start mid-line.
 */

import { createDiagnostic, type Diagnostic } from './diagnostics'
import type { Loc } from './types'

export type TokenType =
  /** `12`, `2.5` — the unit, if any, follows as a separate `unit` token. */
  | 'number'
  /** `Squat`, `weights`, `state.inc`, `custom` — anything identifier-like. */
  | 'ident'
  /** `kg`, `lb`, `%`, `s`, `min`, `m`, `km` when they directly follow a number. */
  | 'unit'
  /** `+ - * / % > < >= <= == != && || ! = += -= *= /= ? ?+ : @` */
  | 'operator'
  /** `( ) { } [ ] , : | . x # ## \` and the script delimiters `{~` `~}`. */
  | 'punct'
  /** `// text` and `/// text`; `value` keeps the marker so the parser can tell them apart. */
  | 'comment'
  /** The raw body of a `{~ ~}` block, handed to the script parser untouched. */
  | 'script'
  /** End of a logical line — suppressed after a trailing `\` continuation. */
  | 'newline'
  | 'eof'

export interface Token {
  type: TokenType
  value: string
  loc: Loc
}

export interface TokenizeResult {
  tokens: Token[]
  diagnostics: Diagnostic[]
  /** Source split into lines, so diagnostics can quote the offending one. */
  lines: string[]
}

/** Longest first: `40min` must not lex as `40m` followed by the identifier `in`. */
const UNIT_WORDS = ['min', 'km', 'kg', 'lb', 'h', 'm', 's']

const TWO_CHAR_OPERATORS = ['>=', '<=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '?+']

const ONE_CHAR_OPERATORS = '+-*/%><!=?@'

const PUNCTUATION = '(){}[],:|.'

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}

function isIdentStart(char: string): boolean {
  return /[A-Za-z_]/.test(char)
}

function isIdentPart(char: string): boolean {
  return /[A-Za-z0-9_']/.test(char)
}

/**
 * Turns source into tokens. Never throws: an unterminated `{~` block or a stray
 * character produces a diagnostic and tokenizing continues on the next line, so
 * one bad line cannot hide the rest of a program's problems.
 *
 * Rules:
 * - a `\` immediately before the newline joins the next line into the same
 *   logical line (no `newline` token is emitted);
 * - the body of `{~ ~}` is captured verbatim as a single `script` token, so the
 *   script parser can re-tokenize it with its own positions;
 * - `x` between two numbers (`5x3`) is punct, not an identifier;
 * - a unit only attaches to a number that directly precedes it (`5kg`), so an
 *   exercise named `Farmer's Walk` never lexes as a unit.
 */
export function tokenize(source: string): TokenizeResult {
  const lines = source.split('\n').map((line) => line.replace(/\r$/, ''))
  const tokens: Token[] = []
  const diagnostics: Diagnostic[] = []

  let index = 0
  let line = 1
  let col = 1

  function at(offset = 0): string {
    return source[index + offset] ?? ''
  }

  function advance(count = 1): void {
    for (let i = 0; i < count && index < source.length; i++) {
      if (source[index] === '\n') {
        line += 1
        col = 1
      } else {
        col += 1
      }
      index += 1
    }
  }

  function push(type: TokenType, value: string, loc: Loc): void {
    tokens.push({ type, value, loc })
  }

  function report(message: string, loc: Loc): void {
    diagnostics.push(createDiagnostic(message, loc, lines[loc.line - 1] ?? ''))
  }

  function previous(): Token | undefined {
    return tokens[tokens.length - 1]
  }

  while (index < source.length) {
    const char = at()
    const loc: Loc = { line, col }

    if (char === '\n') {
      push('newline', '\n', loc)
      advance()
      continue
    }

    if (char === ' ' || char === '\t' || char === '\r') {
      advance()
      continue
    }

    // `//` and `///` swallow the rest of the physical line, marker included.
    if (char === '/' && at(1) === '/') {
      const end = source.indexOf('\n', index)
      const text = (end === -1 ? source.slice(index) : source.slice(index, end)).replace(/\r$/, '')
      push('comment', text, loc)
      advance(text.length)
      continue
    }

    if (char === '#') {
      const marker = at(1) === '#' ? '##' : '#'
      push('punct', marker, loc)
      advance(marker.length)
      continue
    }

    if (char === '{' && at(1) === '~') {
      push('punct', '{~', loc)
      advance(2)
      const bodyLoc: Loc = { line, col }
      const end = source.indexOf('~}', index)
      const body = end === -1 ? source.slice(index) : source.slice(index, end)
      push('script', body, bodyLoc)
      advance(body.length)
      if (end === -1) {
        report('Unterminated `{~` script block — add a closing `~}`.', loc)
      } else {
        push('punct', '~}', { line, col })
        advance(2)
      }
      continue
    }

    if (char === '~' && at(1) === '}') {
      push('punct', '~}', loc)
      advance(2)
      continue
    }

    // A backslash followed by nothing but the line break glues the next
    // physical line onto this logical one.
    if (char === '\\') {
      let ahead = index + 1
      while (ahead < source.length && (source[ahead] === ' ' || source[ahead] === '\t' || source[ahead] === '\r')) {
        ahead += 1
      }
      if (ahead >= source.length || source[ahead] === '\n') {
        advance(ahead - index + (source[ahead] === '\n' ? 1 : 0))
        continue
      }
      push('punct', '\\', loc)
      advance()
      continue
    }

    if (isDigit(char)) {
      let length = 0
      while (isDigit(at(length))) length += 1
      if (at(length) === '.' && isDigit(at(length + 1))) {
        length += 1
        while (isDigit(at(length))) length += 1
      }
      const number = source.slice(index, index + length)
      push('number', number, loc)
      advance(length)

      if (at() === '%') {
        push('unit', '%', { line, col })
        advance()
        continue
      }
      const word = UNIT_WORDS.find(
        (unit) => source.startsWith(unit, index) && !isIdentPart(at(unit.length)) && at(unit.length) !== '.',
      )
      if (word) {
        push('unit', word, { line, col })
        advance(word.length)
      }
      continue
    }

    // `5x3`: the multiplier is structure, not a name — and it has to be caught
    // before the identifier scanner swallows `x3` whole.
    if (char === 'x' && previous()?.type === 'number' && isDigit(at(1))) {
      push('punct', 'x', loc)
      advance()
      continue
    }

    if (isIdentStart(char)) {
      let length = 0
      while (isIdentPart(at(length))) length += 1
      // `state.inc` / `var.i` are one name; a dot only continues an identifier
      // when a letter follows it, so `1.5` and `...Squat` stay separate tokens.
      while (at(length) === '.' && isIdentStart(at(length + 1))) {
        length += 1
        while (isIdentPart(at(length))) length += 1
      }
      push('ident', source.slice(index, index + length), loc)
      advance(length)
      continue
    }

    // `...Name` reuse. One token rather than three dots, because every parser
    // that had to spell it as "three consecutive puncts" would also have to
    // guard against `1.5` and `state.inc` arriving the same way.
    if (source.startsWith('...', index)) {
      push('punct', '...', loc)
      advance(3)
      continue
    }

    const pair = source.slice(index, index + 2)
    if (TWO_CHAR_OPERATORS.includes(pair)) {
      push('operator', pair, loc)
      advance(2)
      continue
    }

    if (ONE_CHAR_OPERATORS.includes(char)) {
      push('operator', char, loc)
      advance()
      continue
    }

    if (PUNCTUATION.includes(char)) {
      push('punct', char, loc)
      advance()
      continue
    }

    report(`Unexpected character \`${char}\`.`, loc)
    advance()
  }

  if (previous() && previous()?.type !== 'newline') push('newline', '\n', { line, col })
  push('eof', '', { line, col })

  return { tokens, diagnostics, lines }
}
