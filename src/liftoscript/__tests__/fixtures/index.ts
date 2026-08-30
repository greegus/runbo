/**
 * Shared parser/evaluator/serializer fixtures. Kept as `.txt` so they stay
 * copy-pasteable into the program editor and readable in a diff.
 */

import type { UnsupportedConstructId } from '../../diagnostics'
import cardio from './cardio.txt?raw'
import gzclpBuiltin from './gzclp-builtin.txt?raw'
import gzclpLiftosaurReal from './gzclp-liftosaur-real.txt?raw'
import gzclpStock from './gzclp-stock.txt?raw'
import misc from './misc.txt?raw'
import unsupported from './unsupported.txt?raw'

export { cardio, gzclpBuiltin, gzclpLiftosaurReal, gzclpStock, misc, unsupported }

export const fixtures = { cardio, gzclpBuiltin, gzclpLiftosaurReal, gzclpStock, misc, unsupported }

/**
 * Which diagnostic `unsupported.txt` must produce, and on which line. The `///`
 * note directly above each line in the fixture names the same id.
 */
export const EXPECTED_UNSUPPORTED: { id: UnsupportedConstructId; line: number }[] = [
  { id: 'updateCustom', line: 7 },
  { id: 'superset', line: 9 },
  { id: 'weekRepetition', line: 11 },
  { id: 'exerciseVariations', line: 13 },
  { id: 'crossExerciseState', line: 15 },
  { id: 'descriptionIndex', line: 17 },
  { id: 'bodyweightMath', line: 19 },
]

/**
 * Fixtures that are SUPPOSED to fail parsing, so the round-trip sweeps skip
 * them: a program the parser rejects has no AST to serialize back. Named by the
 * property rather than one hardcoded name, so adding another failing fixture
 * does not silently break the sweeps.
 */
export const PROGRAMS_WITH_ERRORS = new Set(['unsupported', 'gzclpLiftosaurReal'])
