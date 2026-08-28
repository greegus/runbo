/**
 * Pinia plugin that mirrors an opted-in store's state into localStorage.
 *
 * For UI preferences ONLY — every piece of user data (profile, sessions,
 * bodyweight) lives in Firestore and is subscribed to from there. Nothing here
 * is a cache of, or a fallback for, remote state.
 *
 * Storage is best-effort: a missing, corrupt or unreadable value, and a
 * localStorage that throws outright (private mode, blocked site data), all fall
 * back to the store's declared initial state instead of breaking startup.
 */

import type { PiniaPluginContext } from 'pinia'

declare module 'pinia' {
  export interface DefineStoreOptionsBase<S, Store> {
    persist?: boolean
  }
}

const STORAGE_PREFIX = 'runbo:'
const WRITE_DEBOUNCE_MS = 300

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, state: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // Quota exceeded or storage blocked: a lost UI preference is not worth an
    // exception on a hot mutation path.
  }
}

function drop(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing to do — the next read will fail the same way and be ignored.
  }
}

export function persistPlugin({ store, options }: PiniaPluginContext): void {
  if (!options.persist) return

  const storageKey = `${STORAGE_PREFIX}${store.$id}`
  const saved = read(storageKey)

  if (saved !== null) {
    try {
      // $patch merges, so state keys added since the save keep their defaults.
      store.$patch(JSON.parse(saved))
    } catch {
      // A truncated or hand-edited blob would otherwise throw out of the first
      // useXStore() call and kill app startup on every reload, so clear it.
      drop(storageKey)
    }
  }

  // Serializing the whole state on every mutation is wasteful, so writes are
  // debounced and flushed when the page is being left. `pagehide` rather than
  // `beforeunload`: it is the event mobile Safari actually fires with bfcache.
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    write(storageKey, store.$state)
  }

  store.$subscribe(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, WRITE_DEBOUNCE_MS)
  })

  window.addEventListener('pagehide', () => {
    if (timer) {
      clearTimeout(timer)
      flush()
    }
  })
}
