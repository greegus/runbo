/**
 * Types the onboarding wizard and the reusable Settings form sections exchange.
 * Slice aliases live here rather than in `src/types.ts` so that the domain model
 * stays free of UI concerns — and so that every form section names the same
 * type, which is what stops one of them from patching a partial object.
 */
import type { Modality, Profile } from '@/types'

/** Profile slices — one per reusable form section. */
export type GymSettings = Profile['settings']
export type Availability = Profile['availability']
export type StrengthTrack = Profile['strengthTrack']
export type CardioTrack = Profile['cardioTrack']
export type CardioZones = NonNullable<Profile['cardioTrack']['zones']>
export type OnboardingState = Profile['onboarding']

/** 0 is the welcome screen; 1–6 are the doc's wizard steps. See the contract §5. */
export type StepId = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * Zone inputs the user types but the profile never stores: an age is folded into
 * `hr.max` by `maxFromAge`, and a recent performance into a single threshold
 * number by `thresholdPace`. Keeping them here is what makes going back a step
 * non-destructive within a session.
 */
export interface PaceDraft {
  mode: 'none' | 'threshold' | 'recent'
  threshold: number | null
  distanceKm: number | null
  minutes: number | null
}

export interface ZonesDraft {
  hrMode: 'none' | 'max' | 'age'
  maxHr: number | null
  age: number | null
  lthr: number | null
  pace: Record<Modality, PaceDraft>
}

/**
 * One row of the fresh-GZCLP seeding form. `weight === null` means ask-weight,
 * which is the deliberate default: the wizard must never invent a starting load.
 */
export interface LiftSeedDraft {
  key: string // exerciseKey(), e.g. 'T1:Squat'
  lift: string // 'Squat'
  tier: 1 | 2 | 3
  weight: number | null
  stage: number // 1-based; always 1 for tier 3
  fiveRm: number | null // the "I don't know" input; never persisted
}

/**
 * One row of the import confirmation table. `deriveState` returns a report that
 * only covers lifts WITH history, so the table's row list is this merge of the
 * report, the program state and the ask-weight keys — see contract §6.
 */
export interface DerivedRow {
  key: string
  lift: string
  tier: 1 | 2 | 3 | undefined
  /** What the log says was lifted; null when nothing was ever completed. */
  observedWeight: { value: number; unit: 'kg' | 'lb' } | null
  observedShape: string
  weightConfidence: 'certain' | 'likely' | 'guess' | null
  variationConfidence: 'certain' | 'likely' | 'guess' | null
  matchKind: 'exact' | 'countAndReps' | 'repPattern' | 'label' | 'totalSets' | null
  keyResolution: 'logged' | 'tier-inferred-by-key' | 'tier-inferred-by-shape' | 'tier-dropped' | 'none'
  lastLoggedDate: string | null
  tiedCandidates: { index: number; shape: string }[]
  replayFailed: boolean
  replayDiagnostics: import('@/liftoscript/diagnostics').Diagnostic[]
  needsReview: boolean
  reviewReasons: string[]
  /** The editable half — seeded from programState, written back into it on accept. */
  weight: number | null // null = ask-weight
  unit: 'kg' | 'lb'
  stage: number // 1-based
  variationCount: number // how many set variations the program line has
}

export interface CursorRow {
  value: number
  dayNames: string[] // the program's day names, in order
  source: 'gzclp-rotation' | 'program-days' | 'unknown-day' | 'no-program-day'
  confidence: 'certain' | 'likely' | 'guess'
  suspect: boolean
  lastProgramDay?: string
  nextProgramDay?: string
}
