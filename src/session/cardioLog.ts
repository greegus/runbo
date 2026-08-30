/**
 * The cardio log rules: what a draft starts as, what blocks a finish, what
 * reaches Firestore. Pure data in, pure data out — no Vue, no clock, no
 * persistence, so `CardioLogForm` and `CardioSessionView` stay presentation.
 */
import type { CardioLogDraft } from '@/session/types'
import type { CardioPrescription, Session } from '@/types'

/** Absurd-value ceilings. Above these we ask, we never clamp — a 6-hour ride is real, a 6-day one is a typo. */
const MAX_MINUTES = 600
const MAX_DISTANCE_KM = 300
const MIN_HR = 30
const MAX_HR = 230

/**
 * `null` means "not recorded" everywhere in this module. It is never `0`:
 * a ride with no HR strap and a ride with a 0 bpm reading are different facts,
 * and only the first one is real.
 */
function optionalNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function emptyCardioLogDraft(prescription?: CardioPrescription): CardioLogDraft {
  // Minutes seeded from the target: most sessions are done as prescribed, and
  // retyping a number you were just shown is pure friction.
  const minutes = optionalNumber(prescription?.targetMinutes)

  return {
    minutes: minutes !== null && minutes > 0 ? minutes : null,
    distanceKm: null,
    avgHr: null,
    rpe: null,
    notes: '',
  }
}

export function fromSession(session: Session): CardioLogDraft {
  return {
    minutes: optionalNumber(session.minutes),
    distanceKm: optionalNumber(session.distanceKm),
    avgHr: optionalNumber(session.avgHr),
    rpe: optionalNumber(session.rpe),
    notes: session.notes ?? '',
  }
}

/**
 * The ONLY blocking rule: an athlete who ran without a watch still logged a
 * session, so distance, HR, RPE and notes are never required. Minutes are,
 * because every cardio stat sums `Session.minutes`.
 */
export function cardioLogBlockedReason(draft: CardioLogDraft): string | null {
  const minutes = optionalNumber(draft.minutes)
  if (minutes === null || minutes <= 0) return 'Enter how many minutes you did'

  return null
}

/**
 * Non-blocking messages for values that are almost certainly typos. Separate
 * from `cardioLogBlockedReason` on purpose: a wrong-looking number gets a
 * question, not a locked Finish button and not a silent clamp.
 */
export function cardioLogWarnings(draft: CardioLogDraft): string[] {
  const warnings: string[] = []
  const { minutes, distanceKm, avgHr, rpe } = draft

  if (minutes !== null && Number.isFinite(minutes) && minutes > MAX_MINUTES) {
    warnings.push(`${minutes} minutes is over 10 hours — is that right?`)
  }
  if (distanceKm !== null && Number.isFinite(distanceKm)) {
    if (distanceKm < 0) warnings.push('Distance cannot be negative — it will not be saved.')
    else if (distanceKm > MAX_DISTANCE_KM) warnings.push(`${distanceKm} km is further than most races — is that right?`)
  }
  if (avgHr !== null && Number.isFinite(avgHr)) {
    if (avgHr <= 0) warnings.push('Average heart rate must be above zero — it will not be saved.')
    else if (avgHr < MIN_HR || avgHr > MAX_HR) {
      warnings.push(`${avgHr} bpm is outside ${MIN_HR}-${MAX_HR} bpm — is that right?`)
    }
  }
  if (rpe !== null && Number.isFinite(rpe) && (rpe < 1 || rpe > 10)) {
    warnings.push('RPE runs from 1 to 10.')
  }

  return warnings
}

/**
 * The patch handed to `finishSession`. Absent values are OMITTED keys, never
 * `undefined` — Firestore rejects `undefined` and would fail the whole write.
 */
export function cardioLogPatch(draft: CardioLogDraft): Partial<Session> {
  const minutes = optionalNumber(draft.minutes)
  const distanceKm = optionalNumber(draft.distanceKm)
  const avgHr = optionalNumber(draft.avgHr)
  const rpe = optionalNumber(draft.rpe)
  const notes = draft.notes.trim()

  return {
    minutes: Math.max(0, Math.round(minutes ?? 0)),
    ...(distanceKm !== null && distanceKm > 0 ? { distanceKm } : {}),
    ...(avgHr !== null && avgHr > 0 ? { avgHr } : {}),
    ...(rpe !== null && rpe > 0 ? { rpe } : {}),
    ...(notes ? { notes } : {}),
  }
}
