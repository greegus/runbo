/**
 * Where a change in the auth status has to move the app, independently of the
 * router guard.
 *
 * The guard only runs on a navigation, and signing in is not one: the user is
 * already sitting on `/signin` when the status flips to 'ready', so without a
 * status-driven push nothing takes them anywhere and the sign-in screen simply
 * comes back. The mirror case — a sign-out, or a session that expired — is the
 * same problem in the other direction.
 *
 * It is a pure function so the decision is testable without a router: the
 * caller is a single watcher in `App.vue`, which is mounted for the whole life
 * of the app. It must NOT live in a view — `App.vue` swaps `RouterView` for the
 * boot screen while `status === 'loading'`, which unmounts the sign-in screen
 * mid-sign-in and stops any watcher it owned before 'ready' ever arrives.
 */

import type { AuthStatus } from '@/stores/auth'

/** `null` when the current screen is already the right one for this status. */
export type AuthRedirect = 'signin' | 'today' | null

export function authRedirect(status: AuthStatus, currentRouteName: string | null): AuthRedirect {
  // Still resolving: the guard holds the first navigation, and a push here
  // would only race it.
  if (status === 'loading') return null

  // 'signedOut' and 'notAllowlisted' both belong on SignInView, which renders
  // the ask-for-access state itself.
  if (status !== 'ready') return currentRouteName === 'signin' ? null : 'signin'

  // Signed in and allowed. Anywhere but the sign-in screen is already a valid
  // place to be; the guard decides whether 'today' means onboarding.
  return currentRouteName === 'signin' ? 'today' : null
}
