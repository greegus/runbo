<script setup lang="ts">
import { computed, watch } from 'vue'
import { FormGroup, RadioButtonGroup, Select } from 'vuiii'

import type { Availability } from '@/onboarding/types'
import { MAX_STRENGTH_DAYS, trainingWeekdays, weeklyTrackBudget } from '@/training/composer'
import { WEEKDAY_LABELS } from '@/utils/date'

const props = defineProps<{
  modelValue: Availability
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Availability]
  'update:valid': [value: boolean]
}>()

const dayOptions = WEEKDAY_LABELS.map((label, index) => ({ value: index, label }))
const daysPerWeekOptions = [1, 2, 3, 4, 5, 6, 7].map((value) => ({ value, label: String(value) }))

const preferred = computed(() => props.modelValue.preferredDays ?? [])

/**
 * What the composer will actually train on. Showing it is the whole point:
 * `daysPerWeek` is a budget and `preferredDays` a wish list, and when the wish
 * list is shorter the composer fills forward from Monday — silently, unless the
 * form says so.
 */
const resolvedDays = computed(() => trainingWeekdays(props.modelValue))

const filledDays = computed(() => resolvedDays.value.filter((day) => !preferred.value.includes(day)))

/**
 * How the week actually splits. `WEEK_LENGTH` cardio sessions is what `planWeek`
 * itself passes — it only asks how many days cardio could have before the real
 * prescriptions exist, so the same number keeps this copy in step with the plan.
 */
const budget = computed(() => weeklyTrackBudget(props.modelValue, 7))

const longSessionOutsidePlan = computed(() => !resolvedDays.value.includes(props.modelValue.longSessionDay))

const isValid = computed(() => {
  const { daysPerWeek, longSessionDay } = props.modelValue

  return (
    Number.isInteger(daysPerWeek) &&
    daysPerWeek >= 1 &&
    daysPerWeek <= 7 &&
    Number.isInteger(longSessionDay) &&
    longSessionDay >= 0 &&
    longSessionDay <= 6
  )
})

// Every emit rebuilds the whole slice: `updateDoc` replaces nested objects
// wholesale, so a patch carrying only the edited field would drop the others.
function patch(changes: Partial<Availability>): void {
  emit('update:modelValue', { ...props.modelValue, ...changes })
}

function toggleDay(day: number): void {
  const next = preferred.value.includes(day)
    ? preferred.value.filter((value) => value !== day)
    : [...preferred.value, day]

  patch({ preferredDays: next.sort((a, b) => a - b) })
}

function labelsOf(days: number[]): string {
  return days.map((day) => WEEKDAY_LABELS[day]).join(', ')
}

watch(isValid, (value) => emit('update:valid', value), { immediate: true })
</script>

<template>
  <div class="flex flex-col gap-6">
    <FormGroup
      label="Days per week"
      hint="A budget for how many sessions we plan — it does not have to match the days you tick below."
    >
      <!-- Named with `aria-label`, not FormGroup's slot id: a `<label for>`
           cannot name the `role="radiogroup"` div this renders. -->
      <RadioButtonGroup
        aria-label="Days per week"
        :model-value="modelValue.daysPerWeek"
        :options="daysPerWeekOptions"
        size="large"
        class="min-h-[48px]"
        @update:model-value="(value: number) => patch({ daysPerWeek: value })"
      />
    </FormGroup>

    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium text-ink-900">Preferred days</legend>
      <p class="text-sm text-ink-500">The week starts on Monday.</p>

      <!-- Seven across on the narrowest phone: a grid rather than flex-wrap, so
           the columns stay index-aligned with the Mon-first day numbers we store. -->
      <div class="grid grid-cols-7 gap-1">
        <button
          v-for="option in dayOptions"
          :key="option.value"
          type="button"
          class="flex min-h-[48px] items-center justify-center rounded-md border text-sm font-semibold"
          :class="
            preferred.includes(option.value)
              ? 'border-accent-600 bg-accent-600 text-white'
              : 'border-ink-200 bg-white text-ink-700'
          "
          :aria-pressed="preferred.includes(option.value)"
          @click="toggleDay(option.value)"
        >
          {{ option.label }}
        </button>
      </div>

      <p v-if="preferred.length === 0" class="text-sm text-ink-500">
        No days ticked — we'll spread {{ modelValue.daysPerWeek }} sessions across the week for you.
      </p>
      <p v-else-if="filledDays.length > 0" class="text-sm text-ink-500">
        You asked for {{ modelValue.daysPerWeek }} days but ticked {{ preferred.length }}. We'll fill the rest from
        Monday, so the week runs on {{ labelsOf(resolvedDays) }}.
      </p>
      <p v-else-if="resolvedDays.length < preferred.length" class="text-sm text-ink-500">
        You ticked more days than your budget, so we'll use the first {{ modelValue.daysPerWeek }}:
        {{ labelsOf(resolvedDays) }}.
      </p>
    </fieldset>

    <FormGroup label="Long session day" hint="Your longest cardio session lands here when the week allows it.">
      <template #default="{ id }">
        <Select
          :id="id"
          :model-value="modelValue.longSessionDay"
          :options="dayOptions"
          type="number"
          size="large"
          class="min-h-[48px]"
          @update:model-value="(value: number) => patch({ longSessionDay: value })"
        />
      </template>
    </FormGroup>

    <!-- Not an error: the composer places the long session on the training day
         closest to this one, so a mismatch only needs explaining. -->
    <p v-if="longSessionOutsidePlan" class="text-sm text-ink-500">
      {{ WEEKDAY_LABELS[modelValue.longSessionDay] }} is not one of your training days, so we'll put the long session on
      the closest one.
    </p>

    <!-- Read off `weeklyTrackBudget` rather than restated by hand: at three days
         it keeps one day for cardio and lifts twice, at one day there is no
         cardio at all — a flat "no cardio below four days" would be a lie. -->
    <div
      v-if="modelValue.daysPerWeek <= MAX_STRENGTH_DAYS"
      class="rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm text-ink-900"
    >
      At {{ modelValue.daysPerWeek }} {{ modelValue.daysPerWeek === 1 ? 'day' : 'days' }} a week you get
      {{ budget.strengthDays }} lifting {{ budget.strengthDays === 1 ? 'day' : 'days' }} and
      {{ budget.cardioDays === 0 ? 'no cardio' : `${budget.cardioDays} cardio day` }} — strength is capped at
      {{ MAX_STRENGTH_DAYS }} days a week. Pick 4 or more days to run both tracks properly.
    </div>
  </div>
</template>
