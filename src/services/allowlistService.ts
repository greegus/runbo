/**
 * `config/allowlist` — the single document that decides who may use the app.
 * It is readable by any signed-in user precisely so SignInView can tell "not
 * allowlisted" from "not signed in" and show the ask-for-access state.
 *
 * A missing document and a failed read both mean "not allowed", because that is
 * what the security rules do with them. They are reported apart so the UI can
 * say something true: one is "your account is not on the list", the other is
 * "we could not check" — telling a user with a flaky connection that they have
 * been thrown out would be a lie.
 */

import { type AllowlistConfig, configCollection } from '@/constants/firebaseCollections'
import { loadDocument } from '@/services/firebaseService'

/** The document id inside `config`. */
export const ALLOWLIST_DOC_ID = 'allowlist'

export type AllowlistStatus = 'allowed' | 'notListed' | 'missingConfig' | 'unavailable'

export interface AllowlistCheck {
  allowed: boolean
  status: AllowlistStatus
  /** Set only when `status === 'unavailable'`. */
  error?: unknown
}

/** `undefined` when the document does not exist; throws only on a failed read. */
export async function loadAllowlist(): Promise<AllowlistConfig | undefined> {
  return loadDocument(configCollection, ALLOWLIST_DOC_ID)
}

/**
 * Case-insensitive on both sides. Firestore's `in` operator in the rules is
 * byte-exact, so console entries must be lowercase — matching that here keeps
 * the client's answer and the server's answer the same.
 */
export async function isAllowlisted(email: string | null | undefined): Promise<AllowlistCheck> {
  if (!email) return { allowed: false, status: 'notListed' }

  let config: AllowlistConfig | undefined
  try {
    config = await loadAllowlist()
  } catch (error) {
    return { allowed: false, status: 'unavailable', error }
  }

  if (!config || !Array.isArray(config.emails)) {
    return { allowed: false, status: 'missingConfig' }
  }

  const normalized = email.toLowerCase()
  const allowed = config.emails.some((entry) => entry.toLowerCase() === normalized)

  return { allowed, status: allowed ? 'allowed' : 'notListed' }
}
