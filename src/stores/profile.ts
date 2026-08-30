/**
 * The live `profiles/{uid}` document.
 *
 * The store holds one subscription at a time and rebinds it as a whole: the
 * unsubscribe runs before the next `subscribeToProfile`, and `profile` is
 * cleared on every uid change, so a snapshot that was already in flight for the
 * previous account cannot repopulate the new one.
 *
 * No rules live here. The block rollover is decided by `cardioBlock.ts` and the
 * cardio state written back by it is computed by `planCardioWeek`; this store
 * only decides *when* it is safe to persist them.
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
import { blockWindowStart, type CardioBlockAction, cardioBlockAction } from '@/training/cardioBlock'
import type { CardioWeekPlan } from '@/training/cardioPlan'
import type { Profile, Session } from '@/types'

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
   * What the stored training block owes reality — the rollover decision, made
   * where the stored state lives so the view no longer has to re-derive it.
   *
   * The clock and the session list stay with the caller: this store reads
   * neither, and `cardioBlockAction` is pure.
   */
  function pendingCardioBlock(sessions: Session[], todayIso: string): CardioBlockAction {
    const current = profile.value
    if (!current) return { kind: 'idle' }

    return cardioBlockAction(current.cardioTrack, sessions, todayIso)
  }

  /**
   * Persists one block rollover. `plan` is required for an `advance` and is the
   * plan the block that just ended actually ran: without writing it back, the
   * adaptive step-back and the modality rotation restart every block, and
   * `lastPlannedMinutes` — the divisor the completion ratio needs — is never
   * written at all.
   *
   * Called once per block, never per session: a per-session write would advance
   * the modality cursor several times a week. Returns false when the action no
   * longer matches what is stored, which is what makes a second call (a reload,
   * a second tab, a listener echo) a no-op. The guard is string equality against
   * the stored anchor — no arithmetic, so it cannot disagree with the action it
   * is guarding the way the old `plannedWeekOf` comparison could.
   *
   * A profile written before `blockStartDate` existed loses its legacy
   * `mesoStartDate` on this very write: `updateDoc` replaces `cardioTrack`
   * wholesale, and the slice being spread here no longer carries the field.
   */
  async function adoptCardioBlock(action: CardioBlockAction, plan?: CardioWeekPlan): Promise<boolean> {
    const current = profile.value
    if (!current) throw new Error('No profile loaded')
    if (action.kind === 'idle') return false

    // The legacy anchor is dropped HERE rather than trusted to disappear: the
    // Firestore converter spreads every stored field back onto the object, so a
    // plain `{ ...cardioTrack }` would write `mesoStartDate` out again and the
    // profile would carry it for ever.
    const { mesoStartDate: _legacyAnchor, ...cardioTrack } = current.cardioTrack as typeof current.cardioTrack & {
      mesoStartDate?: string
    }

    if (blockWindowStart(cardioTrack) !== action.from) return false

    // A block nobody trained in re-anchors and touches nothing else. That is the
    // whole point: an absence is not a missed week, and `comeback.ts` owns it.
    if (action.kind !== 'advance') {
      await save({ cardioTrack: { ...cardioTrack, blockStartDate: action.to } })

      return true
    }

    if (!plan) throw new Error('adoptCardioBlock: advancing a block needs the plan it ran')

    await save({
      cardioTrack: {
        ...cardioTrack,
        mesoWeek: plan.nextMesoWeek,
        weeklyMinutes: plan.nextBaseline,
        holdStreak: plan.holdStreak,
        rotationCursor: plan.rotationCursor,
        // What the block just ended actually prescribed, summed over its
        // sessions — not the baseline, which a deload never asks for.
        lastPlannedMinutes: plan.weeklyMinutes,
        blockStartDate: action.to,
      },
    })

    return true
  }

  return { profile, error, bind, reset, ensureProfile, save, pendingCardioBlock, adoptCardioBlock }
})
