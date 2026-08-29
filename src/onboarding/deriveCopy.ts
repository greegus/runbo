/**
 * User-facing wording for the derive layer.
 *
 * `src/import/liftosaurHistory.ts` owns its own copy in `IMPORT_REASONS`;
 * `deriveState` ships none at all — it returns `'countAndReps'`, `'guess'` and
 * `'tier-inferred-by-shape'`, which mean nothing to an athlete. This table is
 * the mirror of `IMPORT_REASONS` for that half, kept here rather than in a
 * template so the two halves of the confirmation screen cannot drift into
 * different tones, and so `reviewReasonsFor` is unit-testable.
 */

import type {
  Confidence,
  CursorSource,
  ExerciseDerivation,
  UnmatchedReason,
  VariationMatchKind,
} from '@/import/deriveState'
import { IMPORT_REASONS, type ReasonId } from '@/import/liftosaurHistory'

export const CONFIDENCE_COPY: Record<Confidence, string> = {
  certain: 'Read straight from your log.',
  likely: 'Our best reading of a ragged log — worth a glance.',
  guess: 'We could not tell. Please set this yourself.',
}

export const MATCH_COPY: Record<VariationMatchKind, string> = {
  exact: 'the sets, reps and AMRAP marks all matched one stage',
  countAndReps: 'the sets and reps matched, but the AMRAP marks did not',
  repPattern: 'the same sets and reps, grouped differently',
  label: 'we matched it by the set label in your log',
  totalSets: 'we could only tell by the number of sets',
}

export const CURSOR_SOURCE_COPY: Record<CursorSource, string> = {
  'gzclp-rotation': 'Taken from your last workout’s day label.',
  'program-days':
    'Your last workout was a day of this program, but not one of the four GZCLP days — the number below is only meaningful for a four-day rotation. Please confirm it.',
  'unknown-day': 'Your last workout names a day this program does not have, so we had to start from the beginning.',
  'no-program-day':
    'None of your workouts recorded which program day they were, so we had to start from the beginning.',
}

export const KEY_RESOLUTION_COPY: Record<ExerciseDerivation['keyResolution'], string> = {
  logged: '',
  'tier-inferred-by-key': 'Your log did not record a tier; we matched it to the only line of that name.',
  'tier-inferred-by-shape': 'Your log did not record a tier; we picked the tier whose sets and reps fit.',
  'tier-dropped': 'Your log recorded a tier your program does not have; we used the line of that name instead.',
}

export const UNMATCHED_COPY: Record<UnmatchedReason, string> = {
  'not-in-program': 'isn’t in your program, so its history won’t drive any weights.',
  'ambiguous-tier': 'was logged without a tier, and your program has it at more than one.',
}

export const SUSPECT_CURSOR_COPY =
  'Your last workout was labelled {day} but logged none of that day’s lifts — please confirm where you are.'

/**
 * Why a row is in `report.needsReview`.
 *
 * `needsReview` is a bag of strings with no reasons, so the four-clause
 * predicate from `deriveState` has to be re-derived somewhere. Here, once, and
 * under test — not inside a template, where it would drift from the module the
 * next time a clause is added.
 */
export function reviewReasonsFor(derivation: ExerciseDerivation | undefined): string[] {
  if (!derivation) return []

  const reasons: string[] = []

  if (derivation.weight.confidence !== 'certain') {
    reasons.push(
      derivation.weight.value === null
        ? 'Nothing was ever completed for this lift, so we have no weight for it.'
        : 'Your log had sets at more than one weight; we took the heaviest.',
    )
  }

  if (derivation.variation.confidence !== 'certain') {
    reasons.push(
      derivation.variation.match
        ? `We are not sure which stage you were on — ${MATCH_COPY[derivation.variation.match]}.`
        : 'Nothing in your log matched a stage of this program, so we started at stage 1.',
    )
  }

  if (derivation.keyResolution !== 'logged') reasons.push(KEY_RESOLUTION_COPY[derivation.keyResolution])

  if (!derivation.replayed) {
    reasons.push('We could not replay your last session through the program, so the weight was not progressed.')
  }

  return reasons
}

/**
 * `reasonMessage` throws on an id it does not know, and a throwing `v-for`
 * takes down the whole report render — so the report is always read through
 * this, which degrades to the raw id instead of to a blank screen.
 */
export function safeImportReason(id: string): string {
  return IMPORT_REASONS[id as ReasonId] ?? id
}
