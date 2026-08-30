/**
 * Types shared by the Phase 7 session UI. Pure data: no Vue, no Firestore,
 * no Date. Every rule that operates on these lives in a sibling module
 * (`setCycle.ts`, `strengthSession.ts`, `cardioLog.ts`, `today.ts`),
 * never in a component.
 */
import type { WeightValue } from '@/types'

/**
 * `SetLog.completedReps` is `number | null` and `null` means BOTH "untouched"
 * and "skipped" — the stored model cannot tell them apart, and to every
 * consumer they are identical (a missed set is a miss). The UI still has to
 * show the difference while the session is open, so the phase lives here and
 * only here. It is not persisted and does not survive a reload.
 */
export type SetPhase = 'untouched' | 'done' | 'skipped'

export interface LoggedSet {
  prescribedReps: number
  minReps?: number
  isAmrap: boolean
  weight: WeightValue
  label?: string
  phase: SetPhase
  /** Invariant: a finite integer >= 0 iff phase === 'done'; null otherwise. */
  completedReps: number | null
}

export interface CardioLogDraft {
  minutes: number | null
  distanceKm: number | null
  avgHr: number | null
  rpe: number | null
  notes: string
}
