<script setup lang="ts">
import { FormGroup, Input } from 'vuiii'

import InputUnit from '@/components/InputUnit.vue'

/**
 * A labelled number field: FormGroup + vuiii Input + the unit as its suffix.
 *
 * The reason it exists is the label. vuiii's Input sets `aria-label` to its
 * placeholder or the literal "input" unless one is passed
 * (node_modules/vuiii/dist/vuiii.js), and an aria-label beats FormGroup's
 * `<label for>` — so a bare Input inside a FormGroup is announced as "input".
 * This passes the visible label (or `ariaLabel`, when it should say more)
 * through, every time.
 *
 * The browser's spin arrows are hidden: phones show none, and on a desktop
 * they took the width a 3-digit value needs in a narrow field (the rest
 * timers, three across).
 *
 * The value is emitted as Input hands it over: each caller keeps its own
 * coercion, because "empty" means different things to different fields.
 */
const props = withDefaults(
  defineProps<{
    modelValue: number | null
    label: string
    /** The accessible name, when the visible label alone is ambiguous. */
    ariaLabel?: string
    hint?: string
    description?: string
    error?: string | boolean
    unit?: string
    /** The narrower unit padding, for a field that has little room. */
    compactUnit?: boolean
    /** The number's type size: `md` a list value, `lg` a settings value, `xl` the one value a section asks for. */
    size?: 'md' | 'lg' | 'xl'
    inputmode?: 'numeric' | 'decimal'
    step?: number | string
    min?: number | string
    max?: number | string
    invalid?: boolean
    disabled?: boolean
  }>(),
  {
    ariaLabel: undefined,
    hint: undefined,
    description: undefined,
    error: undefined,
    unit: undefined,
    compactUnit: false,
    size: 'md',
    inputmode: 'numeric',
    step: undefined,
    min: 0,
    max: undefined,
    invalid: false,
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
}>()

const SIZE_CLASSES: Record<NonNullable<typeof props.size>, string> = {
  md: 'text-lg',
  lg: 'text-xl font-semibold',
  xl: 'text-2xl font-semibold',
}
</script>

<template>
  <FormGroup :label="label" :hint="hint" :description="description" :error="error">
    <template #default="{ id }">
      <Input
        :id="id"
        type="number"
        value-as-number
        :inputmode="inputmode"
        :step="step"
        :min="min"
        :max="max"
        size="large"
        class="min-h-[48px] tabular-nums [&_input]:[appearance:textfield] [&_input::-webkit-inner-spin-button]:appearance-none"
        :class="SIZE_CLASSES[size]"
        :aria-label="ariaLabel ?? label"
        :invalid="invalid"
        :disabled="disabled"
        :model-value="modelValue"
        @update:model-value="emit('update:modelValue', $event)"
        @focus="emit('focus', $event)"
        @blur="emit('blur', $event)"
      >
        <template v-if="unit" #suffix><InputUnit :unit="unit" :compact="compactUnit" /></template>
      </Input>
    </template>
  </FormGroup>
</template>
