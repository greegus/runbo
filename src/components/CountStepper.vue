<script setup lang="ts">
import { Icon } from 'vuiii'

/**
 * A small whole number with − and + on either side, inside one frame. One
 * border around all three reads as a single control — three separately
 * bordered boxes read as three — and it is narrower, which is what lets the
 * plate row fit a phone.
 *
 * Text, not an input, in the middle: it is a handful of pairs with a button
 * on either side, and nothing here needs a keyboard.
 */
const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    /** What is being counted, for the screen reader: "Pairs of 20 kg plates". */
    label: string
    decreaseLabel: string
    increaseLabel: string
  }>(),
  { min: 0 },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function step(delta: number): void {
  const current = Number.isFinite(props.modelValue) ? Math.round(props.modelValue) : props.min
  emit('update:modelValue', Math.max(props.min, current + delta))
}
</script>

<template>
  <!-- The buttons sit 4px inside the frame with corners of their own, so the
       hover tint and the focus ring read as a button, not as a slice of the
       frame. -->
  <div class="flex h-12 shrink-0 items-stretch rounded-xl border border-ink-300 bg-white p-1">
    <button
      type="button"
      class="flex w-10 items-center justify-center rounded-lg text-ink-700 focus-visible:outline-2 focus-visible:outline-accent-600 disabled:text-ink-300"
      :aria-label="decreaseLabel"
      :title="decreaseLabel"
      :disabled="modelValue <= min"
      @click="step(-1)"
    >
      <Icon name="minus" aria-hidden="true" />
    </button>
    <output
      class="flex w-7 items-center justify-center text-lg font-semibold tabular-nums text-ink-900"
      :aria-label="label"
      >{{ modelValue }}</output
    >
    <button
      type="button"
      class="flex w-10 items-center justify-center rounded-lg text-ink-700 focus-visible:outline-2 focus-visible:outline-accent-600"
      :aria-label="increaseLabel"
      :title="increaseLabel"
      @click="step(1)"
    >
      <Icon name="plus" aria-hidden="true" />
    </button>
  </div>
</template>
