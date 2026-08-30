/**
 * Bodyweight entries for the signed-in athlete.
 *
 * One number per day, so `add` overwrites the day rather than appending: a
 * second weigh-in on the same morning is a correction, not a second data point,
 * and a chart drawn from both would show a jitter that never happened.
 */

import type { FirestoreError } from 'firebase/firestore'
import { defineStore } from 'pinia'
import { v4 as uuid } from 'uuid'
import { shallowRef } from 'vue'

import { deleteBodyweightEntry, saveBodyweightEntry, subscribeToBodyweightEntries } from '@/services/bodyweightService'
import { useProfileStore } from '@/stores/profile'
import type { BodyweightEntry } from '@/types'

export const useBodyweightStore = defineStore('bodyweight', () => {
  /** Newest first, as the service orders them. */
  const entries = shallowRef<BodyweightEntry[]>([])
  const error = shallowRef<FirestoreError | null>(null)

  let unsubscribe: (() => void) | null = null
  let boundUid: string | null = null

  function reset(): void {
    unsubscribe?.()
    unsubscribe = null
    boundUid = null
    entries.value = []
    error.value = null
  }

  function bind(uid: string): void {
    reset()
    boundUid = uid

    unsubscribe = subscribeToBodyweightEntries(
      uid,
      (next) => {
        if (boundUid === uid) entries.value = next
      },
      (listenerError) => {
        console.error('[bodyweight] listener failed', listenerError.code, listenerError.message)
        error.value = listenerError
      },
    )
  }

  function entryOn(dateIso: string): BodyweightEntry | undefined {
    return entries.value.find((entry) => entry.date === dateIso)
  }

  /** Writes today's weight, replacing an earlier entry for the same day. */
  async function add(dateIso: string, weight: number): Promise<void> {
    const profile = useProfileStore().profile
    if (!profile) throw new Error('No profile loaded')

    const existing = entryOn(dateIso)

    await saveBodyweightEntry(
      { id: existing?.id ?? uuid(), uid: profile.id, date: dateIso, weight },
      existing === undefined,
    )
  }

  async function remove(id: string): Promise<void> {
    await deleteBodyweightEntry(id)
  }

  return { entries, error, bind, reset, entryOn, add, remove }
})
