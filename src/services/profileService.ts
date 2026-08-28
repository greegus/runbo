/**
 * The `profiles/{uid}` document: read it, subscribe to it, patch it, and build
 * the one a brand-new user starts with.
 *
 * The default profile is assembled here rather than in the store because it is
 * the only piece of the layer with a real shape to get right, and it must be
 * buildable without a live Firestore (onboarding tests, the rules check). It
 * calls `gzclp.ts` for the program text and state — deriving GZCLP a second
 * time is how the two copies start to disagree.
 */

import type { FirestoreError } from 'firebase/firestore'

import { profilesCollection } from '@/constants/firebaseCollections'
import { loadDocument, saveDocument, subscribeToDocument, updateDocument } from '@/services/firebaseService'
import { buildGzclpProgram, DEFAULT_REST_TIMERS, initialProgramState } from '@/training/gzclp'
import type { Profile } from '@/types'
import { startOfWeekMonday, toIso } from '@/utils/date'

/** Per side, in kg — a common home-gym inventory and the units default. */
const DEFAULT_PLATES: Profile['settings']['plates'] = [
  { weight: 25, count: 2 },
  { weight: 20, count: 2 },
  { weight: 15, count: 2 },
  { weight: 10, count: 2 },
  { weight: 5, count: 2 },
  { weight: 2.5, count: 2 },
  { weight: 1.25, count: 2 },
]

/**
 * The profile "Skip setup" produces: the built-in GZCLP with every lift left as
 * `?+`, so the first session asks for each working weight.
 *
 * DECISION: `todayIso` is a parameter with a clock-reading default. The
 * cardio mesocycle is anchored to the Monday of the week the user signs up in,
 * and a service may read the clock — but a caller that already knows "today"
 * (onboarding, a test) must be able to pass it rather than race midnight.
 */
export function createDefaultProfile(uid: string, email: string, todayIso: string = toIso(new Date())): Profile {
  const programText = buildGzclpProgram({})

  return {
    id: uid,
    email,
    settings: {
      units: 'kg',
      barbellWeight: 20,
      plates: DEFAULT_PLATES,
      restTimers: { ...DEFAULT_REST_TIMERS },
      comebackGapDays: 10,
      // Both nudges default off: notification permission is granted from
      // Settings, and a profile created with them on would start pushing the
      // moment an unrelated Settings action grants it.
      notifications: { daily: false, gapNudge: false },
      fcmTokens: [],
    },
    availability: {
      daysPerWeek: 5,
      preferredDays: [0, 1, 2, 4, 5],
      longSessionDay: 5,
    },
    strengthTrack: {
      goal: { type: 'open' },
      programText,
      programState: initialProgramState(programText, {}),
      rotationCursor: 0,
    },
    cardioTrack: {
      goal: { type: 'open' },
      // DECISION: running only. The onboarding wizard asks which modalities the
      // user has; one enabled modality is the smallest legal value and the one
      // the cardio plan's rotation degrades to gracefully.
      modalities: ['run'],
      weeklyMinutes: 60,
      longestSessionMinutes: 30,
      mesoWeek: 1,
      mesoStartDate: startOfWeekMonday(todayIso),
      holdStreak: 0,
      rotationCursor: 0,
      lastPlannedMinutes: 0,
    },
    // Step 0 of the wizard is sign-in, already behind the user by the time a
    // profile exists — the first real question is step 1, Gym setup.
    onboarding: { completed: false, step: 1 },
  }
}

export async function loadProfile(uid: string): Promise<Profile | undefined> {
  return loadDocument(profilesCollection, uid)
}

/** The rules deny a list query over `profiles`, so this is always a single doc. */
export function subscribeToProfile(
  uid: string,
  callback: (profile: Profile | undefined) => void,
  onError?: (error: FirestoreError) => void,
): () => void {
  return subscribeToDocument(profilesCollection, uid, callback, onError)
}

/**
 * Write the whole document. Used once, by `ensureProfile` on first sign-in.
 *
 * `createOnly` because this is a full replace: a caller that mistook an
 * unreadable profile for an absent one would otherwise reset the user's
 * `programState`, rotation cursor and settings to the defaults. Throws when the
 * profile is already there.
 */
export async function createProfile(profile: Profile): Promise<void> {
  await saveDocument(profilesCollection, profile, { withTimestamps: true, createOnly: true })
}

/**
 * Patch. Nested objects are replaced wholesale by `updateDoc` unless the caller
 * uses dotted paths (`{ 'cardioTrack.mesoWeek': 2 }`), so change one nested
 * field that way rather than sending back a whole, possibly stale object.
 */
export async function saveProfile(uid: string, patch: Partial<Profile> | Record<string, unknown>): Promise<void> {
  await updateDocument(profilesCollection, uid, patch, { withTimestamps: true })
}
