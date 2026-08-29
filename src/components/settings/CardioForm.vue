<script setup lang="ts">
import { computed, watch } from 'vue'
import { CheckboxGroup, FormGroup, Icon, Input } from 'vuiii'

import type { CardioTrack } from '@/onboarding/types'
import type { Modality } from '@/types'

const props = defineProps<{
  modelValue: CardioTrack
}>()

const emit = defineEmits<{
  'update:modelValue': [value: CardioTrack]
  'update:valid': [value: boolean]
}>()

const MODALITY_OPTIONS = [
  { value: 'run', label: 'Run' },
  { value: 'bike', label: 'Bike' },
  { value: 'swim', label: 'Swim' },
]

/**
 * An empty numeric input emits `null`, and `NaN` is what a half-typed one can
 * produce — both would reach `planCardioWeek` as a silently zeroed week. We
 * store 0 instead and let the validation say why the step cannot continue.
 */
function toMinutes(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * Every emit rebuilds the whole slice from the incoming one, so `mesoStartDate`,
 * `holdStreak`, `rotationCursor`, `lastPlannedMinutes` and `zones` survive a
 * write that `updateDoc` would otherwise replace wholesale.
 */
function apply(patch: Partial<CardioTrack>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function setModalities(value: unknown[] | undefined): void {
  apply({ modalities: (value ?? []) as Modality[] })
}

const weeklyError = computed(() => {
  if (!(props.modelValue.weeklyMinutes > 0)) return 'Enter the minutes you currently do in a week.'

  return ''
})

// Not clamped on input: a silent correction would leave the user believing the
// app accepted the 90-minute long run they typed against a 60-minute week.
const longestError = computed(() => {
  if (props.modelValue.longestSessionMinutes < 0) return 'Minutes cannot be negative.'
  if (props.modelValue.longestSessionMinutes > props.modelValue.weeklyMinutes) {
    return 'A single session cannot be longer than your whole week. Raise the weekly total or lower this one.'
  }

  return ''
})

const isValid = computed(() => props.modelValue.modalities.length > 0 && !weeklyError.value && !longestError.value)

watch(isValid, (valid) => emit('update:valid', valid), { immediate: true })
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- fieldset/legend rather than FormGroup: FormGroup's label is a
         `<label for>` pointing at an id no group control can carry, so the
         checkbox group would be left with no name at all. -->
    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium text-ink-900">What do you do?</legend>
      <p class="text-sm text-ink-500">Pick every sport you actually train. We rotate between them week to week.</p>
      <CheckboxGroup
        inline
        :options="MODALITY_OPTIONS"
        option-label="label"
        option-value="value"
        :model-value="props.modelValue.modalities"
        class="min-h-[48px]"
        @update:model-value="setModalities"
      />
    </fieldset>

    <!-- An empty selection is a real thing to want (strength only), but the
         plan composer has no strength-only cardio track — it would prescribe
         nothing every week — so we explain the consequence instead of hiding
         the state behind a disabled checkbox. -->
    <div
      v-if="props.modelValue.modalities.length === 0"
      class="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm"
      role="alert"
    >
      <Icon name="alert" size="large" class="shrink-0 text-accent-600" />
      <div>
        <p class="font-semibold text-ink-900">No sport selected.</p>
        <p class="mt-1 text-ink-500">
          Your weeks would be strength only, and we cannot plan a single cardio session. Pick at least one sport — you
          can set the weekly minutes as low as you like.
        </p>
      </div>
    </div>

    <FormGroup
      label="Minutes of cardio per week"
      :error="weeklyError"
      hint="Be honest — every week from here is built on this number, so a wish makes the first month too hard."
    >
      <template #default="{ id }">
        <Input
          :id="id"
          type="number"
          value-as-number
          inputmode="numeric"
          min="0"
          step="5"
          size="large"
          class="min-h-[48px] text-2xl font-semibold tabular-nums"
          :invalid="!!weeklyError"
          :model-value="props.modelValue.weeklyMinutes"
          @update:model-value="apply({ weeklyMinutes: toMinutes($event) })"
        />
      </template>
    </FormGroup>

    <FormGroup
      label="Longest single session"
      :error="longestError"
      hint="Your current long run or ride, in minutes. We grow it from here."
    >
      <template #default="{ id }">
        <Input
          :id="id"
          type="number"
          value-as-number
          inputmode="numeric"
          min="0"
          step="5"
          size="large"
          class="min-h-[48px] text-2xl font-semibold tabular-nums"
          :invalid="!!longestError"
          :model-value="props.modelValue.longestSessionMinutes"
          @update:model-value="apply({ longestSessionMinutes: toMinutes($event) })"
        />
      </template>
    </FormGroup>

    <p class="text-sm text-ink-500">
      Not sure? 60 minutes a week with a 30-minute long session is the starting point we assume — a 2 × 30 min baseline,
      not a target.
    </p>
  </div>
</template>
