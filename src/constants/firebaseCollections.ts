/**
 * Typed Firestore collection references. Services import these instead of
 * naming collections, so no path string ever leaves this file.
 *
 * The converter owns two contracts: the document id lives in the path and is
 * re-attached on read (never stored as a field), and `createdAt` / `updatedAt`
 * come back as JS `Date`s. Both are optional-chained — a document written
 * without timestamps reads them back as `undefined`, which the domain types
 * already allow.
 */

import { collection, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore'

import { db } from '@/services/firebaseApp'
import type { BodyweightEntry, Profile, Session } from '@/types'

/**
 * `config/allowlist`. Not in `types.ts` because no domain module knows about
 * it: only `allowlistService` and the security rules read it.
 * DECISION: modelled with an `id` so it can share `createConvertor`.
 */
export interface AllowlistConfig {
  id: string
  emails: string[]
}

export const COLLECTIONS = {
  profiles: 'profiles',
  sessions: 'sessions',
  bodyweight: 'bodyweight',
  config: 'config',
} as const

const createConvertor = <T extends { id: string }>() => ({
  toFirestore(item: T): DocumentData {
    const { id: _id, ...data } = item
    return data
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): T {
    const data = snapshot.data()

    return {
      id: snapshot.id,
      ...data,
      createdAt: data.createdAt?.toDate(),
      updatedAt: data.updatedAt?.toDate(),
    } as unknown as T
  },
})

/** Doc id == the Firebase uid. */
export const profilesCollection = collection(db, COLLECTIONS.profiles).withConverter(createConvertor<Profile>())

export const sessionsCollection = collection(db, COLLECTIONS.sessions).withConverter(createConvertor<Session>())

export const bodyweightCollection = collection(db, COLLECTIONS.bodyweight).withConverter(
  createConvertor<BodyweightEntry>(),
)

/** Readable by any signed-in user — that is how SignInView tells "not allowlisted" from "not signed in". */
export const configCollection = collection(db, COLLECTIONS.config).withConverter(createConvertor<AllowlistConfig>())
