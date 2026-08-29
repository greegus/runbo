<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, FormGroup, Icon, Input, RadioButtonGroup } from 'vuiii'

import { computeFromFiveRm, GZCLP_SEED_GROUPS } from '@/onboarding/programSeed'
import type { GymSettings, LiftSeedDraft } from '@/onboarding/types'
import { formatPlatesForWeight } from '@/training/plates'

const props = defineProps<{
  modelValue: LiftSeedDraft[]
  settings: GymSettings
}>()

const emit = defineEmits<{ 'update:modelValue': [value: LiftSeedDraft[]] }>()

const STAGE_OPTIONS = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
]

/**
 * The rows arrive flat, in `GZCLP_SEED_GROUPS` order. Walking the groups and
 * consuming that many rows keeps the day headings tied to the program's own
 * grouping instead of to index ranges that would drift if a key ever moved.
 */
const groups = computed(() => {
  let start = 0

  return GZCLP_SEED_GROUPS.map((group) => {
    const rows = props.modelValue
      .slice(start, start + group.keys.length)
      .map((draft, offset) => ({ draft, index: start + offset }))

    start += group.keys.length

    return { day: group.day, rows }
  })
})

const askCount = computed(() => props.modelValue.filter((draft) => draft.weight === null).length)

/** Never mutate the prop: the wizard's draft array is the parent's, and a spread is what keeps it so. */
function patch(index: number, changes: Partial<LiftSeedDraft>): void {
  emit(
    'update:modelValue',
    props.modelValue.map((draft, position) => (position === index ? { ...draft, ...changes } : draft)),
  )
}

// An empty field must mean "ask me at the gym", so a cleared input becomes null
// rather than 0 — a 0 kg prescription is a real number the app would obey.
function setWeight(index: number, value: unknown): void {
  const parsed = typeof value === 'number' ? value : Number(value)
  patch(index, { weight: Number.isFinite(parsed) && parsed > 0 ? parsed : null })
}

function setFiveRm(index: number, value: unknown): void {
  const parsed = typeof value === 'number' ? value : Number(value)
  patch(index, { fiveRm: Number.isFinite(parsed) && parsed > 0 ? parsed : null })
}

/**
 * Whether the 5RM panel is open is component state, kept apart from the value it
 * collects: an empty number input emits `NaN`, so tying visibility to `fiveRm`
 * would unmount the field the moment the user cleared it to retype — which is
 * exactly how a number gets corrected at arm's length in a gym. Keyed by the
 * draft key, and seeded from the drafts so returning to this step reopens the
 * rows that already carry a 5RM.
 */
const openHelpers = ref(new Set(props.modelValue.filter((draft) => draft.fiveRm !== null).map((draft) => draft.key)))

function isHelperOpen(draft: LiftSeedDraft): boolean {
  return openHelpers.value.has(draft.key)
}

function setHelperOpen(key: string, isOpen: boolean): void {
  const next = new Set(openHelpers.value)
  if (isOpen) next.add(key)
  else next.delete(key)
  openHelpers.value = next
}

function toggleHelper(index: number): void {
  const draft = props.modelValue[index]
  const wasOpen = openHelpers.value.has(draft.key)
  setHelperOpen(draft.key, !wasOpen)
  if (wasOpen) patch(index, { fiveRm: null }) // cancel clears the value it collected
}

/** The 85/65/50 % factors and the rounding both live in the domain — this only writes the answer back. */
function compute(index: number): void {
  const seeded = computeFromFiveRm(props.modelValue[index], props.settings)
  emit(
    'update:modelValue',
    props.modelValue.map((draft, position) => (position === index ? seeded : draft)),
  )
  // The answer is in the weight field now; leaving the panel open would give ten
  // rows the user has to dismiss by hand. The 5RM itself stays on the draft, so
  // reopening the panel shows what the number came from.
  setHelperOpen(props.modelValue[index].key, false)
}

/** The bar-and-plates hint, so a weight the gym cannot load is visible before the gym. */
function plateHint(draft: LiftSeedDraft): string {
  if (draft.weight === null) return ''
  return formatPlatesForWeight({ value: draft.weight, unit: props.settings.units }, props.settings)
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Ask-weight is the default, and it is not obvious what it costs: without
         this line an athlete leaves the form empty without realising the first
         session will stop and ask for every number. -->
    <p class="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm text-ink-700">
      <Icon name="alert" class="mt-0.5 shrink-0 text-accent-600" />
      <span>
        Leave a weight empty and we’ll ask you for it at the gym, before your first set of that lift.
        <template v-if="askCount > 0">
          Right now that’s <strong>{{ askCount }}</strong> of {{ modelValue.length }} lifts.
        </template>
      </span>
    </p>

    <section v-for="group in groups" :key="group.day" class="flex flex-col gap-4">
      <h2 class="text-sm font-semibold tracking-wide text-ink-500 uppercase">Day {{ group.day }}</h2>

      <div v-for="row in group.rows" :key="row.draft.key" class="rounded-lg border border-ink-200 p-4">
        <div class="flex items-center gap-2">
          <span class="rounded bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-700">T{{ row.draft.tier }}</span>
          <h3 class="text-base font-semibold text-ink-900">{{ row.draft.lift }}</h3>
        </div>

        <div class="mt-3 flex flex-wrap items-start gap-4">
          <FormGroup
            :label="`Working weight (${settings.units})`"
            class="min-w-[9rem] flex-1"
            :hint="row.draft.weight === null ? 'Empty — we’ll ask at the gym' : plateHint(row.draft)"
          >
            <template #default="{ id }">
              <!-- Big numerals: this field is read and retyped at arm's length in a gym. -->
              <Input
                :id="id"
                class="min-h-[48px] text-lg"
                :model-value="row.draft.weight"
                type="number"
                value-as-number
                inputmode="decimal"
                step="0.5"
                min="0"
                @update:model-value="setWeight(row.index, $event)"
              />
            </template>
          </FormGroup>

          <!-- A T3 line has a single set variation, so a stage picker there would
               offer two choices that do nothing. The group is named with
               `aria-label`, not FormGroup's slot id: a `<label for>` cannot name
               a `role="radiogroup"` div. -->
          <FormGroup v-if="row.draft.tier !== 3" label="Stage" hint="1 → 2 → 3 as you stall">
            <RadioButtonGroup
              aria-label="Stage"
              class="min-h-[48px]"
              :model-value="row.draft.stage"
              :options="STAGE_OPTIONS"
              @update:model-value="patch(row.index, { stage: $event as number })"
            />
          </FormGroup>
        </div>

        <div class="mt-3">
          <Button
            variant="text"
            size="small"
            class="min-h-[48px]"
            :label="isHelperOpen(row.draft) ? 'Cancel' : 'I don’t know — work it out from a 5RM'"
            :aria-expanded="isHelperOpen(row.draft)"
            @click="toggleHelper(row.index)"
          />
        </div>

        <div v-if="isHelperOpen(row.draft)" class="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-ink-50 p-3">
          <FormGroup
            :label="`Your 5-rep max (${settings.units})`"
            class="min-w-[9rem] flex-1"
            hint="The heaviest weight you can do five hard reps with."
          >
            <template #default="{ id }">
              <Input
                :id="id"
                class="min-h-[48px] text-lg"
                :model-value="row.draft.fiveRm"
                type="number"
                value-as-number
                inputmode="decimal"
                step="0.5"
                min="0"
                @update:model-value="setFiveRm(row.index, $event)"
              />
            </template>
          </FormGroup>

          <Button
            class="min-h-[48px]"
            variant="outlined"
            label="Work it out"
            :disabled="!row.draft.fiveRm"
            @click="compute(row.index)"
          />

          <p class="basis-full text-xs text-ink-500">
            {{
              row.draft.tier === 1
                ? 'A T1 starts at 85 % of your 5RM.'
                : row.draft.tier === 2
                  ? 'A T2 starts at 65 % of your 5RM.'
                  : 'A T3 is a 15-rep set, so it starts at 50 % of your 5RM.'
            }}
            We round it to something your bar and plates can actually be loaded to, and you can still change it.
          </p>
        </div>
      </div>
    </section>
  </div>
</template>
