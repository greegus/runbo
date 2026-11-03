<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

/**
 * A whole number on a track, with the value beside it. `null` is "not
 * answered yet": the track is empty, the number reads "–", and the first
 * touch anywhere on the track — a tap on the thumb included — answers it.
 */
const props = withDefaults(
  defineProps<{
    modelValue: number | null
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
 */
const dragging = ref<number | null>(null)

const shown = computed(() => dragging.value ?? props.modelValue)

/** Where the thumb rests while nothing is answered: the middle of the track. */
const resting = computed(() => Math.round((props.min + props.max) / 2))

/**
 * How much of the track is filled. Native range inputs only paint a filled
 * portion in Firefox, so the bar is drawn by hand as a two-stop gradient. A
 * one-option range (max === min) reads as full rather than dividing by zero.
 */
const fill = computed(() => {
  const span = props.max - props.min
  if (shown.value === null) return 0
  if (span <= 0) return 100

  return Math.min(Math.max(((shown.value - props.min) / span) * 100, 0), 100)
})

const ariaValueText = computed(() => (shown.value === null ? 'Not set' : props.valueText(shown.value)))

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
  input.value = String(props.modelValue ?? resting.value)
}

/**
 * A tap on the thumb where it already rests moves nothing, so no `change`
 * fires — and an unanswered slider would ignore the athlete picking the very
 * value it shows. The click answers it.
 */
function onClick(event: Event): void {
  if (props.modelValue !== null) return

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
      :class="{ 'range-slider--unset': shown === null }"
      :style="{ '--fill': `${fill}%` }"
      :min="min"
      :max="max"
      step="1"
      :value="modelValue ?? resting"
      :aria-label="label"
      :aria-valuetext="ariaValueText"
      @input="onInput"
      @change="onChange"
      @click="onClick"
    />
    <output :for="id" class="w-8 text-right text-2xl font-semibold tabular-nums text-ink-900" aria-hidden="true">
      {{ shown ?? '–' }}
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

/* Unanswered: a quiet grey thumb, so it does not read as a value already picked. */
.range-slider--unset::-webkit-slider-thumb {
  border-color: var(--color-ink-300);
  box-shadow: none;
}

.range-slider--unset::-moz-range-thumb {
  border-color: var(--color-ink-300);
  box-shadow: none;
}
</style>
