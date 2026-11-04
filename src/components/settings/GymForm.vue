<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button, Icon, Input, RadioButtonGroup } from 'vuiii'

import CountStepper from '@/components/CountStepper.vue'
import InputUnit from '@/components/InputUnit.vue'
import NumberField from '@/components/NumberField.vue'
import { PLATE_PAINT } from '@/components/strength/platePaint'
import PlateStack from '@/components/strength/PlateStack.vue'
import { smallestStep } from '@/liftoscript/weight'
import {
  defaultPlateRows,
  type PlateRow,
  sortPlatesDesc,
  validateBarbell,
  validatePlates,
} from '@/onboarding/plateInventory'
import type { GymSettings } from '@/onboarding/types'
import { formatPlateLoad, PLATE_COLORS_ALL, type PlateColor, plateColor, platesForWeight } from '@/training/plates'

const props = defineProps<{ modelValue: GymSettings }>()

const emit = defineEmits<{
  'update:modelValue': [value: GymSettings]
  'update:valid': [value: boolean]
}>()

const UNIT_OPTIONS = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
] as const

const COLOR_NAMES: Record<PlateColor, string> = {
  red: 'Red',
  blue: 'Blue',
  yellow: 'Yellow',
  green: 'Green',
  grey: 'Grey',
  'pale-red': 'Pale red',
  'pale-blue': 'Pale blue',
  'pale-yellow': 'Pale yellow',
  'pale-green': 'Pale green',
  'pale-grey': 'Pale grey',
  silver: 'Silver',
  black: 'Black',
}

/** A swatch of a plate colour, in the button and in the picker: the disc's own paint and rim. */
function swatchClass(color: PlateColor): string {
  return `${PLATE_PAINT[color].fill} ${PLATE_PAINT[color].rim} ring-1 ring-inset`
}

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

// Re-sorting on every keystroke would drag the row out from under the thumb
// while it is being typed into, so the order is only restored on blur.
function sortRows(): void {
  // The open picker is tied to a row index, which the sort is about to move.
  colorRow.value = null
  setPlates(sortPlatesDesc(plates.value))
}

/** The row whose colour picker is open; one at a time keeps the list short. */
const colorRow = ref<number | null>(null)

function toggleColorRow(index: number): void {
  colorRow.value = colorRow.value === index ? null : index
}

/** The colour a row shows: its own paint, or the competition colour for its size. */
function rowColor(row: PlateRow): PlateColor {
  return row.color ?? plateColor(row.weight, props.modelValue.units)
}

/**
 * Picking the competition colour for the size stores nothing: an absent
 * `color` is what "the usual colour" means, so there is no separate option to
 * go back to it, and the plate keeps following the convention if its weight
 * is retyped.
 */
function setPlateColor(index: number, color: PlateColor): void {
  setPlates(
    plates.value.map((row, i) => {
      if (i !== index) return row
      // Dropped rather than stored as undefined: Firestore rejects an undefined field.
      const { color: _previous, ...rest } = row
      return color === plateColor(row.weight, props.modelValue.units) ? rest : { ...rest, color }
    }),
  )
  colorRow.value = null
}

/** The new row's weight is the next thing to type, so it gets the focus. */
function addPlate(): void {
  const index = plates.value.length
  setPlates([...plates.value, { weight: 0, count: 2 }])
  // After the parent has written the row back through v-model and it rendered.
  void nextTick(() => document.getElementById(`plate-weight-${index}`)?.focus())
}

function removePlate(index: number): void {
  colorRow.value = null
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
          color="primary"
          label="Use a standard set"
          variant="outlined"
          class="mt-3 min-h-[48px]"
          @click="loadDefaultInventory()"
        />
      </div>
    </div>

    <NumberField
      label="Barbell weight"
      :error="barbellError ?? false"
      hint="Most Olympic bars are 20 kg / 45 lb."
      :unit="modelValue.units"
      inputmode="decimal"
      step="0.5"
      :invalid="barbellError !== null"
      :model-value="modelValue.barbellWeight"
      @focus="selectAll"
      @update:model-value="update({ barbellWeight: toNumber($event) })"
    />

    <section class="flex flex-col gap-3">
      <header>
        <h2 class="font-semibold text-ink-900">Plates</h2>
        <p class="text-sm text-ink-500">
          How many pairs of each size you have — one plate per side counts as a pair. Tap a colour to match it to your
          gym's.
        </p>
      </header>

      <ul class="flex flex-col gap-3">
        <li v-for="(plate, index) in plates" :key="index" class="flex flex-col gap-1">
          <!-- Sized to fit a 375px phone on one line with the weight field at
               vuiii's default left padding: the gaps are 4px, the field drops
               the right padding before its unit suffix and hides the browser's
               spin arrows (they took 13px, and − / + sit right beside it), the
               count is one framed stepper, and the remove button is 28px — rarely used, and a mis-tap there is undone by "Add a
               plate size". -->
          <div class="flex items-center gap-1">
            <Input
              :model-value="plate.weight"
              type="number"
              value-as-number
              inputmode="decimal"
              step="0.25"
              min="0"
              size="large"
              :id="`plate-weight-${index}`"
              class="min-h-[48px] w-28 shrink-0 text-lg [&_input]:pr-0! [&_input]:[appearance:textfield] [&_input::-webkit-inner-spin-button]:appearance-none"
              :aria-label="`Plate weight in ${modelValue.units}`"
              :aria-describedby="rowError(index) ? `plate-error-${index}` : undefined"
              :invalid="rowError(index) !== null"
              @focus="selectAll"
              @blur="sortRows()"
              @update:model-value="setPlateWeight(index, $event)"
            >
              <template #suffix>
                <InputUnit :unit="modelValue.units" compact />
              </template>
            </Input>

            <!-- The colour the session will paint this plate in, as a swatch
                 inside a square button like the count buttons beside it. After
                 the weight: the size is what the row is about. -->
            <button
              type="button"
              class="ml-1 flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-ink-300 bg-white focus-visible:outline-2 focus-visible:outline-accent-600"
              :class="colorRow === index ? 'border-accent-600' : ''"
              :aria-expanded="colorRow === index"
              :aria-controls="`plate-colors-${index}`"
              :aria-label="`Colour of the ${plate.weight} ${modelValue.units} plates: ${COLOR_NAMES[rowColor(plate)]}`"
              @click="toggleColorRow(index)"
            >
              <span class="size-6 shrink-0 rounded-md" :class="swatchClass(rowColor(plate))" aria-hidden="true" />
            </button>

            <CountStepper
              :model-value="plate.count"
              :min="1"
              class="ml-auto"
              :label="`Pairs of ${plate.weight} ${modelValue.units} plates`"
              :decrease-label="`Fewer ${plate.weight} ${modelValue.units} pairs`"
              :increase-label="`More ${plate.weight} ${modelValue.units} pairs`"
              @update:model-value="setPlateCount(index, $event)"
            />

            <!-- Hand-rolled, not an IconButton: vuiii pads its buttons to at
                 least 36px, and this one has 28 to spare. -->
            <button
              type="button"
              class="flex h-12 w-7 shrink-0 items-center justify-center rounded-lg text-ink-700 focus-visible:outline-2 focus-visible:outline-accent-600"
              :aria-label="`Remove the ${plate.weight} ${modelValue.units} plates`"
              :title="`Remove the ${plate.weight} ${modelValue.units} plates`"
              @click="removePlate(index)"
            >
              <Icon name="close" aria-hidden="true" />
            </button>
          </div>

          <div
            v-if="colorRow === index"
            :id="`plate-colors-${index}`"
            role="radiogroup"
            :aria-label="`Colour of the ${plate.weight} ${modelValue.units} plates`"
            class="flex flex-wrap items-center gap-1 rounded-lg border border-ink-200 bg-ink-50 p-2"
          >
            <button
              v-for="color in PLATE_COLORS_ALL"
              :key="color"
              type="button"
              role="radio"
              :aria-checked="rowColor(plate) === color"
              :aria-label="COLOR_NAMES[color]"
              :title="COLOR_NAMES[color]"
              class="flex size-10 cursor-pointer items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-accent-600"
              :class="rowColor(plate) === color ? 'ring-2 ring-accent-600' : ''"
              @click="setPlateColor(index, color)"
            >
              <span class="size-7 rounded-md" :class="swatchClass(color)" aria-hidden="true" />
            </button>
          </div>

          <p v-if="rowError(index)" :id="`plate-error-${index}`" role="alert" class="text-sm text-accent-700">
            {{ rowError(index) }}
          </p>
        </li>
      </ul>

      <p v-if="inventoryError" role="alert" class="text-sm text-accent-700">{{ inventoryError }}</p>

      <Button
        color="primary"
        label="Add a plate size"
        prefix-icon="plus"
        variant="outlined"
        class="min-h-[48px]"
        @click="addPlate()"
      />
    </section>

    <!-- The proof that the inventory works. A user who mistypes a count sees it
         here as a weight they cannot load, long before a session prescribes it. -->
    <section class="flex flex-col gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4">
      <h2 class="font-semibold text-ink-900">Check your setup</h2>

      <p class="text-sm text-ink-500">
        Smallest change your bar can take:
        <span class="font-semibold text-ink-900">{{ step }} {{ modelValue.units }}</span>
      </p>

      <NumberField
        label="Try a weight"
        :unit="modelValue.units"
        inputmode="decimal"
        step="2.5"
        :model-value="sampleWeight"
        @focus="selectAll"
        @update:model-value="sampleWeight = $event as number"
      />

      <!-- The same discs the session shows, so the colours a user checks here
           are the ones they will look for on the rack. The text load stays for
           the live region: a status that announces nothing is no status. -->
      <p class="flex flex-wrap items-center gap-1 text-ink-900" role="status">
        <span class="sr-only">{{ formatPlateLoad(sampleLoad, modelValue) }} per side</span>
        <PlateStack :load="sampleLoad" :settings="modelValue" class="text-lg font-semibold tabular-nums" />
        <span class="ml-1 text-sm text-ink-500" aria-hidden="true">per side</span>
      </p>

      <p v-if="!sampleLoad.exact" class="text-sm text-ink-500">
        You cannot load exactly {{ sampleWeight }} {{ modelValue.units }} — the closest is
        {{ sampleLoad.achievable.value }} {{ sampleLoad.achievable.unit }}.
      </p>
    </section>
  </div>
</template>
