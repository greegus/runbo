import { parseProgram } from '../parser'
import { serializeProgram } from '../serialize'
import { fixtures, PROGRAMS_WITH_ERRORS } from './fixtures'

/**
 * The serializer normalises (standalone weight segments move onto the set
 * groups, continued lines collapse, sections get a fixed order), so the text is
 * allowed to change — the AST is not. Positions move with the text, so they are
 * the one thing dropped before comparing.
 */
function stripLoc(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLoc)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'loc')
      .map(([key, entry]) => [key, stripLoc(entry)]),
  )
}

describe('parse → serialize → parse is stable', () => {
  for (const [name, source] of Object.entries(fixtures)) {
    it(`round-trips ${name}`, () => {
      const first = parseProgram(source)

      // Some fixtures exist to produce diagnostics; they have nothing to
      // round-trip. Assert the failure was expected rather than just skipping,
      // so a fixture that starts failing by accident still fails the suite.
      if (first.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        expect(PROGRAMS_WITH_ERRORS.has(name), `${name} produced errors`).toBe(true)
        return
      }

      expect(PROGRAMS_WITH_ERRORS.has(name), `${name} parses cleanly`).toBe(false)

      const text = serializeProgram(first.program)
      const second = parseProgram(text)

      expect(second.diagnostics).toEqual([])
      expect(stripLoc(second.program)).toEqual(stripLoc(first.program))
      // and the text itself is a fixed point, so opening the editor twice is a no-op
      expect(serializeProgram(second.program)).toBe(text)
    })
  }
})
