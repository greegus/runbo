/**
 * Firebase singletons. Imported by `firebaseCollections` and `firebaseService`
 * only — nothing else in the app talks to the SDK directly.
 *
 * Firestore is created here with `initializeFirestore` rather than
 * `getFirestore` because the persistent multi-tab cache and
 * `ignoreUndefinedProperties` can only be passed at initialization, and the
 * cache is runbo's entire offline story: a logged set has to survive a dead
 * signal in a gym basement. `ignoreUndefinedProperties` is load-bearing too —
 * the write helpers spread partial documents straight into `setDoc`, and
 * optional fields (`zones`, `readiness`, …) would otherwise throw.
 */

import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

export const firebaseApp = initializeApp({
  apiKey: import.meta.env.VITE_APP_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_APP_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_APP_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_APP_FIREBASE_MEASUREMENT_ID,
})

export const auth = getAuth(firebaseApp)

export const db = initializeFirestore(firebaseApp, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

// Must run before anything reads or writes: both SDKs refuse to switch hosts
// once the first request is in flight. Keeping it in this module — the one
// every other Firebase module imports — is what guarantees that ordering.
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR) {
  // DECISION: ports are hardcoded from `firebase.json`; a second source of
  // truth in the env would only be a way for the two to disagree.
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
