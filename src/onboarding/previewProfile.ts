/**
 * Makes a half-filled wizard draft safe to compose a week from.
 *
 * `planWeek` reads a dozen numeric fields off the profile and the planners
 * degrade a `NaN` to zero rather than throwing — which produces an empty,
 * silently wrong preview instead of a visible error. `plannedWeekOf`/`addDays`
 * do throw on a malformed `mesoStartDate`. Both failure modes land in the
 * middle of onboarding, where the user has typed exactly one field, so the
 * preview is coerced back onto the `createDefaultProfile` defaults here rather
 * than every consumer sprinkling guards over the template.
 */
import { DEFAULT_STRENGTH_DAYS_PER_WEEK } from '@/training/composer'
import { GZCLP_PROGRAM_SOURCE } from '@/training/gzclp'
import type { Modality, Profile } from '@/types'
import { startOfWeekMonday } from '@/utils/date'

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/

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

function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_PATTERN.test(value)) return false

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  // `Date.UTC` rolls 2026-02-30 into March; the round-trip is what rejects it.
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/**
 * A structurally complete `Profile` for `planWeek`, built by copying — the
 * argument is the live wizard draft and must never be written to.
 */
export function coerceProfileForPreview(profile: Profile, todayIso: string): Profile {
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
      mesoStartDate: isIsoDay(cardio.mesoStartDate) ? cardio.mesoStartDate : startOfWeekMonday(todayIso),
      holdStreak: nonNegative(cardio.holdStreak, DEFAULTS.holdStreak),
      rotationCursor: nonNegative(cardio.rotationCursor, DEFAULTS.rotationCursor),
      lastPlannedMinutes: nonNegative(cardio.lastPlannedMinutes, DEFAULTS.lastPlannedMinutes),
    },
  }
}
