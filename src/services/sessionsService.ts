/**
 * The `sessions` collection.
 *
 * Every query here filters on `where('uid', '==', uid)`. That is not belt and
 * braces: the security rule reads `resource.data.uid`, and Firestore rejects a
 * whole query it cannot prove is scoped to the caller — an unfiltered list
 * fails with `permission-denied` rather than returning someone else's rows.
 * All of these are served by the `uid ASC, date DESC` composite index.
 */

import { type FirestoreError, limit, orderBy, type QueryDocumentSnapshot, startAfter, where } from 'firebase/firestore'

import { sessionsCollection } from '@/constants/firebaseCollections'
import {
  deleteDocument,
  listDocuments,
  listDocumentSnapshots,
  loadDocument,
  saveDocument,
  subscribeToCollection,
} from '@/services/firebaseService'
import type { Session } from '@/types'

/** Opaque paging cursor — the last document of the previous page. */
export type SessionCursor = QueryDocumentSnapshot<Session>

export interface SessionPage {
  sessions: Session[]
  /** Pass back into `listSessionHistory` for the next page; `null` at the end. */
  cursor: SessionCursor | null
  hasMore: boolean
}

export async function loadSession(id: string): Promise<Session | undefined> {
  return loadDocument(sessionsCollection, id)
}

/** Inclusive on both ends; `from` / `to` are ISO `YYYY-MM-DD`. */
export async function listSessionsInRange(uid: string, from: string, to: string): Promise<Session[]> {
  return listDocuments(sessionsCollection, [
    where('uid', '==', uid),
    where('date', '>=', from),
    where('date', '<=', to),
    orderBy('date', 'desc'),
  ])
}

/** The live query the week composer reads — typically this week plus the last. */
export function subscribeToSessionsInRange(
  uid: string,
  from: string,
  to: string,
  callback: (sessions: Session[]) => void,
  onError?: (error: FirestoreError) => void,
): () => void {
  return subscribeToCollection(
    sessionsCollection,
    [where('uid', '==', uid), where('date', '>=', from), where('date', '<=', to), orderBy('date', 'desc')],
    callback,
    onError,
  )
}

/**
 * One page of history, newest first. The cursor is a snapshot rather than a
 * date because several sessions share a date routinely (a lift and a run on the
 * same day), and a value cursor would drop or repeat them at a page boundary.
 */
export async function listSessionHistory(
  uid: string,
  pageSize: number,
  cursor: SessionCursor | null = null,
): Promise<SessionPage> {
  // One extra document is what tells "the page is full" from "there is more".
  const snapshots = await listDocumentSnapshots(sessionsCollection, [
    where('uid', '==', uid),
    orderBy('date', 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(pageSize + 1),
  ])

  const page = snapshots.slice(0, pageSize)

  return {
    sessions: page.map((snapshot) => snapshot.data()),
    cursor: page.at(-1) ?? null,
    hasMore: snapshots.length > pageSize,
  }
}

/** The most recent session by date, whatever its status. */
export async function loadLatestSession(uid: string): Promise<Session | undefined> {
  const [session] = await listDocuments(sessionsCollection, [
    where('uid', '==', uid),
    orderBy('date', 'desc'),
    limit(1),
  ])
  return session
}

/**
 * Upsert. The caller owns the id, so a half-written session can be resumed.
 *
 * `uid`, `date`, `kind` and `status` are required on every write: a merge that
 * omits `uid` is accepted by the local cache and only rejected by the rules on
 * reconnect, which silently drops the session with nothing shown to the user.
 *
 * `isNew` skips the existence probe. Pass `true` when starting a session and
 * `false` for the set-by-set saves that follow — an unanswerable probe is
 * harmless but it still costs a round trip on every logged set.
 */
export async function saveSession(
  session: Pick<Session, 'id' | 'uid' | 'date' | 'kind' | 'status'> & Partial<Session>,
  isNew?: boolean,
): Promise<void> {
  await saveDocument(sessionsCollection, session, { withTimestamps: true, merge: true, isNew })
}

export async function deleteSession(id: string): Promise<void> {
  await deleteDocument(sessionsCollection, id)
}
