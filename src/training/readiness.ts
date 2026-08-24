/**
 * The optional pre-session readiness check: sleep / energy / soreness, 1–5 each.
 *
 * It is ADVICE ONLY. Nothing here touches program state, prescriptions or the
 * profile — a bad night must never silently rewrite a progression, because the
 * program can only stay honest if every weight change comes from logged work.
 */

import type { SessionKind } from '@/types'

export type ReadinessBand = 'good' | 'ok' | 'poor'

export interface ReadinessInput {
  sleep: number // 1 = terrible … 5 = great
  energy: number // 1 = flat … 5 = fresh
  soreness: number // 1 = wrecked … 5 = no soreness (higher is always better)
}

export interface ReadinessScore {
  total: number // 3 … 15
  band: ReadinessBand
}

/** At or below this the session screen offers a suggestion. */
export const ADVICE_THRESHOLD = 7

const ADVICE: Record<SessionKind, string> = {
  strength: 'Consider skipping the AMRAP set',
  cardio: 'Shorten to about 70% of the target',
}

// Out-of-range input is a UI bug, not a reason to throw mid-session: clamping
// keeps the score inside 3–15 so the bands stay meaningful.
function clamp(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(5, Math.max(1, Math.round(value)))
}

/** Sum of the three answers, plus the band the sum falls in. */
export function scoreReadiness(input: ReadinessInput): ReadinessScore {
  const total = clamp(input.sleep) + clamp(input.energy) + clamp(input.soreness)

  return { total, band: readinessBand(total) }
}

/** poor ≤ 7 (advice shown) · ok 8–11 · good ≥ 12. */
export function readinessBand(total: number): ReadinessBand {
  if (total <= ADVICE_THRESHOLD) return 'poor'
  return total >= 12 ? 'good' : 'ok'
}

/** A suggestion for a poor score, `null` otherwise. Never changes anything. */
export function readinessAdvice(score: number, kind: SessionKind): string | null {
  return score <= ADVICE_THRESHOLD ? ADVICE[kind] : null
}
