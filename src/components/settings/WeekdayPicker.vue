<script setup lang="ts">
import { WEEKDAY_LABELS } from '@/utils/date'

/**
 * The seven days as one row of buttons, Monday first. `multiple` ticks any
 * number of them (toggle buttons); without it exactly one is picked (a radio
 * group). One component for both, so the preferred days and the long-session
 * day read as the same control.
 */
const props = defineProps<
  | { multiple: true; modelValue: number[]; label: string }
  | { multiple?: false; modelValue: number; label: string }
>()

const emit = defineEmits<{
  'update:modelValue': [value: number[] | number]
}>()

function isOn(day: number): boolean {
  return props.multiple ? props.modelValue.includes(day) : props.modelValue === day
}

function pick(day: number): void {
  if (!props.multiple) {
    emit('update:modelValue', day)
    return
  }

  const next = props.modelValue.includes(day)
    ? props.modelValue.filter((value) => value !== day)
    : [...props.modelValue, day]

  emit(
    'update:modelValue',
    next.sort((a, b) => a - b),
  )
}
</script>

<template>
  <!-- Seven across on the narrowest phone: a grid rather than flex-wrap, so
       the columns stay index-aligned with the Mon-first day numbers we store. -->
  <div class="grid grid-cols-7 gap-1" :role="multiple ? 'group' : 'radiogroup'" :aria-label="label">
    <button
      v-for="(dayLabel, day) in WEEKDAY_LABELS"
      :key="day"
      type="button"
      class="flex min-h-[48px] items-center justify-center rounded-md border text-sm font-semibold"
      :class="isOn(day) ? 'border-accent-600 bg-accent-600 text-white' : 'border-ink-200 bg-white text-ink-700'"
      :role="multiple ? undefined : 'radio'"
      :aria-pressed="multiple ? isOn(day) : undefined"
      :aria-checked="multiple ? undefined : isOn(day)"
      @click="pick(day)"
    >
      {{ dayLabel }}
    </button>
  </div>
</template>
