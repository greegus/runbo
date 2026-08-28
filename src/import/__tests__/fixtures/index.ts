/**
 * Liftosaur JSON export fixtures for the import layer.
 *
 * EVERY fixture in this directory is SYNTHETIC. They were hand-built from
 * Liftosaur's published valibot schema (`src/types.ts`, commit `1f8039e`) and
 * from its migration list; no real export was available when Phase 5 was
 * written. They MUST be re-verified against a real export before anything here
 * is treated as fact — each JSON file repeats the warning in a root `_comment`
 * key, which the mapper ignores like any other unknown key.
 *
 * All start times are noon UTC so that the calendar day a fixture maps to is
 * the same in every timezone a test might run in.
 *
 * Program-side fixtures are NOT copied here: `deriveState` imports `gzclpStock`
 * and `gzclpBuiltin` from `@/liftoscript/__tests__/fixtures`.
 */

import type { ReasonId } from '../../liftosaurHistory'
import empty from './liftosaur-empty.json'
import gzclp from './liftosaur-gzclp.json'
import inProgress from './liftosaur-in-progress.json'
import legacy from './liftosaur-legacy.json'
import messy from './liftosaur-messy.json'
import nonProgram from './liftosaur-nonprogram.json'
import notAnExport from './not-an-export.csv?raw'
import truncated from './truncated-json.txt?raw'

export { empty, gzclp, inProgress, legacy, messy, nonProgram, notAnExport, truncated }

/** Every parsed export, for the "never throws on any fixture" sweep. */
export const fixtures = { gzclp, messy, legacy, inProgress, empty, nonProgram }

/** The text fixtures, which are exactly the ones that must fail to parse. */
export const rawFixtures = { truncated, notAnExport }

/**
 * What `liftosaur-messy.json` must produce, one row per record. `outcome` is
 * `'imported'` or the exact `ReasonId` the record is skipped with; the record's
 * `dayName` is what locates it, so a failure names itself.
 */
export const MESSY_EXPECTATIONS: { dayName: string; outcome: 'imported' | ReasonId }[] = [
  { dayName: 'Empty Entries', outcome: 'no-entries' },
  { dayName: 'No Sets', outcome: 'all-entries-skipped' },
  { dayName: 'Unknown Exercise', outcome: 'imported' },
  { dayName: 'Deleted Custom', outcome: 'imported' },
  { dayName: 'No Weight', outcome: 'imported' },
  { dayName: 'Null Weight', outcome: 'imported' },
  { dayName: 'Stray Progress', outcome: 'in-progress' },
  { dayName: 'Deleted Record', outcome: 'deleted' },
  { dayName: 'Duplicate First', outcome: 'imported' },
  { dayName: 'Duplicate Second', outcome: 'duplicate-workout' },
  { dayName: 'Spaced First', outcome: 'imported' },
  { dayName: 'Spaced Second', outcome: 'imported' },
  { dayName: 'Superset', outcome: 'imported' },
  { dayName: 'No Tier', outcome: 'imported' },
  { dayName: 'Bad Date', outcome: 'imported' },
  { dayName: 'No Date', outcome: 'no-usable-date' },
  { dayName: 'Zero Completed', outcome: 'imported' },
  { dayName: 'Bad Reps', outcome: 'imported' },
  { dayName: 'Warmups', outcome: 'imported' },
  { dayName: 'Unilateral', outcome: 'imported' },
  { dayName: 'Cardio Only', outcome: 'cardio-only' },
  { dayName: 'Same Id A', outcome: 'imported' },
  { dayName: 'Same Id B', outcome: 'imported' },
  { dayName: 'Scrambled', outcome: 'imported' },
  { dayName: 'Mixed Order', outcome: 'imported' },
  { dayName: 'Logged Blank', outcome: 'imported' },
  // Two more records are not in this table because `dayName` cannot locate them:
  // one is written as the lowercase `a1` (it imports as `A1`), the other carries
  // no `dayName` at all. Both have their own assertion in the spec.
]

/**
 * Which non-fatal notes `liftosaur-messy.json` must raise, and how often. The
 * spec asserts this is the COMPLETE set, so a note fired on data that does not
 * warrant one fails here rather than passing unnoticed.
 */
export const MESSY_NOTES: { reason: ReasonId; count: number }[] = [
  { reason: 'unmapped-programDay', count: 1 },
  { reason: 'unknown-exercise', count: 1 },
  { reason: 'superset-flattened', count: 2 },
  { reason: 'tier-unrecoverable', count: 1 },
  { reason: 'warmups-dropped', count: 2 },
  { reason: 'unilateral-collapsed', count: 1 },
  { reason: 'prescribed-reps-defaulted', count: 1 },
  { reason: 'bad-completed-reps', count: 1 },
  { reason: 'duplicate-id', count: 1 },
]

/** The six workouts of `liftosaur-gzclp.json`, in the order they must import. */
export const GZCLP_SESSIONS: { date: string; programDay: string; exercises: string[] }[] = [
  { date: '2026-05-04', programDay: 'A1', exercises: ['Squat', 'Bench Press', 'Lat Pulldown'] },
  { date: '2026-05-06', programDay: 'B1', exercises: ['Overhead Press', 'Deadlift', 'Bent Over Row'] },
  { date: '2026-05-08', programDay: 'A2', exercises: ['Bench Press', 'Squat', 'Lat Pulldown'] },
  { date: '2026-05-11', programDay: 'B2', exercises: ['Deadlift', 'Overhead Press', 'Bent Over Row'] },
  { date: '2026-05-13', programDay: 'A1', exercises: ['Squat', 'Bench Press', 'Lat Pulldown'] },
  { date: '2026-05-15', programDay: 'B1', exercises: ['Overhead Press', 'Deadlift', 'Bent Over Row'] },
]
