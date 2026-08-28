/**
 * The `bodyweight` collection. Same shape as `sessionsService`, minus the
 * paging: a bodyweight log is one small number per day.
 *
 * The `where('uid', '==', uid)` filter is mandatory here too — the rules match
 * on `resource.data.uid` and reject any query that is not provably scoped.
 * Ordering is by `date`, never `createdAt`: `BodyweightEntry` has no timestamp
 * fields, so an entry would silently drop out of a `createdAt` query.
 */

import { type FirestoreError, orderBy, where } from 'firebase/firestore'

import { bodyweightCollection } from '@/constants/firebaseCollections'
import {
  deleteDocument,
  listDocuments,
  loadDocument,
  saveDocument,
  subscribeToCollection,
} from '@/services/firebaseService'
import type { BodyweightEntry } from '@/types'

export async function loadBodyweightEntry(id: string): Promise<BodyweightEntry | undefined> {
  return loadDocument(bodyweightCollection, id)
}

/** Newest first. */
export async function listBodyweightEntries(uid: string): Promise<BodyweightEntry[]> {
  return listDocuments(bodyweightCollection, [where('uid', '==', uid), orderBy('date', 'desc')])
}

export function subscribeToBodyweightEntries(
  uid: string,
  callback: (entries: BodyweightEntry[]) => void,
  onError?: (error: FirestoreError) => void,
): () => void {
  return subscribeToCollection(
    bodyweightCollection,
    [where('uid', '==', uid), orderBy('date', 'desc')],
    callback,
    onError,
  )
}

/**
 * Upsert. `uid` and `date` are required on every write: a merge that omits
 * `uid` is accepted by the local cache and only rejected by the rules on
 * reconnect, losing the entry silently. `isNew` skips the existence probe when
 * the caller already knows.
 */
export async function saveBodyweightEntry(
  entry: Pick<BodyweightEntry, 'id' | 'uid' | 'date'> & Partial<BodyweightEntry>,
  isNew?: boolean,
): Promise<void> {
  await saveDocument(bodyweightCollection, entry, { withTimestamps: true, merge: true, isNew })
}

export async function deleteBodyweightEntry(id: string): Promise<void> {
  await deleteDocument(bodyweightCollection, id)
}
