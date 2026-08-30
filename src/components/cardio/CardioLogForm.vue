<script setup lang="ts">
import { computed, watch } from 'vue'
import { FormGroup, Input, RadioButtonGroup, Textarea } from 'vuiii'

import { cardioLogBlockedReason, cardioLogWarnings } from '@/session/cardioLog'
import type { CardioLogDraft } from '@/session/types'

const props = withDefaults(
  defineProps<{
    modelValue: CardioLogDraft
    targetMinutes: number
    busy?: boolean
  }>(),
  { busy: false },
)

const emit = defineEmits<{
  'update:modelValue': [draft: CardioLogDraft]
  'update:valid': [valid: boolean]
  'update:blockedReason': [reason: string | null]
}>()

const RPE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({ value, label: String(value) }))

/**
 * Coerced on the way in, not validated on the way out. An empty numeric input
 * emits `null` and a half-typed one can emit `NaN`; both mean "not recorded",
 * which is a real answer — never a zero, and never a blocked athlete.
 */
function toOptionalNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// Every emit rebuilds the whole draft: the parent replaces it wholesale, so a
// patch carrying only the edited field would drop the others.
function patch(changes: Partial<CardioLogDraft>): void {
  emit('update:modelValue', { ...props.modelValue, ...changes })
}

const blockedReason = computed(() => cardioLogBlockedReason(props.modelValue))

/** Non-blocking: a wrong-looking number gets a question, never a silent clamp. */
const warnings = computed(() => cardioLogWarnings(props.modelValue))

const minutesDelta = computed(() => {
  const minutes = props.modelValue.minutes
  if (minutes === null || !Number.isFinite(minutes) || !Number.isFinite(props.targetMinutes)) return null

  return Math.round(minutes) - Math.round(props.targetMinutes)
})

watch(
  blockedReason,
  (reason) => {
    emit('update:valid', reason === null)
    emit('update:blockedReason', reason)
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <FormGroup
      label="Minutes"
      :error="blockedReason ?? false"
      hint="The only thing we need — everything else is extra."
    >
      <!-- vuiii's Input hardcodes `aria-label="input"` unless one is passed, and
           an aria-label beats FormGroup's `<label for>` — so every field here
           names itself explicitly or a screen reader announces "input". -->
      <template #default="{ id }">
        <Input
          :id="id"
          :model-value="modelValue.minutes"
          aria-label="Minutes"
          type="number"
          value-as-number
          inputmode="numeric"
          min="0"
          step="1"
          size="large"
          :disabled="busy"
          :invalid="blockedReason !== null"
          class="min-h-[48px] text-3xl font-semibold tabular-nums"
          @update:model-value="patch({ minutes: toOptionalNumber($event) })"
        />
      </template>
    </FormGroup>

    <p v-if="minutesDelta !== null && minutesDelta !== 0" class="-mt-4 text-sm text-ink-500">
      <span class="tabular-nums">{{ minutesDelta > 0 ? `+${minutesDelta}` : minutesDelta }} min</span>
      vs the <span class="tabular-nums">{{ targetMinutes }} min</span> target.
    </p>
    <p v-else-if="minutesDelta === 0" class="-mt-4 text-sm text-ink-500">Exactly the target.</p>

    <FormGroup label="Distance" hint="In kilometres. Leave it empty if you did not measure it.">
      <template #default="{ id }">
        <Input
          :id="id"
          :model-value="modelValue.distanceKm"
          aria-label="Distance in kilometres"
          type="number"
          value-as-number
          inputmode="decimal"
          min="0"
          step="0.1"
          size="large"
          :disabled="busy"
          class="min-h-[48px] text-lg tabular-nums"
          @update:model-value="patch({ distanceKm: toOptionalNumber($event) })"
        />
      </template>
    </FormGroup>

    <FormGroup label="Average heart rate" hint="In bpm, from your watch or strap. Optional.">
      <template #default="{ id }">
        <Input
          :id="id"
          :model-value="modelValue.avgHr"
          aria-label="Average heart rate"
          type="number"
          value-as-number
          inputmode="numeric"
          min="0"
          step="1"
          size="large"
          :disabled="busy"
          class="min-h-[48px] text-lg tabular-nums"
          @update:model-value="patch({ avgHr: toOptionalNumber($event) })"
        />
      </template>
    </FormGroup>

    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium text-ink-900">How hard did it feel?</legend>
      <p class="text-sm text-ink-500">1 = barely moving, 10 = all out. Optional.</p>
      <!-- Named with `aria-label`: FormGroup's `<label for>` cannot name the
           `role="radiogroup"` this renders. -->
      <RadioButtonGroup
        aria-label="RPE, 1 to 10"
        :model-value="modelValue.rpe"
        :options="RPE_OPTIONS"
        option-label="label"
        option-value="value"
        size="large"
        :disabled="busy"
        class="min-h-[48px]"
        @update:model-value="patch({ rpe: toOptionalNumber($event) })"
      />
    </fieldset>

    <FormGroup label="Notes" hint="Weather, route, how it went. Optional.">
      <template #default="{ id }">
        <Textarea
          :id="id"
          :model-value="modelValue.notes"
          :rows="3"
          size="large"
          :disabled="busy"
          class="min-h-[48px]"
          @update:model-value="patch({ notes: String($event ?? '') })"
        />
      </template>
    </FormGroup>

    <!-- Questions, not errors: nothing here blocks the finish, so they sit
         apart from the minutes error and stay readable while typing. -->
    <ul v-if="warnings.length" role="status" class="flex flex-col gap-1">
      <li v-for="warning in warnings" :key="warning" class="text-sm text-accent-700">{{ warning }}</li>
    </ul>
  </div>
</template>
