/**
 * Step arithmetic and the per-step Firestore patches.
 *
 * All of it lives here rather than in `OnboardingView.vue` because the vitest
 * config is node-environment and cannot compile a `.vue` file — a step number
 * that clamps wrong, or a patch that drops a nested field, has to be provable
 * by a test rather than by clicking through the wizard.
 */

import type { StepId } from '@/onboarding/types'
import type { Profile } from '@/types'

/** The welcome screen. Reachable by URL and by Back, never stored by a fresh profile. */
export const FIRST_STEP = 0 as const

/** Review & start. */
export const LAST_STEP = 6 as const

export const STEP_TITLES: Record<StepId, string> = {
  0: 'Welcome to runbo',
  1: 'Your gym',
  2: 'Your program',
  3: 'Your cardio',
  4: 'Your zones',
  5: 'Your week',
  6: 'Review & start',
}

/**
 * The `:step` route param is an unconstrained string — the path has no regex and
 * the router guard only redirects routes that are *not* the wizard, so a typo'd
 * or out-of-range URL reaches the view untouched. Normalising here is what keeps
 * the shell from rendering blank.
 *
 * A non-numeric param lands on 1 (Gym — the first real question) rather than on
 * the welcome screen: a URL the user could not have typed on purpose should
 * resume the wizard, not restart the intro.
 */
export function normalizeStep(raw: unknown): StepId {
  // `Number('')` and `Number(null)` are both 0, so coercing blindly would send
  // an empty or missing param to the welcome screen instead of resuming the
  // wizard. Only a number, or a string that actually contains one, counts.
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN

  if (!Number.isFinite(n)) return 1

  const floored = Math.floor(n)

  if (floored < FIRST_STEP) return FIRST_STEP
  if (floored > LAST_STEP) return LAST_STEP

  return floored as StepId
}

/**
 * What leaving `step` commits. Always a whole slice taken from the draft:
 * `updateDoc` replaces nested objects wholesale, so a patch carrying only the
 * fields the step edits would drop `restTimers`, `blockStartDate`, `holdStreak`
 * and everything else the form never touched.
 */
export function stepPatch(step: StepId, draft: Profile): Partial<Profile> {
  switch (step) {
    case 1:
      return { settings: draft.settings }
    case 2:
      return { strengthTrack: draft.strengthTrack }
    // Zones live inside the cardio slice, so both cardio steps commit the same
    // whole object — the second one carries the first one's numbers along.
    case 3:
    case 4:
      return { cardioTrack: draft.cardioTrack }
    case 5:
      return { availability: draft.availability }
    default:
      return {}
  }
}

/**
 * Merged into `stepPatch` so that one `updateDoc` carries both the data and the
 * new step. Two writes would leave a window in which a crash advances the step
 * past data that was never saved.
 */
export function advancePatch(nextStep: StepId): Partial<Profile> {
  return { onboarding: { completed: false, step: nextStep } }
}

/**
 * Skip writes no slice at all: `createDefaultProfile` already put the documented
 * skip defaults (GZCLP with every lift `?+`, 60/30 cardio, 5 days) in Firestore,
 * and re-sending a half-filled draft would be the opposite of taking them.
 */
export function skipPatch(): Partial<Profile> {
  return { onboarding: { completed: true, step: LAST_STEP } }
}

export function completePatch(): Partial<Profile> {
  return { onboarding: { completed: true, step: LAST_STEP } }
}
