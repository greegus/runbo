import { tokenize } from '../tokenizer'
import { gzclpBuiltin, misc } from './fixtures'

/** `type:value` pairs of everything but the line structure — compact and readable in a diff. */
function shapes(source: string): string[] {
  return tokenize(source)
    .tokens.filter((token) => token.type !== 'newline' && token.type !== 'eof')
    .map((token) => `${token.type}:${token.value}`)
}

function newlines(source: string): number {
  return tokenize(source).tokens.filter((token) => token.type === 'newline').length
}

describe('structure', () => {
  it('lexes week and day headers', () => {
    expect(shapes('# Week 1\n## A1')).toEqual(['punct:#', 'ident:Week', 'number:1', 'punct:##', 'ident:A1'])
  })

  it('keeps the marker on comments so the parser can tell them apart', () => {
    expect(shapes('// visible\n/// internal')).toEqual(['comment:// visible', 'comment:/// internal'])
  })

  it('ends every physical line with a newline token', () => {
    expect(newlines('a\nb\nc')).toBe(3)
  })

  it('joins a line continued with a trailing backslash', () => {
    expect(newlines('Squat / 5x5 / \\\n  100kg')).toBe(1)
    expect(shapes('Squat / 5x5 / \\\n  100kg')).toContain('number:100')
  })

  it('keeps a backslash that is not at the end of the line', () => {
    expect(shapes('a \\ b')).toEqual(['ident:a', 'punct:\\', 'ident:b'])
  })

  it('returns the source lines for diagnostics', () => {
    expect(tokenize('one\ntwo').lines).toEqual(['one', 'two'])
  })

  it('tracks line and column, both 1-based', () => {
    const { tokens } = tokenize('Squat\n  100kg')
    expect(tokens[0].loc).toEqual({ line: 1, col: 1 })
    expect(tokens[2].loc).toEqual({ line: 2, col: 3 })
    expect(tokens[3].loc).toEqual({ line: 2, col: 6 })
  })

  it('lexes the separators of an exercise line', () => {
    expect(shapes('T1: Squat, Barbell / 3x8')).toEqual([
      'ident:T1',
      'punct::',
      'ident:Squat',
      'punct:,',
      'ident:Barbell',
      'operator:/',
      'number:3',
      'punct:x',
      'number:8',
    ])
  })
})

describe('numbers, units and set notation', () => {
  it('attaches every supported unit to the number in front of it', () => {
    expect(shapes('100kg 45lb 80% 60s 3min 100m 5km')).toEqual([
      'number:100',
      'unit:kg',
      'number:45',
      'unit:lb',
      'number:80',
      'unit:%',
      'number:60',
      'unit:s',
      'number:3',
      'unit:min',
      'number:100',
      'unit:m',
      'number:5',
      'unit:km',
    ])
  })

  it('reads a decimal weight as one number', () => {
    expect(shapes('2.5kg')).toEqual(['number:2.5', 'unit:kg'])
  })

  it('does not lex `40min` as `40m` followed by an identifier', () => {
    expect(shapes('40min')).toEqual(['number:40', 'unit:min'])
  })

  it('only attaches a unit that directly follows a number', () => {
    expect(shapes("Farmer's Walk")).toEqual(["ident:Farmer's", 'ident:Walk'])
    expect(shapes('Squat kg')).toEqual(['ident:Squat', 'ident:kg'])
  })

  it('treats `x` between two numbers as structure', () => {
    expect(shapes('5x3')).toEqual(['number:5', 'punct:x', 'number:3'])
    expect(shapes('3x15')).toEqual(['number:3', 'punct:x', 'number:15'])
  })

  it('leaves an `x` that is part of a name alone', () => {
    expect(shapes('Box Jump')).toEqual(['ident:Box', 'ident:Jump'])
    expect(shapes('x')).toEqual(['ident:x'])
  })

  it('lexes rep ranges and the AMRAP marker', () => {
    expect(shapes('3x8-12+')).toEqual(['number:3', 'punct:x', 'number:8', 'operator:-', 'number:12', 'operator:+'])
  })

  it('lexes RPE and zone markers', () => {
    expect(shapes('@8+')).toEqual(['operator:@', 'number:8', 'operator:+'])
    expect(shapes('@Z2')).toEqual(['operator:@', 'ident:Z2'])
  })

  it('lexes both timer forms', () => {
    expect(shapes('60s|30s')).toEqual(['number:60', 'unit:s', 'punct:|', 'number:30', 'unit:s'])
    expect(shapes('60s|?')).toEqual(['number:60', 'unit:s', 'punct:|', 'operator:?'])
  })

  it('lexes a set label', () => {
    expect(shapes('(Top set)')).toEqual(['punct:(', 'ident:Top', 'ident:set', 'punct:)'])
  })

  it('lexes `?+` as one ask-weight marker', () => {
    expect(shapes('?+')).toEqual(['operator:?+'])
    expect(shapes('? +')).toEqual(['operator:?', 'operator:+'])
  })
})

describe('script blocks', () => {
  it('captures the body raw, between the delimiters', () => {
    expect(shapes('{~ weights += 5kg ~}')).toEqual(['punct:{~', 'script: weights += 5kg ', 'punct:~}'])
  })

  it('keeps a multi-line body verbatim and points at its first character', () => {
    const { tokens } = tokenize('progress: custom() {~\n  weights += 5kg\n~}')
    const script = tokens.find((token) => token.type === 'script')
    expect(script?.value).toBe('\n  weights += 5kg\n')
    expect(script?.loc).toEqual({ line: 1, col: 22 })
  })

  it('swallows the newlines inside a block, so the block stays one logical line', () => {
    expect(newlines('a {~\n\n~}')).toBe(1)
  })

  it('reports an unterminated block and still returns the body', () => {
    const { tokens, diagnostics } = tokenize('{~ weights += 5kg')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].message).toMatch(/Unterminated/)
    expect(tokens.find((token) => token.type === 'script')?.value).toBe(' weights += 5kg')
  })
})

describe('script expressions', () => {
  it('lexes the multi-character operators', () => {
    expect(shapes('>= <= == != && || += -= *= /= !')).toEqual([
      'operator:>=',
      'operator:<=',
      'operator:==',
      'operator:!=',
      'operator:&&',
      'operator:||',
      'operator:+=',
      'operator:-=',
      'operator:*=',
      'operator:/=',
      'operator:!',
    ])
  })

  it('keeps a scoped name in one token', () => {
    expect(shapes('state.inc + var.i')).toEqual(['ident:state.inc', 'operator:+', 'ident:var.i'])
  })

  it('lexes an indexed read', () => {
    expect(shapes('completedReps[1]')).toEqual(['ident:completedReps', 'punct:[', 'number:1', 'punct:]'])
  })
})

describe('robustness', () => {
  it('reports an unexpected character and keeps going', () => {
    const { tokens, diagnostics } = tokenize('Squat § 5x5')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ line: 1, col: 7, sourceLine: 'Squat § 5x5' })
    expect(tokens.map((token) => token.value)).toContain('5')
  })

  it('never reports anything for the shipped fixtures', () => {
    expect(tokenize(gzclpBuiltin).diagnostics).toEqual([])
    expect(tokenize(misc).diagnostics).toEqual([])
  })

  it('handles an empty source', () => {
    expect(tokenize('').tokens.map((token) => token.type)).toEqual(['eof'])
  })
})
