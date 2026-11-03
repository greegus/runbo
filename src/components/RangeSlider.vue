<script setup lang="ts">
import { computed, ref } from 'vue'

/** A whole number on a track, with the value beside it. */
const props = withDefaults(
  defineProps<{
    modelValue: number
    min: number
    max: number
    id?: string
    /** Names the slider when no `<label for>` does. */
    label?: string
    /** What a screen reader announces for a value: "3 days", "RPE 7". */
    valueText?: (value: number) => string
  }>(),
  { id: undefined, label: undefined, valueText: (value: number) => String(value) },
)

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

/**
 * The value under the thumb while a drag is in flight, null otherwise. Only the
 * release (`change`) is emitted: the parent clamps other fields against this
 * one, so emitting every step a drag passes over would let a drag that merely
 * dips to 1 on its way back permanently lower whatever is capped by it.
 *
 * The input's `:value` follows it too. Every step repaints the fill, and on a
 * re-render Vue writes `:value` back into the DOM whenever the two differ —
 * bound to `modelValue`, a tap on the track snapped the thumb back to the old
 * value while the fill and the number showed the new one. A parent that
 * rejects or clamps the release re-renders with its own value, and the thumb
 * follows it there.
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

function onInput(event: Event): void {
  dragging.value = Number((event.target as HTMLInputElement).value)
}

function onChange(event: Event): void {
  dragging.value = null
  emit('update:modelValue', Number((event.target as HTMLInputElement).value))
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
      class="range-slider h-12 min-w-0 flex-1"
      :style="{ '--fill': `${fill}%` }"
      :min="min"
      :max="max"
      step="1"
      :value="shown"
      :aria-label="label"
      :aria-valuetext="valueText(shown)"
      @input="onInput"
      @change="onChange"
    />
    <output :for="id" class="w-8 text-right text-2xl font-semibold tabular-nums text-ink-900" aria-hidden="true">
      {{ shown }}
    </output>
  </div>
</template>

<style scoped>
.range-slider {
  appearance: none;
  background: transparent;
  cursor: pointer;
}

.range-slider:focus-visible {
  outline: 2px solid var(--color-accent-700);
  outline-offset: 2px;
  border-radius: 0.5rem;
}

.range-slider::-webkit-slider-runnable-track {
  height: 0.75rem;
  border-radius: 9999px;
  background: linear-gradient(to right, var(--color-accent-600) var(--fill), var(--color-ink-200) var(--fill));
}

.range-slider::-moz-range-track {
  height: 0.75rem;
  border-radius: 9999px;
  background: linear-gradient(to right, var(--color-accent-600) var(--fill), var(--color-ink-200) var(--fill));
}

.range-slider::-webkit-slider-thumb {
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

.range-slider::-moz-range-thumb {
  width: 1.75rem;
  height: 1.75rem;
  border: 2px solid var(--color-accent-600);
  border-radius: 9999px;
  background: white;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
}
</style>
