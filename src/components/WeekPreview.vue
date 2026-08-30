<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { Icon } from 'vuiii'

import { buildWeekGrid, type WeekGridDay } from '@/session/weekGrid'
import type { Profile, Session } from '@/types'

const props = withDefaults(
  defineProps<{
    profile: Profile
    todayIso: string
    sessions?: Session[]
    /** Frontier handed to `planWeek`; `null` composes the whole week. */
    fromDate?: string | null
    /** The week to compose; `null` is the week `todayIso` falls in. */
    anchorIso?: string | null
    /** Render what was logged: done marks, missed days, per-day detail. */
    showStatus?: boolean
    /** Rows carrying a session become links to it. */
    linkSessions?: boolean
  }>(),
  { sessions: () => [], fromDate: null, anchorIso: null, showStatus: false, linkSessions: false },
)

// One week model for the whole app: PlanView and the onboarding preview render
// the same `buildWeekGrid` output, so the two strips cannot drift. Computed
// rather than watched so a keystroke in the availability form re-composes
// immediately; `buildWeekGrid` coerces the half-filled wizard draft itself.
//
// Defaults reproduce the onboarding preview exactly: no frontier, the week
// today falls in — "what would a whole week look like", not "what is left of
// this one".
const model = computed(() =>
  buildWeekGrid(props.profile, props.sessions, props.anchorIso ?? props.todayIso, props.todayIso, {
    fromDate: props.fromDate,
  }),
)

/** A row links out only when it has a session to link to — a rest day is inert. */
function linkFor(day: WeekGridDay): RouteLocationRaw | null {
  if (!props.linkSessions || !day.sessionId || day.kind === null) return null

  return {
    name: day.kind === 'strength' ? 'strength-session' : 'cardio-session',
    params: { id: day.sessionId },
  }
}

// The link is resolved once per row rather than in the template: `:is` and `:to`
// both read it, and a fresh object per read would re-render every keystroke.
const rows = computed(() => model.value.days.map((day) => ({ ...day, to: linkFor(day) })))
</script>

<template>
  <section class="flex flex-col gap-4" aria-label="Your week">
    <header class="flex items-center justify-between gap-3">
      <h2 class="text-base font-semibold text-ink-900">Your week</h2>
      <!-- Hand-rolled: vuiii ships no Badge component. -->
      <span
        v-if="model.isDeloadWeek"
        class="rounded-full border border-ink-300 px-3 py-1 text-xs font-semibold text-ink-700"
      >
        Deload week
      </span>
    </header>

    <ul class="flex flex-col divide-y divide-ink-200 rounded-lg border border-ink-200">
      <li v-for="day in rows" :key="day.date">
        <component
          :is="day.to ? 'router-link' : 'div'"
          :to="day.to ?? undefined"
          class="flex min-h-[56px] items-center gap-3 px-3 py-2"
          :class="[
            day.isToday ? 'bg-accent-50' : '',
            day.to ? 'focus-visible:outline-2 focus-visible:outline-accent-600' : '',
          ]"
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

          <span v-if="day.kind === 'strength'" class="flex min-w-0 flex-col text-sm text-ink-900">
            <span class="flex min-w-0 items-center gap-2">
              <Icon name="dumbbell" class="shrink-0 text-ink-500" aria-hidden="true" />
              <span class="font-medium">{{ day.title }}</span>
            </span>
            <span v-if="props.showStatus && day.detail" class="pl-7 text-xs text-ink-500">{{ day.detail }}</span>
          </span>

          <span v-else-if="day.kind === 'cardio'" class="flex min-w-0 flex-col text-sm text-ink-900">
            <span class="flex min-w-0 items-center gap-2">
              <Icon name="run" class="shrink-0 text-ink-500" aria-hidden="true" />
              <span>{{ day.title }}</span>
            </span>
            <span v-if="props.showStatus && day.detail" class="pl-7 text-xs text-ink-500">{{ day.detail }}</span>
          </span>

          <span v-else class="text-sm text-ink-500">Rest</span>

          <!-- Status is a word and a shape, never colour alone: the app is used
               in a bright gym at arm's length, and "done" must survive that. -->
          <span v-if="props.showStatus && day.status === 'done'" class="ml-auto flex shrink-0 items-center">
            <Icon name="check" class="text-accent-600" aria-hidden="true" />
            <span class="sr-only">done</span>
          </span>
          <span v-else-if="props.showStatus && day.status === 'missed'" class="ml-auto shrink-0 text-xs text-ink-500">
            missed
          </span>
          <span v-else-if="day.to" class="ml-auto flex shrink-0 items-center">
            <Icon name="chevron-right" class="text-ink-400" aria-hidden="true" />
          </span>
        </component>
      </li>
    </ul>

    <!-- The planner never silently drops volume it cannot place; when minutes
         are left over the user is the only one who can fix it, by giving the
         week another day. -->
    <div
      v-if="model.shortfallMinutes > 0"
      class="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm"
      role="status"
    >
      <Icon name="alert" size="large" class="shrink-0 text-accent-600" />
      <p class="text-ink-900">{{ model.shortfallMinutes }} min of cardio don't fit this week — add a cardio day.</p>
    </div>

    <details v-if="model.explanations.length > 0" class="text-sm">
      <summary class="min-h-[48px] cursor-pointer py-3 font-medium text-ink-700">Why these days?</summary>
      <ul class="flex flex-col gap-1 pb-2 text-ink-500">
        <li v-for="(line, index) in model.explanations" :key="index">{{ line }}</li>
      </ul>
    </details>
  </section>
</template>
