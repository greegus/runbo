/**
 * Makes a half-filled wizard draft safe to compose a week from.
 *
 * `planWeek` reads a dozen numeric fields off the profile and the planners
 * degrade a `NaN` to zero rather than throwing — which produces an empty,
 * silently wrong preview instead of a visible error. `blockWindowStart`/`addDays`
 * do throw on a malformed block anchor. Both failure modes land in the
 * middle of onboarding, where the user has typed exactly one field, so the
 * preview is coerced back onto the `createDefaultProfile` defaults here rather
 * than every consumer sprinkling guards over the template.
 */
import { DEFAULT_STRENGTH_DAYS_PER_WEEK } from '@/training/composer'
import { GZCLP_PROGRAM_SOURCE } from '@/training/gzclp'
import type { Modality, Profile } from '@/types'
import { isIsoDay } from '@/utils/date'

const DEFAULTS = {
  weeklyMinutes: 60,
  longestSessionMinutes: 30,
  mesoWeek: 1,
  holdStreak: 0,
  rotationCursor: 0,
  lastPlannedMinutes: 0,
  daysPerWeek: 5,
  longSessionDay: 5,
  strengthDaysPerWeek: DEFAULT_STRENGTH_DAYS_PER_WEEK,
} as const

const DEFAULT_MODALITIES: Modality[] = ['run']

/** A finite number ≥ 0, or the default. Negative volumes are as wrong as `NaN`. */
function nonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback

  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * A structurally complete `Profile` for `planWeek`, built by copying — the
 * argument is the live wizard draft and must never be written to.
 *
 * No date argument: every field here is coerced onto a constant default. The
 * one that needed "today" was the cardio anchor, and the training block does not
 * invent one — an absent or malformed anchor means "no block yet", which the
 * planner already understands.
 */
export function coerceProfileForPreview(profile: Profile): Profile {
  const cardio = profile.cardioTrack
  const availability = profile.availability
  const modalities = (cardio.modalities ?? []).filter(
    (modality): modality is Modality => modality === 'run' || modality === 'bike' || modality === 'swim',
  )

  return {
    ...profile,
    availability: {
      ...availability,
      // The composer floors the budget at 0 itself, but a preview of zero
      // training days is a bug report waiting to happen — one day is the
      // smallest week anyone means to plan.
      daysPerWeek: clampInteger(availability.daysPerWeek, 1, 7, DEFAULTS.daysPerWeek),
      preferredDays: [
        ...new Set((availability.preferredDays ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)),
      ].sort((a, b) => a - b),
      longSessionDay: clampInteger(availability.longSessionDay, 0, 6, DEFAULTS.longSessionDay),
      // Zero lifting days is a legal answer here (a cardio-only block), so this
      // one floors at 0 rather than at 1 the way `daysPerWeek` does.
      strengthDaysPerWeek: clampInteger(availability.strengthDaysPerWeek, 0, 7, DEFAULTS.strengthDaysPerWeek),
    },
    strengthTrack: {
      ...profile.strengthTrack,
      // The planner reads the rotation off the program text, so a draft that has
      // not reached the program step yet would preview a week with no strength
      // in it. The built-in is what "skip setup" writes anyway, which makes it
      // the honest stand-in rather than a guess.
      programText: profile.strengthTrack.programText?.trim() ? profile.strengthTrack.programText : GZCLP_PROGRAM_SOURCE,
      // DECISION: not in the contract's list, but the cursor indexes the
      // program-day array — a `NaN` here names no day at all.
      rotationCursor: clampInteger(profile.strengthTrack.rotationCursor, 0, Number.MAX_SAFE_INTEGER, 0),
    },
    cardioTrack: {
      ...cardio,
      modalities: modalities.length > 0 ? modalities : DEFAULT_MODALITIES,
      weeklyMinutes: nonNegative(cardio.weeklyMinutes, DEFAULTS.weeklyMinutes),
      longestSessionMinutes: nonNegative(cardio.longestSessionMinutes, DEFAULTS.longestSessionMinutes),
      mesoWeek: clampInteger(cardio.mesoWeek, 1, 4, DEFAULTS.mesoWeek),
      // `null`, not this week's Monday: an absent block anchor means "no block
      // has been opened yet", which is a state the planner understands. Making
      // one up here would open a block the athlete has not trained a day of.
      blockStartDate: isIsoDay(cardio.blockStartDate) ? cardio.blockStartDate : null,
      holdStreak: nonNegative(cardio.holdStreak, DEFAULTS.holdStreak),
      rotationCursor: nonNegative(cardio.rotationCursor, DEFAULTS.rotationCursor),
      lastPlannedMinutes: nonNegative(cardio.lastPlannedMinutes, DEFAULTS.lastPlannedMinutes),
    },
  }
}
