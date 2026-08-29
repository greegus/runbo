<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button, Checkbox, FilePicker, Icon } from 'vuiii'

import {
  CORRUPT_HISTORY_MESSAGE,
  importLiftosaurHistory,
  NOT_AN_EXPORT_MESSAGE,
  WRONG_EXPORT_MESSAGE,
  type ImportResult,
} from '@/import/liftosaurHistory'
import { safeImportReason } from '@/onboarding/deriveCopy'

const props = defineProps<{
  uid: string
  units: 'kg' | 'lb'
}>()

const emit = defineEmits<{ result: [value: ImportResult | null] }>()

/**
 * A Liftosaur export is one JSON file, so there is no streaming to be had: the
 * whole thing is read into a string before anything can be parsed. Past this
 * size that read is what runs a phone out of memory, so it is refused with a
 * sentence rather than attempted and lost.
 */
const MAX_FILE_BYTES = 25 * 1024 * 1024

const fileName = ref<string | null>(null)
const rawText = ref<string | null>(null)
const readError = ref<string | null>(null)
const includeInProgress = ref(false)
const expanded = ref<Set<string>>(new Set())
const busy = ref(false)

/**
 * `importLiftosaurHistory` is total: every input, including rubbish, comes back
 * as a report. It is nonetheless a whole-file `JSON.parse` plus a walk of every
 * set, so it runs from an explicit async step rather than a computed: a computed
 * would block the render it is part of, and a multi-year export would freeze the
 * screen with nothing on it to say why.
 */
const result = ref<ImportResult | null>(null)

async function runImport(): Promise<void> {
  const text = rawText.value
  if (text === null) {
    result.value = null

    return
  }

  busy.value = true
  // Two hops, not one: `nextTick` gets the status line into the DOM and the
  // macrotask gap gives the browser the chance to actually paint it before the
  // parse takes the main thread.
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))

  try {
    result.value = importLiftosaurHistory(text, {
      uid: props.uid,
      units: props.units,
      includeInProgress: includeInProgress.value,
    })
  } finally {
    busy.value = false
  }
}

const report = computed(() => result.value?.report ?? null)

/** The three failure constants are compared by identity — the message itself is rendered verbatim. */
const remedy = computed(() => {
  switch (report.value?.failure) {
    case NOT_AN_EXPORT_MESSAGE:
      return 'In Liftosaur, open Settings → Export data to JSON file, then pick the file it saves.'
    case WRONG_EXPORT_MESSAGE:
      return 'That is the program-text or CSV export. The JSON export is the separate “Export data to JSON file” button.'
    case CORRUPT_HISTORY_MESSAGE:
      return 'Try exporting again from Liftosaur. If the new file does the same, you can skip this and start from your program alone.'
    default:
      return ''
  }
})

const unitsConverted = computed(
  () => report.value?.sourceUnits !== undefined && report.value.sourceUnits !== props.units,
)

/** Skips are grouped so a messy export does not produce one row per set. */
const skipGroups = computed(() => {
  const groups = new Map<string, { reason: string; message: string; refs: string[] }>()

  for (const skip of report.value?.skipped ?? []) {
    const existing = groups.get(skip.reason)
    if (existing) existing.refs.push(skip.ref)
    else groups.set(skip.reason, { reason: skip.reason, message: safeImportReason(skip.reason), refs: [skip.ref] })
  }

  return [...groups.values()]
})

const notes = computed(() =>
  (report.value?.notes ?? []).map((note) => ({ ...note, message: safeImportReason(note.reason) })),
)

async function onFiles(files: File[]): Promise<void> {
  const file = files[0]
  if (!file) return

  fileName.value = file.name
  readError.value = null

  if (file.size > MAX_FILE_BYTES) {
    rawText.value = null
    result.value = null
    readError.value = `That file is ${Math.round(file.size / 1024 / 1024)} MB — too big for us to read on a phone. You can skip this and start from your program alone.`

    return
  }

  busy.value = true
  try {
    // Reading the file is the view's job; making sense of the text is the
    // module's. Nothing here inspects the contents.
    rawText.value = await file.text()
  } catch {
    rawText.value = null
    result.value = null
    readError.value = 'We couldn’t read that file. Try picking it again.'
  } finally {
    busy.value = false
  }

  await runImport()
}

function clear(): void {
  fileName.value = null
  rawText.value = null
  result.value = null
  readError.value = null
  expanded.value = new Set()
}

function toggle(reason: string): void {
  const next = new Set(expanded.value)
  if (next.has(reason)) next.delete(reason)
  else next.add(reason)
  expanded.value = next
}

// The count of unfinished workouts is not knowable without re-running the
// import, so the switch re-runs it over the text already in hand.
watch(includeInProgress, () => runImport())

watch(result, (value) => emit('result', value), { immediate: true })
</script>

<template>
  <section class="flex flex-col gap-4">
    <div>
      <h3 class="text-base font-semibold text-ink-900">Bring your training history (optional)</h3>
      <p class="mt-1 text-sm text-ink-500">
        In Liftosaur: Settings → Export data to JSON file. With it we can work out the weight and the stage you are
        actually on; without it every lift starts from your program text alone.
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <FilePicker :disabled="busy" accept="application/json,.json" label="Choose JSON file" @files="onFiles" />
      <span v-if="fileName" class="text-sm text-ink-700">{{ fileName }}</span>
      <Button
        v-if="fileName"
        variant="text"
        class="min-h-[48px]"
        label="Remove file"
        :disabled="busy"
        @click="clear()"
      />
    </div>

    <p v-if="readError" role="alert" class="text-sm text-accent-700">{{ readError }}</p>

    <!-- Reading and parsing a long history blocks the main thread; without this
         line the screen simply stops responding and reads as a crash. -->
    <p v-if="busy" role="status" class="text-sm text-ink-500">Reading your file…</p>

    <template v-if="report && !busy">
      <!-- A whole-import failure: the module's own message verbatim, plus the one
           thing the user can do about it. -->
      <div
        v-if="report.failure"
        role="alert"
        class="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm text-ink-700"
      >
        <Icon name="alert" class="mt-0.5 shrink-0 text-accent-600" />
        <span>
          <span class="block font-semibold text-ink-900">{{ report.failure }}</span>
          <span v-if="remedy" class="mt-1 block">{{ remedy }}</span>
        </span>
      </div>

      <template v-else>
        <!-- An empty history is a success, not a failure: "we read your file and
             it had nothing in it" is a different sentence from "we couldn't read
             your file", and confusing the two sends the user hunting for a
             problem that does not exist. -->
        <p role="status" class="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm text-ink-700">
          <Icon name="check" class="mt-0.5 shrink-0 text-accent-600" />
          <span>
            <template v-if="report.imported === 0"> We read your file; it contained no finished workouts. </template>
            <template v-else>
              We read <strong>{{ report.imported }}</strong> {{ report.imported === 1 ? 'workout' : 'workouts' }} from
              your file.
            </template>
            <span v-if="unitsConverted" class="mt-1 block">
              Your export was in {{ report.sourceUnits }}; weights were converted to {{ units }}.
            </span>
          </span>
        </p>

        <Checkbox
          v-model="includeInProgress"
          switch
          label="Include workouts you never finished"
          description="Their reps are what was prescribed, not what you did."
        />

        <div v-if="skipGroups.length" class="flex flex-col gap-2">
          <h4 class="text-sm font-semibold text-ink-900">What we had to leave out</h4>

          <div v-for="group in skipGroups" :key="group.reason" class="rounded-lg border border-ink-200">
            <button
              type="button"
              class="flex w-full min-h-[48px] items-center gap-3 p-3 text-left"
              :aria-expanded="expanded.has(group.reason)"
              @click="toggle(group.reason)"
            >
              <span class="shrink-0 rounded bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-700">
                {{ group.refs.length }}
              </span>
              <span class="flex-1 text-sm text-ink-900">{{ group.message }}</span>
              <Icon :name="expanded.has(group.reason) ? 'chevron-up' : 'chevron-down'" class="shrink-0 text-ink-400" />
            </button>

            <ul v-if="expanded.has(group.reason)" class="border-t border-ink-200 bg-ink-50 p-3 text-xs text-ink-700">
              <li v-for="(where, index) in group.refs" :key="`${where}:${index}`" class="py-0.5 font-mono">
                {{ where }}
              </li>
            </ul>
          </div>
        </div>

        <div v-if="notes.length" class="flex flex-col gap-1">
          <h4 class="text-sm font-semibold text-ink-900">Things worth knowing</h4>
          <p v-for="note in notes" :key="note.reason" class="text-sm text-ink-700">
            {{ note.message }} <span class="text-ink-500">({{ note.count }})</span>
            <span v-if="note.detail" class="text-ink-500">— {{ note.detail }}</span>
          </p>
        </div>
      </template>
    </template>
  </section>
</template>
