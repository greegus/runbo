<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from 'vuiii'

import { coerceProfileForPreview } from '@/onboarding/previewProfile'
import { planWeek } from '@/training/schedule'
import { describePrescription } from '@/training/zones'
import type { Profile, Session } from '@/types'
import { formatHuman, WEEKDAY_LABELS, weekdayIndexMondayFirst } from '@/utils/date'

const props = withDefaults(
  defineProps<{
    profile: Profile
    todayIso: string
    sessions?: Session[]
  }>(),
  { sessions: () => [] },
)

// No `fromDate`: the preview answers "what would a whole week look like", not
// "what is left of this one". Computed rather than watched so a keystroke in the
// availability form re-composes immediately, and coerced first because a draft
// mid-wizard still holds empty inputs the planners would read as zero volume.
const plan = computed(() =>
  planWeek(coerceProfileForPreview(props.profile, props.todayIso), props.sessions, props.todayIso),
)

const days = computed(() =>
  plan.value.week.days.map((day) => ({
    date: day.date,
    label: WEEKDAY_LABELS[weekdayIndexMondayFirst(day.date)],
    human: formatHuman(day.date),
    isToday: day.date === props.todayIso,
    strengthDay: day.planned?.kind === 'strength' ? day.planned.programDay : null,
    cardio:
      day.planned?.kind === 'cardio'
        ? describePrescription(day.planned.prescription, props.profile.cardioTrack.zones)
        : null,
  })),
)
</script>

<template>
  <section class="flex flex-col gap-4" aria-label="Your week">
    <header class="flex items-center justify-between gap-3">
      <h2 class="text-base font-semibold text-ink-900">Your week</h2>
      <!-- Hand-rolled: vuiii ships no Badge component. -->
      <span
        v-if="plan.isDeloadWeek"
        class="rounded-full border border-ink-300 px-3 py-1 text-xs font-semibold text-ink-700"
      >
        Deload week
      </span>
    </header>

    <ul class="flex flex-col divide-y divide-ink-200 rounded-lg border border-ink-200">
      <li
        v-for="day in days"
        :key="day.date"
        class="flex min-h-[56px] items-center gap-3 px-3 py-2"
        :class="day.isToday ? 'bg-accent-50' : ''"
      >
        <!-- The three-letter label is for the eye; the full date is what a
             screen reader should read out, so both are in the DOM. -->
        <time
          :datetime="day.date"
          class="w-10 shrink-0 text-sm font-semibold"
          :class="day.isToday ? 'text-accent-600' : 'text-ink-500'"
        >
          <span aria-hidden="true">{{ day.label }}</span>
          <span class="sr-only">{{ day.human }}{{ day.isToday ? ' (today)' : '' }}</span>
        </time>

        <span v-if="day.strengthDay" class="flex min-w-0 items-center gap-2 text-sm text-ink-900">
          <Icon name="dumbbell" class="shrink-0 text-ink-500" aria-hidden="true" />
          <span class="font-medium">Strength {{ day.strengthDay }}</span>
        </span>

        <span v-else-if="day.cardio" class="flex min-w-0 items-center gap-2 text-sm text-ink-900">
          <Icon name="run" class="shrink-0 text-ink-500" aria-hidden="true" />
          <span>{{ day.cardio }}</span>
        </span>

        <span v-else class="text-sm text-ink-500">Rest</span>
      </li>
    </ul>

    <!-- The planner never silently drops volume it cannot place; when minutes
         are left over the user is the only one who can fix it, by giving the
         week another day. -->
    <div
      v-if="plan.cardio.shortfallMinutes > 0"
      class="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm"
      role="status"
    >
      <Icon name="alert" size="large" class="shrink-0 text-accent-600" />
      <p class="text-ink-900">
        {{ plan.cardio.shortfallMinutes }} min of cardio don't fit this week — add a cardio day.
      </p>
    </div>

    <details v-if="plan.week.explanations.length > 0" class="text-sm">
      <summary class="min-h-[48px] cursor-pointer py-3 font-medium text-ink-700">Why these days?</summary>
      <ul class="flex flex-col gap-1 pb-2 text-ink-500">
        <li v-for="(line, index) in plan.week.explanations" :key="index">{{ line }}</li>
      </ul>
    </details>
  </section>
</template>
