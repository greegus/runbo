/**
 * Domain data model shared by the pure modules (`src/liftoscript`, `src/training`),
 * the Firestore services and the views. Dates are always ISO `YYYY-MM-DD`
 * strings so that domain code never has to touch `Date`.
 */

export type LiftId = string // exercise name as written in the program, e.g. 'Squat'
export type Modality = 'run' | 'bike' | 'swim'
export type SessionKind = 'strength' | 'cardio'
export type GoalType = 'open' | 'race' | 'numeric' // MVP uses only 'open'

export interface WeightValue {
  value: number
  unit: 'kg' | 'lb'
}

export interface Profile {
  // doc: profiles/{uid}
  id: string // == uid
  email: string
  settings: {
    units: 'kg' | 'lb'
    barbellWeight: number // in units, default 20
    plates: { weight: number; count: number }[] // per side
    restTimers: { t1: number; t2: number; t3: number } // seconds, defaults 180/120/60
    comebackGapDays: number // default 10
    notifications: { daily: boolean; gapNudge: boolean }
    fcmTokens: string[]
  }
  availability: {
    daysPerWeek: number // default 5
    preferredDays: number[] // 0=Mon..6=Sun, default [0, 1, 2, 4, 5]
    longSessionDay: number // default 5 (Sat)
  }
  strengthTrack: {
    goal: { type: GoalType } // MVP: { type: 'open' }
    programText: string // Liftoscript source
    programState: Record<string, ExerciseState> // key = exerciseKey() from the liftoscript engine ('T1:Squat')
    rotationCursor: number // index into program days, 0-based
  }
  cardioTrack: {
    goal: { type: GoalType }
    modalities: Modality[]
    weeklyMinutes: number // current mesocycle baseline
    longestSessionMinutes: number
    mesoWeek: number // 1..4
    mesoStartDate: string // ISO date of week 1 Monday
    // Both are written back from `planCardioWeek`'s result every week; without
    // them the adaptive step-back and the modality rotation restart each week.
    holdStreak: number // consecutive weeks completed under 70 % of target, default 0
    rotationCursor: number // index into the enabled modalities, default 0
    // Minutes LAST week was actually prescribed. The adaptive check has to
    // divide by this and not by `weeklyMinutes`: a deload week prescribes 60 %
    // of the baseline, so a perfectly completed deload would otherwise read as
    // a missed week and hold the next one. 0 on a fresh profile.
    lastPlannedMinutes: number
    zones?: {
      hr?: { max?: number; lthr?: number }
      pace?: { run?: number; bike?: number; swim?: number } // sec per km / kmh / sec per 100 m
    }
  }
  onboarding: { completed: boolean; step: number }
  createdAt?: Date
  updatedAt?: Date
}

export interface ExerciseState {
  weights: WeightValue[] // per set-variation working weight; usually length 1 (same for all)
  setVariationIndex: number // 1-based, like Liftoscript
  state: Record<string, number | WeightValue> // custom-progression state vars
  askWeight?: boolean // true until first weight entered
}

export interface SetLog {
  prescribedReps: number
  minReps?: number // for ranges
  isAmrap: boolean
  completedReps: number | null // null = untouched/skipped
  weight: WeightValue
  label?: string
}

export interface Session {
  // doc: sessions/{id}
  id: string
  uid: string
  date: string // ISO YYYY-MM-DD
  kind: SessionKind
  status: 'active' | 'done'
  readiness?: { sleep: number; energy: number; soreness: number }

  // strength:
  programDay?: string // e.g. 'A1'
  exercises?: { name: LiftId; tier?: 1 | 2 | 3; sets: SetLog[] }[]
  progressionSummary?: string[] // human lines, e.g. 'Squat: 5×3+ → 6×2+, weight held at 100 kg'
  stateSnapshot?: Record<string, ExerciseState> // programState BEFORE this session — enables delete-last-and-restore

  // cardio:
  prescription?: CardioPrescription
  source?: 'manual' | 'strava'
  externalId?: string // Strava activity id, for dedup
  minutes?: number
  distanceKm?: number
  avgHr?: number
  rpe?: number
  notes?: string

  createdAt?: Date
  updatedAt?: Date
}

export interface CardioPrescription {
  modality: Modality
  kind: 'easy' | 'intervals' | 'tempo' | 'long'
  targetMinutes: number
  structure?: { reps: number; workMinutes: number; restMinutes: number } // intervals only
  zone: 1 | 2 | 3 | 4 | 5
}

export interface BodyweightEntry {
  // doc: bodyweight/{id}
  id: string
  uid: string
  date: string
  weight: number
}

export interface ComposedWeek {
  // computed, not stored
  weekStart: string // ISO Monday
  days: { date: string; planned: PlannedItem | null }[]
}

export type PlannedItem =
  | { kind: 'strength'; programDay: string }
  | { kind: 'cardio'; prescription: CardioPrescription }
