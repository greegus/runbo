/**
 * Catalog of the exercise names runbo knows, with the aliases other tools write
 * them under. Two consumers: the Liftosaur history import (which sees whatever
 * the user named a lift) and the UI (which shows the canonical name).
 *
 * It is deliberately a lookup table, not a taxonomy — nothing here decides how
 * an exercise is programmed. `kind` only drives display and plate hints
 * (barbell lifts get a plate breakdown, the others do not).
 */

import type { Modality } from '@/types'

export type ExerciseKind = 'barbell' | 'machine' | 'dumbbell' | 'bodyweight' | 'cardio'

export interface ExerciseEntry {
  canonical: string
  aliases: string[]
  kind: ExerciseKind
  modality?: Modality // cardio only
}

export const EXERCISES: ExerciseEntry[] = [
  // GZCLP main lifts
  { canonical: 'Squat', aliases: ['Back Squat', 'Barbell Squat', 'High Bar Squat', 'Low Bar Squat'], kind: 'barbell' },
  { canonical: 'Front Squat', aliases: ['Barbell Front Squat'], kind: 'barbell' },
  { canonical: 'Bench Press', aliases: ['Bench', 'Barbell Bench Press', 'Flat Bench Press'], kind: 'barbell' },
  { canonical: 'Incline Bench Press', aliases: ['Incline Bench', 'Incline Barbell Bench Press'], kind: 'barbell' },
  { canonical: 'Deadlift', aliases: ['Conventional Deadlift', 'Barbell Deadlift'], kind: 'barbell' },
  { canonical: 'Romanian Deadlift', aliases: ['RDL', 'Stiff Leg Deadlift', 'Straight Leg Deadlift'], kind: 'barbell' },
  {
    canonical: 'Overhead Press',
    aliases: ['OHP', 'Standing Press', 'Military Press', 'Shoulder Press', 'Barbell Overhead Press', 'Press'],
    kind: 'barbell',
  },
  {
    canonical: 'Bent Over Row',
    aliases: ['Barbell Row', 'Bent Over Barbell Row', 'Pendlay Row', 'Barbell Bent Over Row'],
    kind: 'barbell',
  },
  {
    canonical: 'Lat Pulldown',
    aliases: ['Lat Pull Down', 'Pulldown', 'Wide Grip Lat Pulldown', 'Cable Pulldown'],
    kind: 'machine',
  },

  // Common accessories
  { canonical: 'Seated Cable Row', aliases: ['Cable Row', 'Seated Row'], kind: 'machine' },
  { canonical: 'Leg Press', aliases: ['Machine Leg Press'], kind: 'machine' },
  { canonical: 'Leg Curl', aliases: ['Lying Leg Curl', 'Hamstring Curl', 'Seated Leg Curl'], kind: 'machine' },
  { canonical: 'Leg Extension', aliases: ['Knee Extension'], kind: 'machine' },
  { canonical: 'Calf Raise', aliases: ['Standing Calf Raise', 'Seated Calf Raise'], kind: 'machine' },
  {
    canonical: 'Triceps Pushdown',
    aliases: ['Tricep Pushdown', 'Cable Pushdown', 'Triceps Pressdown'],
    kind: 'machine',
  },
  { canonical: 'Face Pull', aliases: ['Cable Face Pull'], kind: 'machine' },
  { canonical: 'Hip Thrust', aliases: ['Barbell Hip Thrust', 'Glute Bridge'], kind: 'barbell' },
  { canonical: 'Barbell Curl', aliases: ['EZ Bar Curl', 'Bicep Curl', 'Biceps Curl'], kind: 'barbell' },
  { canonical: 'Dumbbell Bench Press', aliases: ['DB Bench Press', 'Dumbbell Press'], kind: 'dumbbell' },
  {
    canonical: 'Dumbbell Row',
    aliases: ['DB Row', 'One Arm Dumbbell Row', 'Single Arm Dumbbell Row'],
    kind: 'dumbbell',
  },
  { canonical: 'Dumbbell Curl', aliases: ['DB Curl', 'Hammer Curl'], kind: 'dumbbell' },
  { canonical: 'Lateral Raise', aliases: ['Side Raise', 'Dumbbell Lateral Raise'], kind: 'dumbbell' },
  {
    canonical: 'Triceps Extension',
    aliases: ['Tricep Extension', 'Overhead Triceps Extension', 'Skullcrusher'],
    kind: 'dumbbell',
  },
  { canonical: 'Pull Up', aliases: ['Pullup', 'Pull Ups', 'Chin Up', 'Chinup'], kind: 'bodyweight' },
  { canonical: 'Push Up', aliases: ['Pushup', 'Push Ups'], kind: 'bodyweight' },
  { canonical: 'Dip', aliases: ['Dips', 'Chest Dip', 'Triceps Dip'], kind: 'bodyweight' },
  { canonical: 'Plank', aliases: ['Front Plank'], kind: 'bodyweight' },
  { canonical: 'Hanging Leg Raise', aliases: ['Leg Raise', 'Hanging Knee Raise'], kind: 'bodyweight' },
  { canonical: 'Back Extension', aliases: ['Hyperextension', 'Hip Extension'], kind: 'bodyweight' },

  // Cardio — the names the program text and Strava use for the three modalities
  {
    canonical: 'Run',
    aliases: ['Running', 'Jog', 'Jogging', 'Trail Run', 'Treadmill Run'],
    kind: 'cardio',
    modality: 'run',
  },
  {
    canonical: 'Bike',
    aliases: ['Cycling', 'Ride', 'Cycle', 'Biking', 'Indoor Cycling', 'Virtual Ride', 'Gravel Ride', 'Stationary Bike'],
    kind: 'cardio',
    modality: 'bike',
  },
  { canonical: 'Swim', aliases: ['Swimming', 'Pool Swim', 'Open Water Swim'], kind: 'cardio', modality: 'swim' },
]

/**
 * Lowercased, punctuation-free, single-spaced. Everything after a comma goes:
 * Liftosaur writes the equipment there (`Bench Press, Barbell`), and `Pull-Up`,
 * `Pull Up` and `pull up` must all land on the same key.
 */
function normalize(name: string): string {
  return name
    .split(',')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Built once; the first entry claiming a key wins, so a canonical name can never
// be shadowed by another entry's alias.
const byName = new Map<string, ExerciseEntry>()
for (const entry of EXERCISES) {
  for (const name of [entry.canonical, ...entry.aliases]) {
    const key = normalize(name)
    if (!byName.has(key)) byName.set(key, entry)
  }
}

/** Case- and punctuation-insensitive lookup by canonical name or alias. */
export function resolveExercise(name: string): ExerciseEntry | undefined {
  return byName.get(normalize(name))
}

/** The catalog's spelling of a name, or the name unchanged when it is unknown. */
export function canonicalName(name: string): string {
  return resolveExercise(name)?.canonical ?? name.split(',')[0].trim()
}

/** The cardio modality a name stands for, if it is a cardio exercise at all. */
export function modalityOf(name: string): Modality | undefined {
  return resolveExercise(name)?.modality
}
