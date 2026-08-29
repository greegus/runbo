<script setup lang="ts">
import { computed } from 'vue'
import { Button } from 'vuiii'

import WeekPreview from '@/components/WeekPreview.vue'
import type { Profile } from '@/types'
import { toIso, WEEKDAY_LABELS } from '@/utils/date'
import StepShell from '@/views/onboarding/steps/StepShell.vue'

const props = withDefaults(
  defineProps<{
    modelValue: Profile
    busy?: boolean
    error?: string | null
  }>(),
  { busy: false, error: null },
)

defineEmits<{
  'update:modelValue': [value: Profile]
  next: []
  back: []
  skip: []
}>()

const todayIso = toIso(new Date())

const MODALITY_LABELS: Record<string, string> = { run: 'Run', bike: 'Bike', swim: 'Swim' }

const gym = computed(() => {
  const { units, barbellWeight, plates } = props.modelValue.settings

  return {
    units,
    barbell: `${barbellWeight} ${units}`,
    plates: plates.map((plate) => `${plate.weight} × ${plate.count}`).join(', ') || 'None',
  }
})

/**
 * One line per programmed lift. The weight shown is the one the first session
 * will prescribe — an empty `weights` array is the ask-weight state, which is a
 * deliberate answer here and not a gap to apologise for.
 */
const lifts = computed(() =>
  Object.entries(props.modelValue.strengthTrack.programState).map(([key, state]) => {
    const weight = state.weights[0]

    return {
      key,
      weight: weight ? `${weight.value} ${weight.unit}` : 'We’ll ask at the gym',
      stage: state.setVariationIndex,
    }
  }),
)

const cardio = computed(() => {
  const { modalities, weeklyMinutes, longestSessionMinutes } = props.modelValue.cardioTrack

  return {
    modalities: modalities.map((modality) => MODALITY_LABELS[modality] ?? modality).join(', ') || 'None',
    weekly: `${weeklyMinutes} min per week`,
    longest: `${longestSessionMinutes} min longest session`,
  }
})

const zoneLines = computed(() => {
  const zones = props.modelValue.cardioTrack.zones
  const lines: string[] = []

  if (zones?.hr?.max) lines.push(`Max HR ${zones.hr.max} bpm`)
  if (zones?.hr?.lthr) lines.push(`Threshold HR ${zones.hr.lthr} bpm`)
  if (zones?.pace?.run) lines.push(`Run threshold ${zones.pace.run} sec/km`)
  if (zones?.pace?.bike) lines.push(`Bike threshold ${zones.pace.bike} km/h`)
  if (zones?.pace?.swim) lines.push(`Swim threshold ${zones.pace.swim} sec/100 m`)

  return lines
})

const availability = computed(() => {
  const { daysPerWeek, preferredDays, longSessionDay } = props.modelValue.availability

  return {
    days: `${daysPerWeek} day${daysPerWeek === 1 ? '' : 's'} a week`,
    preferred: preferredDays.map((day) => WEEKDAY_LABELS[day]).join(', ') || 'No preference',
    long: WEEKDAY_LABELS[longSessionDay] ?? '—',
  }
})

const sections = computed(() => [
  { step: '1', title: 'Gym', lines: [gym.value.barbell, `Plates per side: ${gym.value.plates}`] },
  { step: '3', title: 'Cardio', lines: [cardio.value.modalities, cardio.value.weekly, cardio.value.longest] },
  { step: '4', title: 'Zones', lines: zoneLines.value.length ? zoneLines.value : ['Skipped — sessions go by effort'] },
  {
    step: '5',
    title: 'Week',
    lines: [
      availability.value.days,
      `Preferred: ${availability.value.preferred}`,
      `Long day: ${availability.value.long}`,
    ],
  },
])
</script>

<template>
  <StepShell
    :step="6"
    title="Review & start"
    description="Everything below is editable later in Settings."
    next-label="Start training"
    :busy="busy"
    :error="error"
    @next="$emit('next')"
    @back="$emit('back')"
    @skip="$emit('skip')"
  >
    <div class="flex flex-col gap-4">
      <section
        v-for="section in sections"
        :key="section.title"
        class="rounded-lg border border-ink-200 p-4"
        :aria-label="section.title"
      >
        <header class="flex items-center justify-between gap-2">
          <h2 class="font-semibold text-ink-900">{{ section.title }}</h2>
          <!-- A router-link rather than an emit: jumping back to a step is
               navigation, and the wizard's own step map already renders whatever
               the URL says. -->
          <Button
            label="Edit"
            variant="text"
            class="min-h-[48px]"
            :to="{ name: 'onboarding', params: { step: section.step } }"
            :aria-label="`Edit ${section.title}`"
          />
        </header>
        <p v-for="line in section.lines" :key="line" class="text-sm text-ink-700">{{ line }}</p>
      </section>

      <section class="rounded-lg border border-ink-200 p-4" aria-label="Program">
        <header class="flex items-center justify-between gap-2">
          <h2 class="font-semibold text-ink-900">Program</h2>
          <Button
            label="Edit"
            variant="text"
            class="min-h-[48px]"
            :to="{ name: 'onboarding', params: { step: '2' } }"
            aria-label="Edit program"
          />
        </header>

        <ul class="mt-1 flex flex-col gap-1">
          <li v-for="lift in lifts" :key="lift.key" class="flex items-baseline justify-between gap-3 text-sm">
            <span class="text-ink-700">{{ lift.key }}</span>
            <span class="text-right text-ink-900">
              {{ lift.weight }}
              <span class="text-ink-500">· stage {{ lift.stage }}</span>
            </span>
          </li>
        </ul>
      </section>
    </div>

    <template #aside>
      <section class="mt-8" aria-labelledby="review-week-heading">
        <h2 id="review-week-heading" class="text-lg font-semibold text-ink-900">Your first week</h2>
        <WeekPreview class="mt-3" :profile="modelValue" :today-iso="todayIso" />
      </section>
    </template>
  </StepShell>
</template>
