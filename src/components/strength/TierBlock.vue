<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FormGroup, Icon, IconButton, Input } from 'vuiii'

import DiagnosticsList from '@/components/DiagnosticsList.vue'
import PlateHint from '@/components/strength/PlateHint.vue'
import SetRow from '@/components/strength/SetRow.vue'
import { format } from '@/liftoscript/weight'
import { type PrescribedExercise, restSecFor } from '@/session/strengthSession'
import type { LoggedSet } from '@/session/types'
import { roundToLoadable } from '@/training/plates'
import type { Profile, WeightValue } from '@/types'

/**
 * One exercise of the session: header, working weight, warmup ramp and the
 * working sets.
 *
 * The block holds no transition logic — every set change comes back from
 * `SetRow` as a finished `LoggedSet` and is stored by the parent. The only rule
 * this component reaches for is `restSecFor`, and it does so to *report* the
 * rest length upwards, never to run a clock of its own.
 */
const props = withDefaults(
  defineProps<{
    exercise: PrescribedExercise
    /** Same length and order as `exercise.sets`. */
    modelValue: LoggedSet[]
    settings: Profile['settings']
    collapsed?: boolean
    busy?: boolean
  }>(),
  { collapsed: false, busy: false },
)

const emit = defineEmits<{
  'update:modelValue': [sets: LoggedSet[]]
  'update:collapsed': [collapsed: boolean]
  'first-log': [payload: { setIndex: number; restSec: number }]
  'update:weight': [weight: WeightValue]
}>()

const WEIGHT_BLOCKED = 'Enter a weight to log this exercise'

/** Warmups are display-only, and on a phone they push the working sets off screen. */
const warmupOpen = ref(false)

const tierLabel = computed(() => (props.exercise.tier ? `T${props.exercise.tier}` : 'Extra'))

/**
 * The weight the rows are actually carrying. The sets are the source of truth,
 * not `exercise.workingWeight`: the athlete may have changed it this session,
 * and the plan is rebuilt from the profile, which has not moved.
 */
const currentWeight = computed<WeightValue | null>(() => {
  const hasWeight = (set: LoggedSet): boolean => Number.isFinite(set.weight?.value) && set.weight.value > 0

  // The sets still to be done win over the ones already logged: changing the
  // working weight mid-exercise rewrites only untouched sets (a logged set
  // records what was actually lifted), and this header is the number the
  // athlete reads to decide what to load NEXT.
  const upcoming = props.modelValue.find((set) => set.phase === 'untouched' && hasWeight(set))
  if (upcoming) return upcoming.weight

  const fromSets = props.modelValue.find(hasWeight)
  if (fromSets) return fromSets.weight

  return props.exercise.workingWeight
})

const needsWeight = computed(() => currentWeight.value === null || currentWeight.value.value <= 0)

/** The weight input is required whenever the program asks, or nothing is known. */
const asksWeight = computed(() => props.exercise.askWeight || props.exercise.workingWeight === null)

const weightDraft = ref<number | null>(currentWeight.value?.value ?? null)

// Re-seed only while the athlete is not editing: a snapshot echoing back must
// never stomp a number half-typed with chalky hands.
const weightTouched = ref(false)

watch(currentWeight, (weight) => {
  if (!weightTouched.value) weightDraft.value = weight?.value ?? null
})

const weightLabel = computed(() => {
  const weight = currentWeight.value

  return weight ? format(weight) : 'weight not set'
})

function toNumberOrNull(value: unknown): number | null {
  // Coerce at the boundary: our own control handing back NaN must not be able to
  // block the athlete behind a validation failure.
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function setWeightDraft(value: unknown): void {
  weightTouched.value = true
  weightDraft.value = toNumberOrNull(value)
}

/** Rounding on blur, not on every keystroke — typing "1" in "105" must not become the bar. */
function commitWeight(): void {
  const entered = weightDraft.value
  if (entered === null || entered <= 0 || props.busy) {
    // Release the latch even when there is nothing to commit: leaving it set
    // would silence the re-seed watcher for the rest of the session, so a
    // cleared field would never fill itself in again from an authoritative
    // weight (a rehydrated session, or our own `update:weight` echo).
    weightTouched.value = false
    return
  }

  const rounded = roundToLoadable({ value: entered, unit: props.settings.units }, props.settings)

  weightDraft.value = rounded.value
  weightTouched.value = false
  emit('update:weight', rounded)
}

function updateSet(index: number, set: LoggedSet): void {
  emit(
    'update:modelValue',
    props.modelValue.map((current, i) => (i === index ? set : current)),
  )
}

function onFirstLog(index: number): void {
  emit('first-log', { setIndex: index, restSec: restSecFor(props.exercise, index) })
}

function selectAll(event: FocusEvent): void {
  const target = event.target
  if (target instanceof HTMLInputElement) target.select()
}
</script>

<template>
  <section class="rounded-2xl border border-ink-200 bg-white">
    <header class="flex items-start gap-3 p-4">
      <span
        class="shrink-0 rounded-lg bg-accent-600 px-2.5 py-1 text-sm font-bold text-white"
        :aria-label="exercise.tier ? `Tier ${exercise.tier}` : 'Accessory'"
      >
        {{ tierLabel }}
      </span>

      <div class="min-w-0 flex-1">
        <h2 class="text-lg leading-tight font-bold text-ink-900">{{ exercise.name }}</h2>
        <p class="text-sm text-ink-500 tabular-nums">{{ weightLabel }}</p>
        <PlateHint
          v-if="exercise.showPlates && currentWeight"
          :weight="currentWeight"
          :settings="settings"
          class="mt-0.5"
        />
      </div>

      <IconButton
        :icon="collapsed ? 'chevron-down' : 'chevron-up'"
        variant="text"
        size="large"
        class="min-h-[48px] min-w-[48px]"
        :aria-label="collapsed ? `Show ${exercise.name} sets` : `Hide ${exercise.name} sets`"
        :aria-expanded="!collapsed"
        @click="emit('update:collapsed', !collapsed)"
      />
    </header>

    <div v-if="!collapsed" class="flex flex-col gap-4 px-4 pb-4">
      <!-- A prescription the engine could not build is never silently rendered:
           the athlete would train off numbers that mean nothing. -->
      <DiagnosticsList v-if="exercise.diagnostics.length" :diagnostics="exercise.diagnostics" />

      <FormGroup
        v-if="asksWeight"
        label="Working weight"
        :hint="`In ${settings.units}. Rounded to what your plates can load.`"
      >
        <template #default="{ id }">
          <div class="flex items-center gap-2">
            <Input
              :id="id"
              :model-value="weightDraft"
              aria-label="Working weight"
              type="number"
              value-as-number
              inputmode="decimal"
              step="0.5"
              min="0"
              size="large"
              class="min-h-[48px] w-32 text-lg"
              :invalid="needsWeight"
              @focus="selectAll"
              @blur="commitWeight()"
              @update:model-value="setWeightDraft($event)"
            />
            <span class="text-ink-500">{{ settings.units }}</span>
          </div>
        </template>
      </FormGroup>

      <!-- Warmups are prescribed and shown, never logged: a warmup inside
           `exercises[].sets` would be fed to the progression script and counted
           as working volume by the stats. -->
      <div v-if="exercise.warmup.length" class="rounded-xl border border-dashed border-ink-200 bg-ink-50">
        <button
          type="button"
          class="flex w-full min-h-[48px] items-center justify-between gap-2 px-3 py-2 text-left"
          :aria-expanded="warmupOpen"
          @click="warmupOpen = !warmupOpen"
        >
          <span class="text-sm font-medium text-ink-700">Warmup · {{ exercise.warmup.length }} sets</span>
          <Icon :name="warmupOpen ? 'chevron-up' : 'chevron-down'" class="text-ink-400" />
        </button>

        <ul v-if="warmupOpen" role="list" class="flex flex-col gap-1 px-3 pb-3">
          <li
            v-for="(warmup, index) in exercise.warmup"
            :key="index"
            class="flex flex-wrap items-baseline gap-x-3 text-sm text-ink-700 tabular-nums"
          >
            <span class="font-semibold">{{ warmup.reps }} reps</span>
            <span>{{ format(warmup.weight) }}</span>
            <PlateHint v-if="exercise.showPlates" :weight="warmup.weight" :settings="settings" compact />
          </li>
        </ul>

        <p v-if="warmupOpen" class="px-3 pb-3 text-xs text-ink-500">Warmups are not recorded.</p>
      </div>

      <!-- The reason rides on the first row only: repeated under all five it
           becomes wallpaper, and it is one blocked control ("this exercise"),
           not five. -->
      <ul role="list" class="flex flex-col gap-2">
        <li v-for="(set, index) in modelValue" :key="index">
          <SetRow
            :model-value="set"
            :set-number="index + 1"
            :plate-settings="exercise.showPlates ? settings : null"
            :disabled="needsWeight"
            :disabled-reason="index === 0 ? WEIGHT_BLOCKED : null"
            @update:model-value="updateSet(index, $event)"
            @first-log="onFirstLog(index)"
          />
        </li>
      </ul>
    </div>
  </section>
</template>
