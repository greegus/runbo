<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from 'vuiii'

import { buildExport, exportFileName } from '@/export/userData'
import { listBodyweightEntries } from '@/services/bodyweightService'
import { useProfileStore } from '@/stores/profile'
import { useSessionsStore } from '@/stores/sessions'
import { toIso } from '@/utils/date'
import { downloadJson } from '@/utils/download'

/**
 * The whole export interaction, inside Settings' existing "Export your data"
 * card. It owns its own state so the section-save machinery around it stays
 * untouched.
 *
 * DECISION: the file download is offered AND the JSON stays on screen. A
 * script-started download is inert in some sandboxed contexts and fails
 * silently — a button that does nothing is indistinguishable from an app that
 * lost the data. The text panel below is the copy that always works.
 */

const profileStore = useProfileStore()
const sessionsStore = useSessionsStore()

const busy = ref(false)
const error = ref<string | null>(null)
const json = ref<string | null>(null)
const counts = ref<{ sessions: number; bodyweightEntries: number } | null>(null)
const copied = ref(false)
const copyError = ref<string | null>(null)

// A `.vue` file may read the clock; the pure module it feeds may not.
const todayIso = computed(() => toIso(new Date()))

const fileName = computed(() => exportFileName(todayIso.value))

async function exportData(): Promise<void> {
  // vuiii's `disabled` is CSS-only, so the handler guards on the same flag.
  if (busy.value) return

  busy.value = true
  error.value = null
  copied.value = false
  copyError.value = null

  try {
    const profile = profileStore.profile
    if (!profile) throw new Error('No profile loaded')

    // Shared with Progress on purpose: `loadAllHistory` is idempotent under
    // concurrency, so the collection is paged once no matter who asked first.
    const [sessions, bodyweight] = await Promise.all([
      sessionsStore.loadAllHistory(),
      listBodyweightEntries(profile.id),
    ])

    const bundle = buildExport(profile, sessions, bodyweight, todayIso.value)

    json.value = JSON.stringify(bundle, null, 2)
    counts.value = { sessions: bundle.counts.sessions, bodyweightEntries: bundle.counts.bodyweightEntries }

    downloadJson(fileName.value, bundle)
  } catch (exportError) {
    console.error('[settings] export failed', exportError)
    error.value = 'We couldn’t build your export. Check your connection and try again.'
  } finally {
    busy.value = false
  }
}

async function copyJson(): Promise<void> {
  const text = json.value
  if (!text) return

  copyError.value = null

  // `writeText` rejects on a denied permission, outside a secure context, or
  // when the document is not focused. This is the fallback for a blocked
  // download, so it is the last path that may fail in silence.
  try {
    if (!navigator.clipboard) throw new Error('Clipboard API unavailable')

    await navigator.clipboard.writeText(text)
  } catch (clipboardError) {
    console.error('[settings] copy failed', clipboardError)
    copyError.value = 'Copying isn’t available here — select the text below instead.'

    return
  }

  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 2000)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-sm text-ink-500">Download your profile, every session and every weigh-in as a JSON file.</p>

    <Button label="Download JSON" size="large" block class="min-h-[48px]" :loading="busy" @click="exportData()" />

    <p v-if="error" role="alert" class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm">{{ error }}</p>

    <!-- The count only ever appears AFTER a successful export: a "0 sessions"
         line printed off an unloaded list would read as an empty history. -->
    <template v-if="json && counts">
      <p role="status" class="text-sm text-ink-700">
        {{ counts.sessions }} {{ counts.sessions === 1 ? 'session' : 'sessions' }}, {{ counts.bodyweightEntries }}
        {{ counts.bodyweightEntries === 1 ? 'weigh-in' : 'weigh-ins' }} exported as {{ fileName }}.
      </p>

      <details class="rounded-lg border border-ink-200">
        <summary class="min-h-[48px] cursor-pointer p-3 text-sm font-medium text-ink-700">
          Show the JSON — if the download didn’t start, copy it from here
        </summary>

        <div class="flex flex-col gap-3 border-t border-ink-200 p-3">
          <Button
            variant="outlined"
            class="min-h-[48px] self-start"
            :label="copied ? 'Copied' : 'Copy JSON'"
            @click="copyJson()"
          />

          <p v-if="copyError" role="alert" class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm">
            {{ copyError }}
          </p>

          <!-- Selectable text, not a link: a viewer that blocks blob downloads
               still lets the athlete select all and paste this into a file. -->
          <pre
            class="max-h-64 overflow-auto rounded bg-ink-50 p-3 font-mono text-xs leading-5 text-ink-800 select-all"
            >{{ json }}</pre>
        </div>
      </details>
    </template>
  </div>
</template>
