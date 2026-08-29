<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Button, Checkbox, FormGroup, Icon, Input, RadioGroup, Select } from 'vuiii'

import DiagnosticsList from '@/components/DiagnosticsList.vue'
import type { DeriveReport } from '@/import/deriveState'
import { CONFIDENCE_COPY, KEY_RESOLUTION_COPY, MATCH_COPY, UNMATCHED_COPY } from '@/onboarding/deriveCopy'
import { dedupeUnmatched } from '@/onboarding/derivedRows'
import type { DerivedRow, GymSettings } from '@/onboarding/types'
import { formatPlatesForWeight } from '@/training/plates'
import { formatHuman } from '@/utils/date'

const props = defineProps<{
  modelValue: DerivedRow[]
  report: DeriveReport
  settings: GymSettings
}>()

const emit = defineEmits<{ 'update:modelValue': [value: DerivedRow[]] }>()

const UNIT_OPTIONS = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
]

// A row the derivation is unsure about starts open, and the rest start closed:
// an accordion that is entirely open is the same as no accordion at all, and
// the uncertain rows are the whole point of this screen.
const open = ref<Set<string>>(new Set(props.modelValue.filter((row) => row.needsReview).map((row) => row.key)))

const reviewCount = computed(() => props.modelValue.filter((row) => row.needsReview).length)

const unmatched = computed(() => dedupeUnmatched(props.report.unmatched))

/** The tier picked for an `ambiguous-tier` lift, per unmatched key. */
const tierChoice = ref<Record<string, string>>({})

function patch(key: string, changes: Partial<DerivedRow>): void {
  emit(
    'update:modelValue',
    props.modelValue.map((row) => (row.key === key ? { ...row, ...changes } : row)),
  )
}

/** The number a row carried before it was switched to ask-weight, so switching back restores it. */
const remembered = ref<Record<string, number>>({})

function setWeight(row: DerivedRow, value: unknown): void {
  const parsed = typeof value === 'number' ? value : Number(value)
  const weight = Number.isFinite(parsed) && parsed > 0 ? parsed : null
  if (weight !== null) remembered.value[row.key] = weight
  patch(row.key, { weight })
}

// The weight inputs, so the ask-weight switch can hand the user the field when
// there is no number to restore.
const weightInputs = new Map<string, { focus: () => void }>()

function registerWeightInput(key: string, instance: unknown): void {
  if (instance && typeof (instance as { focus?: unknown }).focus === 'function') {
    weightInputs.set(key, instance as { focus: () => void })
  } else {
    weightInputs.delete(key)
  }
}

/**
 * "Leave it blank" is a deliberate answer on a screen whose whole point is that
 * every number is knowingly approved, so it is offered as a switch rather than
 * hidden behind clearing the field.
 *
 * DECISION: with nothing to restore (a row that never had a weight) switching
 * off cannot produce a number, so it focuses the field instead and the switch
 * stays on until one is typed — better than a control that does nothing.
 */
function setAskWeight(row: DerivedRow, ask: unknown): void {
  if (ask) {
    if (row.weight !== null) remembered.value[row.key] = row.weight
    patch(row.key, { weight: null })

    return
  }

  const restored = remembered.value[row.key] ?? row.observedWeight?.value ?? null
  patch(row.key, { weight: restored })
  if (restored === null) weightInputs.get(row.key)?.focus()
}

function stageOptions(row: DerivedRow) {
  return Array.from({ length: row.variationCount }, (_, index) => ({ value: index + 1, label: `Stage ${index + 1}` }))
}

function toggle(key: string): void {
  const next = new Set(open.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  open.value = next
}

function plateHint(row: DerivedRow): string {
  if (row.weight === null) return 'We’ll ask you at the gym'
  return formatPlatesForWeight({ value: row.weight, unit: row.unit }, props.settings)
}

/** `guess` means nothing was ever completed — an empty field, never a zero. */
function confidenceClass(row: DerivedRow): string {
  if (row.weightConfidence === 'guess' || row.variationConfidence === 'guess') {
    return 'border-l-2 border-accent-600'
  }
  if (row.weightConfidence === 'likely' || row.variationConfidence === 'likely') {
    return 'border-l-2 border-ink-300'
  }
  return ''
}

function observedLine(row: DerivedRow): string {
  if (!row.observedWeight) return ''
  const date = row.lastLoggedDate ? ` on ${formatHuman(row.lastLoggedDate)}` : ''
  return `Last lifted ${row.observedWeight.value} ${row.observedWeight.unit}${date}`
}

/**
 * The tier picker cannot re-run the derivation — `deriveState` accepts no alias
 * map, so a choice made here cannot reach it. Rather than pretend, it does the
 * one honest thing available: it opens the row for the tier the athlete names,
 * so they can set that lift's weight themselves.
 */
function goToRow(key: string): void {
  open.value = new Set([...open.value, key])
  document.getElementById(`row-${key}`)?.scrollIntoView({ block: 'center' })
}

function editProgramText(): void {
  document.getElementById('program-source')?.scrollIntoView({ block: 'start' })
}

// The first uncertain row is scrolled to on mount: a long table hides the rows
// that actually need a decision below the fold, and a screen the user scrolls
// past is a screen they confirm without reading.
onMounted(async () => {
  await nextTick()
  const first = props.modelValue.find((row) => row.needsReview)
  if (first) document.getElementById(`row-${first.key}`)?.scrollIntoView({ block: 'center' })
})

// The rows are replaced in place — re-adopting the program text or flipping
// "include unfinished workouts" re-derives everything without remounting this
// component — so a lift that has newly become uncertain has to be opened and
// scrolled to again. Seeding `open` at setup alone would leave its reason panel
// shut behind a "Check this" badge.
watch(
  () =>
    props.modelValue
      .filter((row) => row.needsReview)
      .map((row) => row.key)
      .join('|'),
  async (keys) => {
    const review = keys ? keys.split('|') : []
    open.value = new Set([...open.value, ...review])
    await nextTick()
    if (review[0]) document.getElementById(`row-${review[0]}`)?.scrollIntoView({ block: 'center' })
  },
)

// `buildDerivedRows` falls back to kg when neither the program text nor the log
// yields a unit, which is wrong for an lb athlete importing a program with no
// absolute weights: they would type 225 into a field that stores kilograms. The
// profile's unit is the honest default, and the picker still overrides it.
watch(
  [() => props.settings.units, () => props.modelValue],
  ([units, rows]) => {
    const stale = (row: DerivedRow) => row.weight === null && row.unit !== units
    if (!rows.some(stale)) return

    emit(
      'update:modelValue',
      rows.map((row) => (stale(row) ? { ...row, unit: units } : row)),
    )
  },
  { immediate: true },
)
</script>

<template>
  <section class="flex flex-col gap-4">
    <header class="flex flex-col gap-2">
      <h3 class="text-base font-semibold text-ink-900">What we worked out</h3>
      <p class="text-sm text-ink-500">
        Read from <strong>{{ report.sessionsRead }}</strong> {{ report.sessionsRead === 1 ? 'workout' : 'workouts' }}.
        The weight in each field is what we will prescribe <em>next</em> — what your log says you lifted is written
        underneath it.
      </p>

      <p
        v-if="reviewCount > 0"
        role="status"
        class="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm text-ink-700"
      >
        <Icon name="alert" class="mt-0.5 shrink-0 text-accent-600" />
        <span>
          <strong>{{ reviewCount }}</strong> {{ reviewCount === 1 ? 'lift needs' : 'lifts need' }} a look — they are
          opened below, with the reason. Everything here is editable.
        </span>
      </p>
    </header>

    <ul role="list" class="flex flex-col gap-3">
      <li
        v-for="row in modelValue"
        :id="`row-${row.key}`"
        :key="row.key"
        class="rounded-lg border border-ink-200 p-4"
        :class="confidenceClass(row)"
      >
        <div class="flex items-center gap-2">
          <span v-if="row.tier" class="rounded bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-700">
            T{{ row.tier }}
          </span>
          <h4 class="flex-1 text-base font-semibold text-ink-900">{{ row.lift }}</h4>
          <!-- The severity is spelled out, not encoded in a colour: this is read
               in a bright gym on a phone held at arm's length. -->
          <span v-if="row.needsReview" class="rounded bg-accent-600 px-2 py-0.5 text-xs font-semibold text-white">
            Check this
          </span>
        </div>

        <div class="mt-3 flex flex-wrap items-start gap-4">
          <FormGroup label="Next session’s weight" class="min-w-[9rem] flex-1" :hint="plateHint(row)">
            <template #default="{ id }">
              <Input
                :id="id"
                :ref="(element: unknown) => registerWeightInput(row.key, element)"
                class="min-h-[48px] text-lg"
                :model-value="row.weight"
                :invalid="row.weightConfidence === 'guess' && row.weight === null"
                type="number"
                value-as-number
                inputmode="decimal"
                step="0.5"
                min="0"
                @update:model-value="setWeight(row, $event)"
              />
            </template>
          </FormGroup>

          <FormGroup label="Unit" class="w-24">
            <template #default="{ id }">
              <Select
                :id="id"
                class="min-h-[48px]"
                :model-value="row.unit"
                :options="UNIT_OPTIONS"
                @update:model-value="patch(row.key, { unit: $event as 'kg' | 'lb' })"
              />
            </template>
          </FormGroup>

          <FormGroup
            v-if="row.variationCount > 1"
            label="Next session’s stage"
            class="w-40"
            :hint="row.observedShape ? `You logged ${row.observedShape}` : ''"
          >
            <template #default="{ id }">
              <Select
                :id="id"
                class="min-h-[48px]"
                type="number"
                :model-value="row.stage"
                :options="stageOptions(row)"
                @update:model-value="patch(row.key, { stage: $event as number })"
              />
            </template>
          </FormGroup>
        </div>

        <div class="mt-3">
          <Checkbox
            switch
            label="Ask me at the gym"
            description="We’ll stop before your first set of this lift and ask for the weight."
            :model-value="row.weight === null"
            @update:model-value="setAskWeight(row, $event)"
          />
        </div>

        <p v-if="observedLine(row)" class="mt-2 text-sm text-ink-500">
          From your log: {{ observedLine(row) }}{{ row.observedShape ? `, ${row.observedShape}` : '' }}.
        </p>

        <div v-if="row.reviewReasons.length || row.tiedCandidates.length || row.replayFailed" class="mt-3">
          <button
            type="button"
            class="flex w-full min-h-[48px] items-center gap-2 text-left text-sm text-ink-700"
            :aria-expanded="open.has(row.key)"
            @click="toggle(row.key)"
          >
            <Icon :name="open.has(row.key) ? 'chevron-up' : 'chevron-down'" class="shrink-0 text-ink-400" />
            <span>Why we’re unsure</span>
          </button>

          <div v-if="open.has(row.key)" class="mt-2 flex flex-col gap-3 rounded-lg bg-ink-50 p-3">
            <ul v-if="row.reviewReasons.length" role="list" class="flex flex-col gap-1 text-sm text-ink-700">
              <li v-for="(reason, position) in row.reviewReasons" :key="position">{{ reason }}</li>
            </ul>

            <p v-if="row.weightConfidence && row.weightConfidence !== 'certain'" class="text-xs text-ink-500">
              Weight: {{ CONFIDENCE_COPY[row.weightConfidence] }}
            </p>

            <p v-if="row.matchKind && row.variationConfidence !== 'certain'" class="text-xs text-ink-500">
              Stage: {{ MATCH_COPY[row.matchKind] }}.
            </p>

            <p v-if="row.keyResolution !== 'logged' && row.keyResolution !== 'none'" class="text-xs text-ink-500">
              {{ KEY_RESOLUTION_COPY[row.keyResolution] }}
            </p>

            <!-- A tie is a real choice, so it is asked as one. Picking a candidate
                 sets the stage; nothing else about the derivation changes.
                 fieldset/legend rather than FormGroup: vuiii's RadioGroup spreads
                 fallthrough attrs onto every radio input, so an `id` from
                 FormGroup's slot would be stamped on all of them and its
                 `<label for>` would silently select the first candidate. -->
            <fieldset v-if="row.tiedCandidates.length" class="flex flex-col gap-2">
              <legend class="text-sm font-medium text-ink-900">
                Several stages fit your log equally well — which were you on?
              </legend>
              <RadioGroup
                type="number"
                :model-value="row.stage"
                :options="row.tiedCandidates"
                option-value="index"
                option-label="shape"
                @update:model-value="patch(row.key, { stage: $event as number })"
              />
            </fieldset>

            <div v-if="row.replayFailed" class="flex flex-col gap-2">
              <p class="text-xs text-ink-500">
                Your last session could not be replayed through the program, so the weight above was not progressed:
              </p>
              <DiagnosticsList :diagnostics="row.replayDiagnostics" />
            </div>
          </div>
        </div>
      </li>
    </ul>

    <!-- Kept out of the editable list on purpose: these lifts have no program
         state, so there is literally nothing on them to edit. -->
    <section v-if="unmatched.length" class="flex flex-col gap-3 rounded-lg border border-ink-200 p-4">
      <h4 class="text-base font-semibold text-ink-900">We couldn’t place these</h4>

      <div v-for="entry in unmatched" :key="entry.key" class="flex flex-col gap-2 border-t border-ink-200 pt-3">
        <p class="text-sm text-ink-900">
          <strong>{{ entry.name }}</strong> {{ UNMATCHED_COPY[entry.reason] }}
          <span class="text-ink-500">Last seen {{ formatHuman(entry.lastLoggedDate) }}.</span>
        </p>

        <div v-if="entry.reason === 'not-in-program'">
          <Button variant="outlined" class="min-h-[48px]" label="Edit the program text" @click="editProgramText()" />
        </div>

        <div v-else-if="entry.candidateKeys?.length" class="flex flex-col gap-2">
          <fieldset class="flex flex-col gap-2">
            <legend class="text-sm font-medium text-ink-900">Which one was it?</legend>
            <RadioGroup v-model="tierChoice[entry.key]" inline :options="entry.candidateKeys" />
          </fieldset>
          <p class="text-xs text-ink-500">
            We can’t re-read your history for this — picking a tier only takes you to that lift above, so you can set
            its weight yourself.
          </p>
          <div>
            <Button
              variant="outlined"
              class="min-h-[48px]"
              label="Take me to that lift"
              :disabled="!tierChoice[entry.key]"
              @click="goToRow(tierChoice[entry.key])"
            />
          </div>
        </div>
      </div>
    </section>
  </section>
</template>
