<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, FormGroup, Icon, IconButton, Input, RadioButtonGroup } from 'vuiii'

import { smallestStep } from '@/liftoscript/weight'
import {
  defaultPlateRows,
  type PlateRow,
  sortPlatesDesc,
  validateBarbell,
  validatePlates,
} from '@/onboarding/plateInventory'
import type { GymSettings } from '@/onboarding/types'
import { formatPlateLoad, platesForWeight } from '@/training/plates'

const props = defineProps<{ modelValue: GymSettings }>()

const emit = defineEmits<{
  'update:modelValue': [value: GymSettings]
  'update:valid': [value: boolean]
}>()

const UNIT_OPTIONS = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
] as const

/** A weight that needs most of the inventory, so the check panel is informative. */
const SAMPLE_WEIGHT: Record<'kg' | 'lb', number> = { kg: 102.5, lb: 225 }

// Component-local and never emitted: the sample is a way to look at the
// inventory, not a setting. Persisting it would put a display preference in the
// profile document.
const sampleWeight = ref(SAMPLE_WEIGHT[props.modelValue.units])

// Sticky for the lifetime of the form: the note has to stay visible while the
// user fixes the numbers, so it is keyed on "you changed units here", not on a
// comparison with the saved value (which the parent may have already updated).
const unitsChanged = ref(false)

const plates = computed(() => props.modelValue.plates)

const barbellError = computed(() => validateBarbell(props.modelValue.barbellWeight))
const plateErrors = computed(() => validatePlates(plates.value))
const inventoryError = computed(() => plateErrors.value.find((error) => error.index === -1)?.message ?? null)

function rowError(index: number): string | null {
  return plateErrors.value.find((error) => error.index === index)?.message ?? null
}

const isValid = computed(() => barbellError.value === null && plateErrors.value.length === 0)

/**
 * The bar plus one of the smallest plate on each side — the resolution of every
 * weight the app will ever prescribe. `smallestStep` owns the maths; showing it
 * is the fastest way for a user to notice a missing pair of 1.25s.
 */
const step = computed(() => smallestStep(plates.value, props.modelValue.units))

const sampleLoad = computed(() =>
  platesForWeight({ value: sampleWeight.value, unit: props.modelValue.units }, props.modelValue),
)

/** Every emit rebuilds the whole slice — `updateDoc` replaces nested objects
 *  wholesale, so a patch that omitted `restTimers` or `fcmTokens` would delete
 *  them the moment the parent saved. */
function update(patch: Partial<GymSettings>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function setUnits(units: unknown): void {
  if (units !== 'kg' && units !== 'lb') return
  if (units === props.modelValue.units) return

  unitsChanged.value = true
  sampleWeight.value = SAMPLE_WEIGHT[units]
  // DECISION: switching units re-labels, it never converts. A converted 20 kg bar
  // becomes 44.09 lb and every plate a number nobody owns, so the inventory would
  // have to be retyped anyway — and a silent conversion is indistinguishable on
  // screen from a silent reinterpretation. The note below says what happened and
  // the button next to it loads a standard rack in one tap.
  update({ units })
}

function loadDefaultInventory(): void {
  const units = props.modelValue.units
  update({ plates: defaultPlateRows(units), barbellWeight: units === 'lb' ? 45 : 20 })
}

function setPlates(rows: PlateRow[]): void {
  update({ plates: rows })
}

function setPlateWeight(index: number, value: unknown): void {
  setPlates(plates.value.map((row, i) => (i === index ? { ...row, weight: toNumber(value) } : row)))
}

function setPlateCount(index: number, value: unknown): void {
  setPlates(plates.value.map((row, i) => (i === index ? { ...row, count: toNumber(value) } : row)))
}

function stepPlateCount(index: number, delta: number): void {
  const current = plates.value[index]
  setPlateCount(index, Math.max(1, Math.round(toNumber(current.count)) + delta))
}

// Re-sorting on every keystroke would drag the row out from under the thumb
// while it is being typed into, so the order is only restored on blur.
function sortRows(): void {
  setPlates(sortPlatesDesc(plates.value))
}

function addPlate(): void {
  setPlates([...plates.value, { weight: 0, count: 2 }])
}

function removePlate(index: number): void {
  setPlates(plates.value.filter((_, i) => i !== index))
}

// Selecting the content on focus: these fields are almost always retyped whole,
// and on a phone a caret dropped in the middle of "22.5" is a fiddly fix.
function selectAll(event: FocusEvent): void {
  const target = event.target
  if (target instanceof HTMLInputElement) target.select()
}

watch(isValid, (value) => emit('update:valid', value), { immediate: true })
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- fieldset/legend rather than FormGroup: FormGroup's label is a
         `<label for>` pointing at an id no radiogroup can carry, so the group
         would be left with no name at all. -->
    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium text-ink-900">Units</legend>
      <p class="text-sm text-ink-500">Everything the app shows and stores uses this unit.</p>
      <RadioButtonGroup
        :model-value="modelValue.units"
        :options="UNIT_OPTIONS"
        option-label="label"
        option-value="value"
        size="large"
        class="min-h-[48px]"
        @update:model-value="setUnits"
      />
    </fieldset>

    <!-- Shown only after a switch: a re-labelled inventory is the one place in
         this form where doing nothing leaves wrong data behind. -->
    <div v-if="unitsChanged" class="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm">
      <Icon name="alert" size="large" class="shrink-0 text-accent-600" />
      <div>
        <p class="font-semibold text-ink-900">Your numbers were not converted.</p>
        <p class="mt-1 text-ink-500">
          The bar and plates below are now read as {{ modelValue.units }}. Check them, or load a standard
          {{ modelValue.units }} set.
        </p>
        <Button
          label="Use a standard set"
          variant="outlined"
          class="mt-3 min-h-[48px]"
          @click="loadDefaultInventory()"
        />
      </div>
    </div>

    <FormGroup
      label="Barbell weight"
      :error="barbellError ?? false"
      :hint="`In ${modelValue.units}. Most Olympic bars are 20 kg / 45 lb.`"
    >
      <template #default="{ id }">
        <Input
          :id="id"
          :model-value="modelValue.barbellWeight"
          type="number"
          value-as-number
          inputmode="decimal"
          step="0.5"
          min="0"
          size="large"
          class="min-h-[48px] text-lg"
          :invalid="barbellError !== null"
          @focus="selectAll"
          @update:model-value="update({ barbellWeight: toNumber($event) })"
        />
      </template>
    </FormGroup>

    <section class="flex flex-col gap-3">
      <header>
        <h2 class="font-semibold text-ink-900">Plates</h2>
        <p class="text-sm text-ink-500">How many pairs of each size you have — one plate per side counts as a pair.</p>
      </header>

      <ul class="flex flex-col gap-3">
        <li v-for="(plate, index) in plates" :key="index" class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <Input
              :model-value="plate.weight"
              type="number"
              value-as-number
              inputmode="decimal"
              step="0.25"
              min="0"
              size="large"
              class="min-h-[48px] w-24 text-lg"
              :aria-label="`Plate weight in ${modelValue.units}`"
              :aria-describedby="rowError(index) ? `plate-error-${index}` : undefined"
              :invalid="rowError(index) !== null"
              @focus="selectAll"
              @blur="sortRows()"
              @update:model-value="setPlateWeight(index, $event)"
            />
            <span class="w-8 text-ink-500">{{ modelValue.units }}</span>

            <div class="ml-auto flex items-center gap-1">
              <IconButton
                icon="minus"
                variant="outlined"
                size="large"
                class="min-h-[48px] min-w-[48px]"
                :title="`Fewer ${plate.weight} ${modelValue.units} pairs`"
                @click="stepPlateCount(index, -1)"
              />
              <Input
                :model-value="plate.count"
                type="number"
                value-as-number
                inputmode="numeric"
                step="1"
                min="1"
                size="large"
                class="min-h-[48px] w-16 text-center text-lg"
                :aria-label="`Pairs of ${plate.weight} ${modelValue.units} plates`"
                :aria-describedby="rowError(index) ? `plate-error-${index}` : undefined"
                :invalid="rowError(index) !== null"
                @focus="selectAll"
                @update:model-value="setPlateCount(index, $event)"
              />
              <IconButton
                icon="plus"
                variant="outlined"
                size="large"
                class="min-h-[48px] min-w-[48px]"
                :title="`More ${plate.weight} ${modelValue.units} pairs`"
                @click="stepPlateCount(index, 1)"
              />
              <IconButton
                icon="close"
                variant="text"
                size="large"
                class="min-h-[48px] min-w-[48px]"
                :title="`Remove the ${plate.weight} ${modelValue.units} plates`"
                @click="removePlate(index)"
              />
            </div>
          </div>

          <p v-if="rowError(index)" :id="`plate-error-${index}`" role="alert" class="text-sm text-accent-700">
            {{ rowError(index) }}
          </p>
        </li>
      </ul>

      <p v-if="inventoryError" role="alert" class="text-sm text-accent-700">{{ inventoryError }}</p>

      <Button label="Add a plate size" prefix-icon="plus" variant="outlined" class="min-h-[48px]" @click="addPlate()" />
    </section>

    <!-- The proof that the inventory works. A user who mistypes a count sees it
         here as a weight they cannot load, long before a session prescribes it. -->
    <section class="flex flex-col gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4">
      <h2 class="font-semibold text-ink-900">Check your setup</h2>

      <p class="text-sm text-ink-500">
        Smallest change your bar can take:
        <span class="font-semibold text-ink-900">{{ step }} {{ modelValue.units }}</span>
      </p>

      <FormGroup label="Try a weight">
        <template #default="{ id }">
          <Input
            :id="id"
            v-model="sampleWeight"
            type="number"
            value-as-number
            inputmode="decimal"
            step="2.5"
            min="0"
            size="large"
            class="min-h-[48px] text-lg"
            @focus="selectAll"
          />
        </template>
      </FormGroup>

      <p class="text-ink-900" role="status">
        <span class="font-mono text-lg font-semibold">{{ formatPlateLoad(sampleLoad, modelValue) }}</span>
        <span class="ml-2 text-sm text-ink-500">per side</span>
      </p>

      <p v-if="!sampleLoad.exact" class="text-sm text-ink-500">
        You cannot load exactly {{ sampleWeight }} {{ modelValue.units }} — the closest is
        {{ sampleLoad.achievable.value }} {{ sampleLoad.achievable.unit }}.
      </p>
    </section>
  </div>
</template>
