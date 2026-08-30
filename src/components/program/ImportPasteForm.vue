<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Button, FormGroup, Icon, Input, RadioButtonGroup } from 'vuiii'

import ProgramEditor from '@/components/program/ProgramEditor.vue'
import { adoptProgramText, gzclpFallback } from '@/import/programText'
import { parseExerciseKey } from '@/onboarding/derivedRows'
import type { GymSettings } from '@/onboarding/types'
import type { GzclpSeed } from '@/training/gzclp'
import type { ExerciseState } from '@/types'

const props = defineProps<{
  modelValue: string
  settings: GymSettings
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  adopt: [
    value: {
      programText: string
      programState: Record<string, ExerciseState>
      source: 'paste' | 'fallback'
    },
  ]
}>()

interface SeedRow {
  key: string
  lift: string
  tier: 1 | 2 | 3 | undefined
  weight: number | null
  unit: 'kg' | 'lb'
  stage: number
}

const STAGE_OPTIONS = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
]

// The parser walks the whole program on every call, and a paste is typically
// edited character by character afterwards. Debouncing keeps a long program
// from re-parsing on each keystroke; 300 ms is below the threshold at which a
// diagnostics list feels stale.
const DEBOUNCE_MS = 300

const debounced = ref(props.modelValue)
const showFallback = ref(false)
const seedRows = ref<SeedRow[]>([])
const fallbackError = ref<string | null>(null)

let timer: number | undefined

watch(
  () => props.modelValue,
  (value) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      debounced.value = value
    }, DEBOUNCE_MS)
  },
)

onBeforeUnmount(() => window.clearTimeout(timer))

/** `adoptProgramText` is total — it never throws — so a computed is safe. */
const result = computed(() => adoptProgramText(debounced.value))

const isEmpty = computed(() => debounced.value.trim().length === 0)

/**
 * A program written in the other unit is not converted anywhere — the weights
 * are stored with the unit they were written in — so the mismatch is stated
 * rather than quietly reconciled against the profile's setting.
 */
const mixedUnits = computed(() => seedRows.value.some((row) => row.unit !== props.settings.units))

const askWeightRows = computed(() => result.value.askWeightKeys.map((key) => ({ key, ...parseExerciseKey(key) })))

function rowsFromSeed(detected: GzclpSeed): SeedRow[] {
  return Object.entries(detected).map(([key, entry]) => ({
    key,
    ...parseExerciseKey(key),
    weight: entry.weight.value,
    unit: entry.weight.unit,
    stage: entry.stage ?? 1,
  }))
}

// Re-seeded whenever a fresh parse changes what was detected: keeping stale rows
// from a previous paste would offer weights the current text does not contain.
watch(
  () => result.value.detected,
  (detected) => {
    seedRows.value = rowsFromSeed(detected)
    fallbackError.value = null
  },
  { immediate: true },
)

function setWeight(row: SeedRow, value: unknown): void {
  const parsed = typeof value === 'number' ? value : Number(value)
  row.weight = Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function useThisProgram(): void {
  emit('adopt', {
    programText: result.value.programText,
    programState: result.value.programState,
    source: 'paste',
  })
}

/**
 * `gzclpFallback` is the one export of the import layer that can throw, so the
 * failure has to land somewhere the user can see it rather than in the console.
 */
function useFallback(): void {
  const seed: GzclpSeed = {}
  for (const row of seedRows.value) {
    if (row.weight === null) continue
    seed[row.key] = { weight: { value: row.weight, unit: row.unit }, stage: row.stage }
  }

  try {
    const built = gzclpFallback(seed)
    fallbackError.value = null
    emit('adopt', { programText: built.programText, programState: built.programState, source: 'fallback' })
  } catch (error) {
    fallbackError.value =
      error instanceof Error
        ? `We could not build the built-in program: ${error.message}`
        : 'We could not build the built-in program.'
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <ProgramEditor
      id="program-source"
      label="Your Liftosaur program text"
      :model-value="modelValue"
      :diagnostics="result.diagnostics"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <p v-if="isEmpty" class="text-sm text-ink-500">
      Paste your program from Liftosaur — Settings → Export program to text.
    </p>

    <!-- The happy path. `result.programText` and `result.programState` are passed
         on verbatim: an athlete who pastes their program must get their program
         back, not our re-serialisation of it. -->
    <div v-else-if="result.adopted" class="flex flex-col gap-3">
      <p class="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm text-ink-700">
        <Icon name="check" class="mt-0.5 shrink-0 text-accent-600" />
        <span>
          This program runs as written. We read a starting weight for
          {{ Object.keys(result.detected).length }} of
          {{ Object.keys(result.detected).length + result.askWeightKeys.length }} lifts; the rest we’ll ask you for at
          the gym.
        </span>
      </p>

      <Button class="min-h-[56px]" label="Use this program" @click="useThisProgram()" />
    </div>

    <div v-else class="flex flex-col gap-4">
      <!-- The silent-failure hole: adoption can fail with nothing to show for it.
           Saying so is the only honest option — an empty panel reads as a bug. -->
      <p
        v-if="result.diagnostics.length === 0"
        class="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm text-ink-700"
        role="alert"
      >
        <Icon name="alert" class="mt-0.5 shrink-0 text-accent-600" />
        <span>We couldn’t read this program, and the parser gave no reason.</span>
      </p>

      <p v-else class="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm text-ink-700" role="alert">
        <Icon name="alert" class="mt-0.5 shrink-0 text-accent-600" />
        <!-- Warnings block adoption just as errors do, so the copy never offers
             to continue anyway. -->
        <span>
          We can’t run this program as written — every problem listed above has to be fixed, warnings included. Edit the
          text, or keep the weights we did read and run the built-in GZCLP instead.
        </span>
      </p>

      <div v-if="!showFallback">
        <Button
          class="min-h-[56px]"
          variant="outlined"
          label="Keep my weights, run the built-in GZCLP"
          @click="showFallback = true"
        />
      </div>

      <section v-else class="flex flex-col gap-4 rounded-lg border border-ink-200 p-4">
        <div>
          <h3 class="text-base font-semibold text-ink-900">Run the built-in GZCLP</h3>
          <p class="mt-1 text-sm text-ink-500">
            Your program text is replaced by runbo’s own GZCLP. These are the weights we read out of your paste — change
            anything that looks wrong.
          </p>
        </div>

        <p v-if="mixedUnits" class="text-sm text-ink-700">
          Some of these weights are written in a different unit from your gym setup ({{ settings.units }}). We keep them
          as written — nothing is converted.
        </p>

        <p v-if="seedRows.length === 0" class="text-sm text-ink-500">
          We couldn’t read a single weight out of your paste, so every lift will start as ask-weight.
        </p>

        <div v-for="row in seedRows" :key="row.key" class="flex flex-wrap items-end gap-3 border-t border-ink-200 pt-3">
          <div class="flex min-w-[8rem] flex-1 items-center gap-2">
            <span v-if="row.tier" class="rounded bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-700">
              T{{ row.tier }}
            </span>
            <span class="text-sm font-semibold text-ink-900">{{ row.lift }}</span>
          </div>

          <FormGroup :label="`Weight (${row.unit})`" class="w-32">
            <template #default="{ id }">
              <Input
                :id="id"
                class="min-h-[48px] text-lg"
                :model-value="row.weight"
                type="number"
                value-as-number
                inputmode="decimal"
                step="0.5"
                min="0"
                @update:model-value="setWeight(row, $event)"
              />
            </template>
          </FormGroup>

          <!-- `detectWeights` never reads a stage out of the text — it only ever
               reports variation 1 — so the stage is asked for rather than shown. -->
          <!-- Named with `aria-label`, not FormGroup's slot id: a `<label for>`
               cannot name the `role="radiogroup"` div this renders. -->
          <FormGroup v-if="row.tier !== 3" label="Stage">
            <RadioButtonGroup
              v-model="row.stage"
              aria-label="Stage"
              class="min-h-[48px]"
              :options="STAGE_OPTIONS"
              option-label="label"
              option-value="value"
            />
          </FormGroup>
        </div>

        <div v-if="askWeightRows.length" class="border-t border-ink-200 pt-3">
          <h4 class="text-sm font-semibold text-ink-900">We’ll ask you at the gym</h4>
          <ul class="mt-2 flex flex-wrap gap-2">
            <li v-for="row in askWeightRows" :key="row.key" class="rounded bg-ink-50 px-2 py-1 text-xs text-ink-700">
              <template v-if="row.tier">T{{ row.tier }} </template>{{ row.lift }}
            </li>
          </ul>
        </div>

        <p v-if="fallbackError" role="alert" class="text-sm text-accent-700">{{ fallbackError }}</p>

        <div class="flex flex-wrap gap-3">
          <Button class="min-h-[56px]" label="Use the built-in GZCLP" @click="useFallback()" />
          <Button
            class="min-h-[56px]"
            variant="text"
            label="Back to editing my program"
            @click="showFallback = false"
          />
        </div>
      </section>
    </div>
  </div>
</template>
