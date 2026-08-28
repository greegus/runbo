/**
 * The auth state machine the router guard and `App.vue` sit on.
 *
 * `status` is the only thing the rest of the app reads, and it is a plain
 * reactive value rather than a promise: the guard `watch`es it, and a promise
 * cannot be watched. It starts at 'loading' and `init()` owns that window —
 * every path out of it, success or failure, ends on a terminal status, because
 * a `status` left at 'loading' hangs the guard forever with nothing on screen
 * to say why.
 *
 * The store also owns the per-account teardown: a Google account switch without
 * a reload must drop the previous uid's listeners BEFORE anything subscribes
 * for the new one, or a surviving snapshot writes the old account's documents
 * into the new account's store.
 */

import { FirebaseError } from 'firebase/app'
import type { User } from 'firebase/auth'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

import { isAllowlisted } from '@/services/allowlistService'
import { onAuthChanged, signInWithGoogle, signOutUser } from '@/services/firebaseService'
import { useProfileStore } from '@/stores/profile'
import { useSessionsStore } from '@/stores/sessions'

export type AuthStatus = 'loading' | 'signedOut' | 'notAllowlisted' | 'ready'

/** Codes Firebase reports when the user backed out of the popup themselves. */
const CANCELLED_POPUP_CODES = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']

function isCancelledByUser(error: unknown): boolean {
  return error instanceof FirebaseError && CANCELLED_POPUP_CODES.includes(error.code)
}

export const useAuthStore = defineStore('auth', () => {
  // shallowRef: a Firebase `User` is a live SDK object with internal state, not
  // plain data — wrapping it in a deep reactive proxy buys nothing and hands
  // the SDK a proxy of itself.
  const user = shallowRef<User | null>(null)
  const status = shallowRef<AuthStatus>('loading')

  let initPromise: Promise<void> | null = null

  /**
   * Guards against an out-of-order finish: the allowlist read and the profile
   * fetch are awaited, and a second auth event during either of them must win.
   */
  let sequence = 0

  async function applyUser(nextUser: User | null): Promise<void> {
    const ticket = ++sequence
    const previousUid = user.value?.uid
    const isSameAccount = nextUser !== null && nextUser.uid === previousUid

    user.value = nextUser

    // Token refreshes re-fire the listener for the same account; re-running the
    // whole resolution there would flash the boot screen on every refresh.
    if (isSameAccount && status.value === 'ready') return

    if (!isSameAccount) {
      useProfileStore().reset()
      useSessionsStore().reset()
    }

    if (!nextUser) {
      status.value = 'signedOut'
      return
    }

    status.value = 'loading'

    try {
      const check = await isAllowlisted(nextUser.email)
      if (ticket !== sequence) return

      if (!check.allowed) {
        // DECISION: a failed allowlist read ('unavailable') lands here too. The
        // rules deny every other collection to a caller they cannot verify, so
        // there is nothing else to show, and this is the one state that offers
        // a way out (sign in with another account).
        status.value = 'notAllowlisted'
        return
      }

      await useProfileStore().bind(nextUser.uid, nextUser.email ?? '')
      if (ticket !== sequence) return

      useSessionsStore().bind(nextUser.uid)
      status.value = 'ready'
    } catch (error) {
      if (ticket !== sequence) return

      console.error('[auth] could not resolve the account', error)
      // Fail closed, but stay live: 'signedOut' sends the guard to /signin,
      // where the user can retry. 'loading' would strand the app.
      status.value = 'signedOut'
    }
  }

  /**
   * Starts listening. Called once from `main.ts` before the router mounts —
   * nothing else moves `status` off 'loading'. The returned promise settles
   * with the first resolved auth state.
   */
  function init(): Promise<void> {
    initPromise ??= new Promise<void>((resolve) => {
      onAuthChanged((nextUser) => {
        void applyUser(nextUser).finally(resolve)
      })
    })

    return initPromise
  }

  /**
   * Resolves silently when the user closed or superseded the popup — that is a
   * decision, not a failure, and the spec asks for no toast. Everything else
   * (a blocked popup, a network error) is rethrown for the view to phrase.
   */
  async function signIn(): Promise<void> {
    try {
      await signInWithGoogle()
    } catch (error) {
      if (isCancelledByUser(error)) return
      throw error
    }

    // The listener does the real work; this only keeps the button in its
    // loading state over the gap between the popup closing and it firing.
    if (status.value !== 'ready') status.value = 'loading'
  }

  /** Teardown is the listener's job — it fires with `null` right after this. */
  async function signOut(): Promise<void> {
    await signOutUser()
  }

  return { user, status, init, signIn, signOut }
})
