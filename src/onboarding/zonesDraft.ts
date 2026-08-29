/**
 * The boundary between what the user types in the zones step and what the
 * profile stores. The profile keeps a single number per axis (`hr.max`,
 * `pace.run`), while the user is offered an age, an LTHR and a recent effort —
 * so the conversion has to live somewhere testable. It lives here rather than
 * in `ZonesForm.vue`, because a `.vue` file cannot be unit tested in this repo
 * and a wrong unit here is invisible: a run threshold entered as minutes per km
 * instead of seconds would still render five plausible-looking zones.
 */
import type { CardioZones, PaceDraft, ZonesDraft } from '@/onboarding/types'
import { maxFromAge, thresholdPace } from '@/training/zones'
import type { Modality } from '@/types'

export const ALL_MODALITIES: Modality[] = ['run', 'bike', 'swim']

/** Minutes and seconds of a `mm:ss` pair; either half may be blank mid-typing. */
export interface ClockParts {
  minutes: number | null
  seconds: number | null
}

function emptyPaceDraft(): PaceDraft {
  return { mode: 'none', threshold: null, distanceKm: null, minutes: null }
}

export function emptyZonesDraft(): ZonesDraft {
  return {
    hrMode: 'none',
    maxHr: null,
    age: null,
    lthr: null,
    pace: { run: emptyPaceDraft(), bike: emptyPaceDraft(), swim: emptyPaceDraft() },
  }
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Rebuilds the form state from what was stored. The age is unrecoverable — only
 * the max HR it produced was persisted — so a profile that was filled in by age
 * comes back as a measured max. That is a deliberate one-way trip: re-deriving
 * an age from `208 - 0.7 * age` would show the user a number they never typed.
 */
export function zonesDraftFrom(zones: CardioZones | undefined): ZonesDraft {
  const draft = emptyZonesDraft()

  const max = positive(zones?.hr?.max)

  if (max !== null) {
    draft.hrMode = 'max'
    draft.maxHr = max
  }

  draft.lthr = positive(zones?.hr?.lthr)

  for (const modality of ALL_MODALITIES) {
    const stored = positive(zones?.pace?.[modality])

    if (stored !== null) {
      draft.pace[modality] = { mode: 'threshold', threshold: stored, distanceKm: null, minutes: null }
    }
  }

  return draft
}

function hrFromDraft(draft: ZonesDraft): CardioZones['hr'] | undefined {
  const hr: { max?: number; lthr?: number } = {}

  const maxHr = positive(draft.maxHr)
  const age = positive(draft.age)

  // Rounded because bpm is a whole number everywhere else in the app — storing
  // 182.1 would surface as an odd anchor in every zone the preview shows.
  if (draft.hrMode === 'max' && maxHr !== null) hr.max = maxHr
  if (draft.hrMode === 'age' && age !== null) hr.max = Math.round(maxFromAge(age))

  const lthr = positive(draft.lthr)

  if (lthr !== null) hr.lthr = lthr

  return hr.max === undefined && hr.lthr === undefined ? undefined : hr
}

/** The stored threshold number for one modality, or null when it is not usable. */
export function paceFromDraft(modality: Modality, pace: PaceDraft): number | null {
  if (pace.mode === 'threshold') return positive(pace.threshold)

  if (pace.mode === 'recent') {
    const distanceKm = positive(pace.distanceKm)
    const minutes = positive(pace.minutes)

    if (distanceKm === null || minutes === null) return null

    return thresholdPace(modality, { distanceKm, minutes })
  }

  return null
}

/**
 * Returns `undefined` — never an empty object — when nothing usable was entered,
 * so a skipped step leaves `cardioTrack.zones` absent rather than writing a
 * husk that `hrZones`/`paceZones` would have to keep rejecting forever.
 */
export function zonesFromDraft(draft: ZonesDraft, modalities: Modality[]): CardioZones | undefined {
  const hr = hrFromDraft(draft)

  const pace: { run?: number; bike?: number; swim?: number } = {}

  for (const modality of modalities) {
    const value = paceFromDraft(modality, draft.pace[modality])

    if (value !== null) pace[modality] = value
  }

  const hasPace = Object.keys(pace).length > 0

  if (!hr && !hasPace) return undefined

  return { ...(hr ? { hr } : {}), ...(hasPace ? { pace } : {}) }
}

export function isZonesDraftEmpty(draft: ZonesDraft): boolean {
  return zonesFromDraft(draft, ALL_MODALITIES) === undefined
}

/** `95` → `{ minutes: 1, seconds: 35 }`; null stays null so a blank field stays blank. */
export function splitClock(totalSeconds: number | null): ClockParts {
  if (totalSeconds === null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return { minutes: null, seconds: null }
  }

  const whole = Math.round(totalSeconds)

  return { minutes: Math.floor(whole / 60), seconds: whole % 60 }
}

/**
 * A pace is entered as `mm:ss` and stored as seconds, because the domain's
 * `pace.run` / `pace.swim` are seconds per km / per 100 m. Half-filled input is
 * accepted (`5:` is 300 s) — the user types the minutes first and we must not
 * blank the field between the two keystrokes.
 */
export function joinClock(parts: ClockParts): number | null {
  const minutes = Number.isFinite(parts.minutes) ? (parts.minutes as number) : 0
  const seconds = Number.isFinite(parts.seconds) ? (parts.seconds as number) : 0

  if (parts.minutes === null && parts.seconds === null) return null
  if (minutes < 0 || seconds < 0) return null

  const total = minutes * 60 + seconds

  return total > 0 ? total : null
}

/** A duration in (possibly fractional) minutes, from a `mm:ss` pair. */
export function minutesFromClock(parts: ClockParts): number | null {
  const total = joinClock(parts)

  return total === null ? null : total / 60
}

export function clockFromMinutes(minutes: number | null): ClockParts {
  return splitClock(minutes === null || !Number.isFinite(minutes) ? null : minutes * 60)
}
