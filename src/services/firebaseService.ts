/**
 * Generic Firestore and auth helpers. Everything here is entity-agnostic: it
 * takes a typed `CollectionReference` and moves documents. Per-entity services
 * bind a collection to these and add the queries; no business rule lives here.
 *
 * Two invariants the whole layer rests on: the document id lives in the path
 * and is stripped from every payload (the converter re-attaches it on read),
 * and `createdAt` / `updatedAt` are always `serverTimestamp()` — never a client
 * clock, which on a phone can be minutes off and would reorder history.
 */

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut as signOutFirebase,
  signInWithPopup,
  type User,
  type UserCredential,
} from 'firebase/auth'
import {
  addDoc,
  type CollectionReference,
  deleteDoc,
  doc,
  type DocumentData,
  type FirestoreError,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  type QueryCompositeFilterConstraint,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
  updateDoc,
} from 'firebase/firestore'

import { auth, db, firebaseApp } from '@/services/firebaseApp'

export { auth, db, firebaseApp }

/**
 * `where` / `orderBy` / `limit` and `and()` / `or()` do not share a type, and
 * the SDK's overloads reject the union — hence the single cast in `toQuery`.
 */
export type Constraints = (QueryConstraint | QueryCompositeFilterConstraint)[]

export interface WriteOptions {
  /** Stamp `updatedAt` on every write and `createdAt` when the document is new. */
  withTimestamps?: boolean
  /** Patch instead of replacing the whole document. */
  merge?: boolean
  /**
   * Skip the existence probe when the caller already knows. `true` stamps
   * `createdAt`, `false` leaves it untouched.
   */
  isNew?: boolean
  /** Refuse to overwrite an existing document instead of trusting the caller. */
  createOnly?: boolean
}

const timestampFields = { createdAt: 'createdAt', updatedAt: 'updatedAt' } as const

/**
 * A live listener that dies silently is how a de-allowlisted or signed-out user
 * would experience the app as "stuck loading". Callers should pass their own
 * handler; this is the floor, not the intent.
 */
function defaultErrorHandler(error: FirestoreError): void {
  console.error('[firestore] listener failed', error.code, error.message)
}

/**
 * The same document without its converter. Writes bypass the converter on
 * purpose: the payload is a *partial* document carrying `FieldValue`
 * sentinels, which `toFirestore` is typed to reject and has nothing to do to.
 */
function raw<T>(collection: CollectionReference<T>, id: string) {
  return doc(collection.withConverter(null), id)
}

function toQuery<T>(collection: CollectionReference<T>, constraints: Constraints) {
  return query(collection, ...(constraints as QueryConstraint[]))
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Resolves once with the first auth state Firebase reports, then unsubscribes. */
export function resolveAuthState(): Promise<User | null> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe()
      resolve(user)
    })
  })
}

/** Every subsequent auth change, including token refreshes that sign the user out. */
export function onAuthChanged(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, callback)
}

export function signInWithGoogle(): Promise<UserCredential> {
  return signInWithPopup(auth, new GoogleAuthProvider())
}

export async function signOutUser(): Promise<void> {
  await signOutFirebase(auth)
}

export function currentUser(): User | null {
  return auth.currentUser
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** `undefined` when the document does not exist — callers must handle it. */
export async function loadDocument<T>(collection: CollectionReference<T>, id: string): Promise<T | undefined> {
  return (await getDoc(doc(collection, id))).data()
}

export async function listDocuments<T>(
  collection: CollectionReference<T>,
  constraints: Constraints = [],
): Promise<T[]> {
  return (await getDocs(toQuery(collection, constraints))).docs.map((snapshot) => snapshot.data())
}

/**
 * The same query as `listDocuments`, but keeping the snapshots. Only paging
 * needs them: a `startAfter` cursor built from field values cannot break a tie
 * between two documents sharing a date, while a snapshot cursor always can.
 */
export async function listDocumentSnapshots<T>(
  collection: CollectionReference<T>,
  constraints: Constraints = [],
): Promise<QueryDocumentSnapshot<T>[]> {
  return (await getDocs(toQuery(collection, constraints))).docs
}

export async function documentExists<T>(collection: CollectionReference<T>, id: string): Promise<boolean> {
  return (await getDoc(doc(collection, id))).exists()
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export function subscribeToDocument<T>(
  collection: CollectionReference<T>,
  id: string,
  callback: (data: T | undefined) => void,
  onError: (error: FirestoreError) => void = defaultErrorHandler,
): Unsubscribe {
  return onSnapshot(doc(collection, id), (snapshot) => callback(snapshot.data()), onError)
}

export function subscribeToCollection<T>(
  collection: CollectionReference<T>,
  constraints: Constraints,
  callback: (data: T[]) => void,
  onError: (error: FirestoreError) => void = defaultErrorHandler,
): Unsubscribe {
  return onSnapshot(
    toQuery(collection, constraints),
    (snapshot) => callback(snapshot.docs.map((document) => document.data())),
    onError,
  )
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Is this id unwritten? Offline, `getDoc` for a document absent from the
 * persistent cache rejects with `unavailable` instead of reporting a miss — a
 * document genuinely being resumed is in the cache and answers locally, so
 * "unreadable" is safely read as "new". Never let the probe sink the write:
 * a queued offline mutation is the whole point of this layer.
 */
async function isNewDocument<T>(collection: CollectionReference<T>, id: string): Promise<boolean> {
  try {
    return !(await documentExists(collection, id))
  } catch (error) {
    if ((error as FirestoreError)?.code === 'unavailable') return true
    throw error
  }
}

/**
 * Upsert. With an `id` the document is written at that path, without one
 * Firestore assigns an auto-id; either way the id never reaches the payload.
 * Returns the id written.
 *
 * The existence probe is what makes `createdAt` write-once — re-stamping it on
 * every save would lose the only record of when a session or a profile came
 * into being. It costs a read, usually answered by the persistent cache, and a
 * probe that cannot be answered at all degrades to "treat as new" rather than
 * failing the write. Callers that already know pass `isNew` and skip it.
 */
export async function saveDocument<T extends { id: string }>(
  collection: CollectionReference<T>,
  data: Partial<T> & { id?: string },
  options: WriteOptions = {},
): Promise<string> {
  const { id, ...rest } = data
  const payload: DocumentData = { ...rest }

  if (options.withTimestamps || options.createOnly) {
    // `createOnly` probes strictly: "new" must be a fact, not a fallback, or an
    // offline first write would replace the very document it refuses to touch.
    let isNew = options.isNew
    if (isNew === undefined) {
      if (!id) isNew = true
      else if (options.createOnly) isNew = !(await documentExists(collection, id))
      else isNew = await isNewDocument(collection, id)
    }

    if (options.createOnly && !isNew) {
      throw new Error(`[firestore] ${collection.path}/${id} already exists`)
    }

    if (options.withTimestamps) {
      payload[timestampFields.updatedAt] = serverTimestamp()
      if (isNew) {
        payload[timestampFields.createdAt] = serverTimestamp()
      }
    }
  }

  if (id) {
    await setDoc(raw(collection, id), payload, { merge: options.merge })
    return id
  }

  return (await addDoc(collection.withConverter(null), payload)).id
}

/**
 * Patch an existing document. Fails loudly rather than creating one by accident.
 *
 * `data` also accepts a bag of dotted field paths (`{ 'strengthTrack.rotationCursor': 3 }`),
 * which is the only way to change one field of a nested object without sending
 * a whole — possibly stale — copy of it.
 */
export async function updateDocument<T extends { id: string }>(
  collection: CollectionReference<T>,
  id: string,
  data: Partial<T> | Record<string, unknown>,
  options: Pick<WriteOptions, 'withTimestamps'> = {},
): Promise<void> {
  const { id: _id, ...rest } = data as Partial<T> & { id?: string }
  const payload: DocumentData = { ...rest }

  if (options.withTimestamps) {
    payload[timestampFields.updatedAt] = serverTimestamp()
  }

  await updateDoc(raw(collection, id), payload)
}

export async function deleteDocument<T>(collection: CollectionReference<T>, id: string): Promise<void> {
  await deleteDoc(doc(collection, id))
}
