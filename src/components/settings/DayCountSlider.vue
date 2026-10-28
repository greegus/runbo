<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

const props = defineProps<{
  modelValue: number
  min: number
  max: number
  id?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

/**
 * The value under the thumb while a drag is in flight, null otherwise. Only the
 * release (`change`) is emitted: the parent clamps other fields against this
 * one, so emitting every step a drag passes over would let a drag that merely
 * dips to 1 on its way back permanently lower whatever is capped by it.
 */
const dragging = ref<number | null>(null)

const shown = computed(() => dragging.value ?? props.modelValue)

/**
 * How much of the track is filled. Native range inputs only paint a filled
 * portion in Firefox, so the bar is drawn by hand as a two-stop gradient. A
 * one-option range (max === min) reads as full rather than dividing by zero.
 */
const fill = computed(() => {
  const span = props.max - props.min
  if (span <= 0) return 100

  return Math.min(Math.max(((shown.value - props.min) / span) * 100, 0), 100)
})

const valueText = computed(() => `${shown.value} ${shown.value === 1 ? 'day' : 'days'}`)

function onInput(event: Event): void {
  dragging.value = Number((event.target as HTMLInputElement).value)
}

async function onChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement

  emit('update:modelValue', Number(input.value))
  dragging.value = null

  // A parent that rejects or clamps the value leaves the prop unchanged, and
  // Vue never rewrites an unchanged `:value` — so the thumb would stay where
  // it was dropped while the number beside it says otherwise.
  await nextTick()
  input.value = String(props.modelValue)
}
</script>

<template>
  <div class="flex items-center gap-4">
    <!-- A native range under the paint: keyboard, screen readers and touch
         dragging all come for free, and the 48px box is the touch target even
         though the visible bar is much thinner. -->
    <input
      :id="id"
      type="range"
      class="day-count-slider h-12 min-w-0 flex-1"
      :style="{ '--fill': `${fill}%` }"
      :min="min"
      :max="max"
      step="1"
      :value="modelValue"
      :aria-valuetext="valueText"
      @input="onInput"
      @change="onChange"
    />
    <output :for="id" class="w-8 text-right text-2xl font-semibold tabular-nums text-ink-900" aria-hidden="true">
      {{ shown }}
    </output>
  </div>
</template>

<style scoped>
.day-count-slider {
  appearance: none;
  background: transparent;
  cursor: pointer;
}

.day-count-slider:focus-visible {
  outline: 2px solid var(--color-accent-700);
  outline-offset: 2px;
  border-radius: 0.5rem;
}

.day-count-slider::-webkit-slider-runnable-track {
  height: 0.75rem;
  border-radius: 9999px;
  background: linear-gradient(to right, var(--color-accent-600) var(--fill), var(--color-ink-200) var(--fill));
}

.day-count-slider::-moz-range-track {
  height: 0.75rem;
  border-radius: 9999px;
  background: linear-gradient(to right, var(--color-accent-600) var(--fill), var(--color-ink-200) var(--fill));
}

.day-count-slider::-webkit-slider-thumb {
  appearance: none;
  width: 1.75rem;
  height: 1.75rem;
  /* Centres the thumb on the 0.75rem track: (0.75 - 1.75) / 2. */
  margin-top: -0.5rem;
  border: 2px solid var(--color-accent-600);
  border-radius: 9999px;
  background: white;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
}

.day-count-slider::-moz-range-thumb {
  width: 1.75rem;
  height: 1.75rem;
  border: 2px solid var(--color-accent-600);
  border-radius: 9999px;
  background: white;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
}
</style>
