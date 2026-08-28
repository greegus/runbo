/**
 * The live `profiles/{uid}` document.
 *
 * The store holds one subscription at a time and rebinds it as a whole: the
 * unsubscribe runs before the next `subscribeToProfile`, and `profile` is
 * cleared on every uid change, so a snapshot that was already in flight for the
 * previous account cannot repopulate the new one.
 *
 * No rules live here. The cardio state written back by `adoptCardioWeek` is
 * computed by `planCardioWeek`; this store only decides *when* it is safe to
 * persist it.
 */

import type { FirestoreError } from 'firebase/firestore'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

import {
  createDefaultProfile,
  createProfile,
  loadProfile,
  saveProfile,
  subscribeToProfile,
} from '@/services/profileService'
import type { CardioWeekPlan } from '@/training/cardioPlan'
import type { Profile } from '@/types'
import { addDays } from '@/utils/date'

const WEEK_LENGTH = 7

/**
 * The Monday of the week the stored cardio state describes. `mesoStartDate` is
 * week 1's Monday and `mesoWeek` counts from there, so the two together say
 * which week the planner's numbers have not been advanced past yet — which is
 * what makes `adoptCardioWeek` idempotent across reloads without a new field.
 */
function plannedWeekOf(cardioTrack: Profile['cardioTrack']): string {
  return addDays(cardioTrack.mesoStartDate, WEEK_LENGTH * (Math.max(1, cardioTrack.mesoWeek) - 1))
}

export const useProfileStore = defineStore('profile', () => {
  // shallowRef: the document is replaced wholesale by every snapshot and never
  // mutated in place, so deep reactivity would only cost proxies.
  const profile = shallowRef<Profile | null>(null)
  const error = shallowRef<FirestoreError | null>(null)

  let unsubscribe: (() => void) | null = null
  let boundUid: string | null = null
  let ensuring: Promise<void> | null = null

  function reset(): void {
    unsubscribe?.()
    unsubscribe = null
    boundUid = null
    ensuring = null
    profile.value = null
    error.value = null
  }

  async function fetchOrCreate(uid: string, email: string): Promise<void> {
    const existing = await loadProfile(uid)

    if (existing) {
      profile.value = existing
      return
    }

    const created = createDefaultProfile(uid, email)
    await createProfile(created)
    profile.value = created
  }

  /**
   * Always ends with a profile in the store. Guarded by the in-flight promise
   * so two callers on a first sign-in (the auth store and the onboarding view)
   * cannot both miss the read and both write a fresh default over each other.
   */
  function ensureProfile(uid: string, email: string): Promise<void> {
    ensuring ??= fetchOrCreate(uid, email).finally(() => {
      ensuring = null
    })

    return ensuring
  }

  /** Ensures the document exists, then keeps it live. Safe to call repeatedly. */
  async function bind(uid: string, email: string): Promise<void> {
    reset()
    boundUid = uid

    await ensureProfile(uid, email)

    // Signed out, or switched account, while the document was being fetched.
    if (boundUid !== uid) return

    unsubscribe = subscribeToProfile(
      uid,
      (next) => {
        if (boundUid === uid) profile.value = next ?? null
      },
      (listenerError) => {
        // Keep the last known document: the app stays usable offline, and the
        // guard is not left waiting for a profile that will never arrive.
        console.error('[profile] listener failed', listenerError.code, listenerError.message)
        error.value = listenerError
      },
    )
  }

  /**
   * Patch. `updateDoc` replaces nested objects wholesale, so pass a complete
   * `settings` / `cardioTrack` / `strengthTrack` object when changing a field
   * inside one. The live snapshot brings the result back.
   */
  async function save(patch: Partial<Profile>): Promise<void> {
    const current = profile.value
    if (!current) throw new Error('No profile loaded')

    await saveProfile(current.id, patch)
  }

  /**
   * Persists the state `planCardioWeek` handed back for `plannedWeekStart`.
   * Without it the adaptive step-back and the modality rotation restart every
   * week, and `lastPlannedMinutes` — the divisor the completion ratio needs —
   * is never written at all.
   *
   * Called once on the week rollover, never per session: a per-session write
   * would advance the modality cursor several times a week. Returns false when
   * the week has already been adopted, which is what makes a second call (a
   * reload, a second tab) a no-op.
   */
  async function adoptCardioWeek(plannedWeekStart: string, plan: CardioWeekPlan): Promise<boolean> {
    const current = profile.value
    if (!current) throw new Error('No profile loaded')

    const cardioTrack = current.cardioTrack
    if (plannedWeekOf(cardioTrack) !== plannedWeekStart) return false

    const nextWeekStart = addDays(plannedWeekStart, WEEK_LENGTH)

    await save({
      cardioTrack: {
        ...cardioTrack,
        mesoWeek: plan.nextMesoWeek,
        weeklyMinutes: plan.nextBaseline,
        holdStreak: plan.holdStreak,
        rotationCursor: plan.rotationCursor,
        // What the week just planned actually prescribed, summed over its
        // sessions — not the baseline, which a deload week never asks for.
        lastPlannedMinutes: plan.weeklyMinutes,
        // Re-anchor so `plannedWeekOf` keeps pointing at the week the state now
        // describes, whatever `nextMesoWeek` did (hold, ramp, or reset to 1).
        mesoStartDate: addDays(nextWeekStart, -WEEK_LENGTH * (plan.nextMesoWeek - 1)),
      },
    })

    return true
  }

  return { profile, error, bind, reset, ensureProfile, save, adoptCardioWeek }
})
