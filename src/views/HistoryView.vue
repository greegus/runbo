<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, useDialogStack } from 'vuiii'

import HistoryRow from '@/components/history/HistoryRow.vue'
import { deleteConfirmCopy, groupByMonth, isDeletable, type HistoryEntry } from '@/session/historyList'
import { useProfileStore } from '@/stores/profile'
import { useSessionsStore } from '@/stores/sessions'

/**
 * Every session the athlete has logged, newest first — and the only route in
 * the app to deleting one.
 *
 * History is read-only: a finished session is never edited, and exactly one row
 * — the newest — may be deleted, which puts the program back to the state that
 * session was recorded against. That restore lives entirely inside the store's
 * batch; nothing here touches the profile.
 */
const profileStore = useProfileStore()
const sessionsStore = useSessionsStore()
const dialog = useDialogStack()

const profile = computed(() => profileStore.profile)

/**
 * The third state. The store has no `isLoaded` for the paged history, and an
 * empty list before the first page answers means "not asked yet", not "nothing
 * logged" — the difference between a skeleton and telling a returning athlete
 * their training never happened.
 */
const firstPageResolved = ref(false)
/** A failed first page is a failure, not an empty history — it gets its own state and a retry. */
const firstPageError = ref<string | null>(null)
const pageError = ref<string | null>(null)

/**
 * Firestore resolves a write only when the SERVER acknowledges it, while the
 * delete — and the profile restore batched with it — is durable in the
 * persistent cache the moment it is written. Offline that means a promise that
 * never settles, so the screen waits a short while for the ack and then carries
 * on, exactly as the session screens do.
 */
const QUEUED = Symbol('queued')
const QUEUED_AFTER_MS = 2500

function settleOrQueued<T>(write: Promise<T>): Promise<T | typeof QUEUED> {
  return Promise.race([
    write,
    new Promise<typeof QUEUED>((resolve) => setTimeout(() => resolve(QUEUED), QUEUED_AFTER_MS)),
  ])
}

const expandedId = ref<string | null>(null)
const busyId = ref<string | null>(null)
const rowError = ref<{ id: string; message: string } | null>(null)
/** Persistent, not a snackbar: what the delete actually did is worth reading twice. */
const notice = ref<string | null>(null)

const groups = computed(() => (profile.value ? groupByMonth(sessionsStore.history, profile.value) : []))

/**
 * Recomputed from the whole loaded list, never from a row index: `isDeletable`
 * is the only thing standing between the athlete tapping row two and the store
 * deleting whatever the server currently considers newest.
 */
function deletable(entry: HistoryEntry): boolean {
  return isDeletable(entry.session, sessionsStore.history)
}

async function loadFirstPage(): Promise<void> {
  firstPageResolved.value = false
  firstPageError.value = null
  pageError.value = null
  sessionsStore.resetHistory()

  try {
    await sessionsStore.loadMoreHistory()
  } catch (error) {
    console.error('[history] first page failed', error)
    firstPageError.value = 'Your history could not be loaded. Check your connection and try again.'
  } finally {
    firstPageResolved.value = true
  }
}

/**
 * Keyed on the uid rather than on the list being empty, so a second account
 * signing in without a reload cannot read the first one's sessions.
 */
watch(
  () => profileStore.profile?.id,
  (uid) => {
    if (uid) void loadFirstPage()
    else {
      sessionsStore.resetHistory()
      firstPageResolved.value = false
      firstPageError.value = null
      pageError.value = null
    }
  },
  { immediate: true },
)

async function loadMore(): Promise<void> {
  if (!sessionsStore.hasMoreHistory || sessionsStore.isLoadingHistory) return

  notice.value = null
  pageError.value = null
  try {
    await sessionsStore.loadMoreHistory()
  } catch (error) {
    console.error('[history] load more failed', error)
    pageError.value = 'Could not load more sessions. Try again.'
  }
}

function toggle(entry: HistoryEntry, expanded: boolean): void {
  expandedId.value = expanded ? entry.session.id : null
}

/**
 * The delete. Guarded on the handler as well as on the styling, and `busy` is
 * raised BEFORE the confirm: the dialog is an async gap, and a second
 * activation across it would queue a second batch against a list that has
 * already moved.
 */
async function remove(entry: HistoryEntry): Promise<void> {
  if (!deletable(entry) || busyId.value !== null) return

  busyId.value = entry.session.id
  rowError.value = null
  notice.value = null

  try {
    const confirmed = await dialog.confirm(deleteConfirmCopy(entry))
    if (!confirmed) return

    // The list may have gained a session while the dialog was open.
    if (!deletable(entry)) {
      rowError.value = {
        id: entry.session.id,
        message: 'That is no longer your most recent session — reload History.',
      }
      return
    }

    const deleted = await settleOrQueued(sessionsStore.deleteLastSession())

    if (deleted === QUEUED) {
      // Already gone from the local cache — including the restored program
      // state — but unacknowledged, so the notice is worded from the tapped row
      // and promises nothing the server has not confirmed. The refresh below
      // reads the same cache, so the row is already gone from the list.
      notice.value = `Deleted ${entry.title} of ${entry.human} on this device. It will sync when you’re back online.`
    } else if (deleted === null) {
      rowError.value = { id: entry.session.id, message: 'There was nothing left to delete.' }
      return
    } else if (deleted.id !== entry.session.id) {
      // The store asks the server which session is newest, and the server
      // disagreed with this page. Saying so is the only honest option: claiming
      // to have deleted the tapped row would be a lie about the athlete's data.
      notice.value = `Deleted your most recent session (${deleted.kind} of ${deleted.date}) instead — the list was out of date.`
    } else {
      notice.value = deleted.stateSnapshot
        ? `Deleted ${entry.title} of ${entry.human}. Your program is back to the weights it had before it.`
        : `Deleted ${entry.title} of ${entry.human}.`
    }

    expandedId.value = null
    sessionsStore.resetHistory()
    await sessionsStore.loadMoreHistory()
  } catch (error) {
    console.error('[history] delete failed', error)
    rowError.value = {
      id: entry.session.id,
      message: 'That did not go through. Nothing was deleted — try again.',
    }
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <section class="mx-auto flex max-w-lg flex-col gap-4 p-4">
    <h1 class="text-2xl font-bold text-ink-900">History</h1>

    <!-- Loading is not empty. -->
    <div v-if="!profile || !firstPageResolved" role="status" aria-busy="true" class="flex flex-col gap-3">
      <span class="sr-only">Loading your history…</span>
      <div v-for="index in 3" :key="index" class="h-20 animate-pulse rounded-xl border border-ink-200 bg-ink-50" />
    </div>

    <template v-else>
      <p v-if="notice" role="status" class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-700">
        {{ notice }}
      </p>

      <!-- A load that failed is not an empty history: telling a returning
           athlete their training never happened is the worse lie of the two. -->
      <div
        v-if="firstPageError"
        role="alert"
        class="flex flex-col gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm"
      >
        <p class="text-ink-900">{{ firstPageError }}</p>
        <Button label="Try again" variant="outlined" class="min-h-[48px]" @click="loadFirstPage()" />
      </div>

      <!-- `isLoadingHistory` matters here because a delete empties the list and
           re-pages it: without it the athlete reads "no finished sessions yet"
           directly under the notice saying what was just deleted. -->
      <div
        v-else-if="groups.length === 0 && !sessionsStore.isLoadingHistory"
        class="flex flex-col gap-3 rounded-xl border border-ink-200 bg-white p-4"
      >
        <p class="text-ink-900">
          No finished sessions yet. Your first logged session shows up here, and you can delete the most recent one if
          you log it by mistake.
        </p>
        <Button label="Go to Today" :to="{ name: 'today' }" class="min-h-[48px]" />
      </div>

      <template v-else>
        <section v-for="group in groups" :key="group.key" class="flex flex-col gap-2">
          <h2 class="text-sm font-semibold tracking-wide text-ink-500 uppercase">{{ group.label }}</h2>
          <ul role="list" class="flex flex-col gap-2">
            <HistoryRow
              v-for="entry in group.entries"
              :key="entry.session.id"
              :entry="entry"
              :profile="profile"
              :expanded="expandedId === entry.session.id"
              :deletable="deletable(entry)"
              :busy="busyId === entry.session.id"
              :error="rowError?.id === entry.session.id ? rowError.message : null"
              @update:expanded="toggle(entry, $event)"
              @delete="remove(entry)"
            />
          </ul>
        </section>

        <Button
          v-if="sessionsStore.hasMoreHistory"
          label="Load more"
          variant="outlined"
          block
          class="min-h-[48px]"
          :loading="sessionsStore.isLoadingHistory"
          :disabled="sessionsStore.isLoadingHistory"
          :aria-disabled="sessionsStore.isLoadingHistory"
          @click="loadMore"
        />

        <p v-if="pageError" role="alert" class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm">
          {{ pageError }}
        </p>

        <!-- Said once, at the bottom, rather than as a disabled button on 200 rows. -->
        <p class="text-sm text-ink-500">History is read-only. Only your most recent session can be deleted.</p>
      </template>
    </template>
  </section>
</template>
