<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { IconButton } from 'vuiii'

import StatTile from '@/components/StatTile.vue'
import WeekPreview from '@/components/WeekPreview.vue'
import { liveWeekWindow, stepWeek, weekOffsetLabel, weekRangeLabel } from '@/session/weekGrid'
import { useProfileStore } from '@/stores/profile'
import { useSessionsStore } from '@/stores/sessions'
import { planWeek } from '@/training/schedule'
import { currentStreak, weeklyRollup } from '@/training/stats'
import { inWeek, startOfWeekMonday, toIso } from '@/utils/date'

/**
 * The week, explained.
 *
 * TodayView answers "what do I do now"; this screen answers "what does the week
 * ask of me, what have I done, and why does it look like this". Every rule comes
 * from `buildWeekGrid` (through `WeekPreview`), `weeklyRollup` and the composer's
 * own explanation lines — this file owns the clock, the anchor and nothing else.
 */
const profileStore = useProfileStore()
const sessionsStore = useSessionsStore()

/**
 * The clock is read here and nowhere else below, and threaded into every pure
 * call as `todayIso`. A phone app is left open across midnight as a matter of
 * course, and a week strip anchored on yesterday would mark today as missed.
 */
const todayIso = ref(toIso(new Date()))
const anchorIso = ref(startOfWeekMonday(todayIso.value))

/**
 * DECISION: navigation is capped to the weeks `sessionsStore.weekSessions`
 * actually covers (−3 … +1). Composing a week the loaded session list cannot
 * describe would render a confident, wrong "0 done" for a week that may well
 * have been trained; history further back is the History tab's job.
 */
const navWindow = computed(() => liveWeekWindow(todayIso.value))
const prevWeek = computed(() => stepWeek(anchorIso.value, -1, navWindow.value))
const nextWeek = computed(() => stepWeek(anchorIso.value, 1, navWindow.value))

const isCurrentWeek = computed(() => anchorIso.value === startOfWeekMonday(todayIso.value))
/** The window runs −3 … +1, so "not this week" is not the same as "in the past". */
const isFutureWeek = computed(() => anchorIso.value > startOfWeekMonday(todayIso.value))

const profile = computed(() => profileStore.profile)
const isReady = computed(() => profile.value !== null && sessionsStore.isLoaded)

/**
 * The tiles are composed WITHOUT the frontier, the day grid WITH it. Two
 * composes of the same week is the intended shape, exactly as in `today.ts`: the
 * trimmed week drops every past day that was never logged — right for "what do I
 * do now", wrong for "what did this week ask of me", where by Sunday it reads
 * "0 of 0 planned" for a week with three strength days in it.
 */
const wholeWeek = computed(() =>
  profile.value ? planWeek(profile.value, sessionsStore.weekSessions, anchorIso.value).week : null,
)

const rollup = computed(() =>
  profile.value && wholeWeek.value
    ? weeklyRollup(profile.value, sessionsStore.weekSessions, anchorIso.value, wholeWeek.value)
    : null,
)

const streak = computed(() =>
  profile.value ? currentStreak(profile.value, sessionsStore.weekSessions, todayIso.value) : 0,
)

const tonnage = computed(() => {
  const value = rollup.value?.tonnage
  if (!value) return null

  return { value: String(Math.round(value.value)), unit: value.unit }
})

/** Nothing logged in the week on screen — a plan, not a list of failures. */
const nothingLogged = computed(
  () => sessionsStore.weekSessions.filter((session) => inWeek(session.date, anchorIso.value)).length === 0,
)

/**
 * Three tenses, not two: next week has not happened, so saying nothing "was"
 * logged there states a failure the athlete has not had.
 */
const nothingLoggedLine = computed(() => {
  if (isCurrentWeek.value) return 'Nothing logged this week yet. The days below are what the plan asks for.'
  if (isFutureWeek.value) return 'Nothing is logged yet — the days below are what the plan asks for.'

  return 'Nothing was logged that week. The days below are what the plan asked for.'
})

const weekHeading = computed(() => weekOffsetLabel(anchorIso.value, todayIso.value))
const weekRange = computed(() => weekRangeLabel(anchorIso.value))

// vuiii's `disabled` is CSS-only (`pointer-events: none`), so the element stays
// tabbable and Enter still fires `@click` — the clamp is re-checked here too.
function goPrev(): void {
  if (prevWeek.value === null) return
  anchorIso.value = prevWeek.value
}

function goNext(): void {
  if (nextWeek.value === null) return
  anchorIso.value = nextWeek.value
}

function refreshToday(): void {
  const now = toIso(new Date())
  if (now === todayIso.value) return

  const wasCurrent = isCurrentWeek.value
  todayIso.value = now
  // Midnight moved the week under the athlete: follow it only if they were
  // looking at the current week, so a deliberate look back is not stolen.
  if (wasCurrent) anchorIso.value = startOfWeekMonday(now)
}

function onVisible(): void {
  if (document.visibilityState === 'visible') refreshToday()
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', refreshToday)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('focus', refreshToday)
})

// A signed-out account must not leave the previous athlete's week on screen.
watch(
  () => profileStore.profile?.id,
  () => {
    todayIso.value = toIso(new Date())
    anchorIso.value = startOfWeekMonday(todayIso.value)
  },
)
</script>

<template>
  <section class="mx-auto flex max-w-lg flex-col gap-4 p-4">
    <h1 class="text-2xl font-bold text-ink-900">Plan</h1>

    <!-- An empty session list before the first snapshot is not an empty week:
         the skeleton stays until `isLoaded` answers. -->
    <div v-if="!isReady" class="flex flex-col gap-4" role="status" aria-busy="true">
      <span class="sr-only">Loading your week…</span>
      <div class="h-80 animate-pulse rounded-lg bg-ink-100"></div>
      <div class="grid grid-cols-2 gap-3">
        <div v-for="index in 4" :key="index" class="h-24 animate-pulse rounded-lg bg-ink-100"></div>
      </div>
    </div>

    <template v-else-if="profile && rollup">
      <header class="flex items-center gap-2">
        <IconButton
          icon="chevron-left"
          variant="outlined"
          size="large"
          class="min-h-[48px] min-w-[48px]"
          :disabled="prevWeek === null"
          :aria-disabled="prevWeek === null"
          title="Previous week"
          @click="goPrev"
        />

        <div class="flex min-w-0 flex-1 flex-col items-center">
          <span class="text-base font-semibold text-ink-900">{{ weekHeading }}</span>
          <span class="text-xs text-ink-500">{{ weekRange }}</span>
        </div>

        <IconButton
          icon="chevron-right"
          variant="outlined"
          size="large"
          class="min-h-[48px] min-w-[48px]"
          :disabled="nextWeek === null"
          :aria-disabled="nextWeek === null"
          title="Next week"
          @click="goNext"
        />
      </header>

      <!-- A disabled control with nothing next to it is a dead end: whatever
           stops the athlete has to say why, and where the answer lives. -->
      <p
        v-if="prevWeek === null"
        role="status"
        class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-700"
      >
        History further back lives in the History tab.
      </p>
      <p
        v-if="nextWeek === null"
        role="status"
        class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-700"
      >
        Next week is as far ahead as the plan goes.
      </p>

      <!-- A fresh athlete has logged nothing; the week is still a plan, not a
           list of failures. -->
      <p v-if="nothingLogged" class="text-sm text-ink-500">{{ nothingLoggedLine }}</p>

      <div class="grid grid-cols-2 gap-3">
        <StatTile
          label="Strength"
          :value="`${rollup.strength.done}/${rollup.strength.planned}`"
          hint="sessions done"
          icon="dumbbell"
        />
        <StatTile
          label="Cardio"
          :value="`${rollup.cardio.doneMinutes}/${rollup.cardio.plannedMinutes}`"
          unit="min"
          hint="minutes done"
          icon="run"
        />
        <StatTile v-if="tonnage" label="Tonnage" :value="tonnage.value" :unit="tonnage.unit" icon="weight" />
        <StatTile label="Streak" :value="String(streak)" hint="sessions in a row" icon="chart" emphasis />
      </div>

      <!-- The grid is the CURRENT week trimmed to the frontier so it agrees with
           NO frontier, on any week including this one. The frontier answers
           "what do I do now" by dropping past days that never happened — and
           this screen answers the other question: what the week asked for and
           what came of it. Trimmed, a Sunday visit showed seven Rest days under
           tiles reading "0/3 sessions" — the same screen contradicting itself.
           A missed day belongs here, shown as planned and not done.

           A FUTURE week is the one exception, and for a different reason: there
           is nothing before today to trim, but behind today's frontier the
           rotation is projected across this week's remaining strength days, so
           next Monday does not repeat the B1 this Wednesday still has to do. -->
      <WeekPreview
        :profile="profile"
        :today-iso="todayIso"
        :sessions="sessionsStore.weekSessions"
        :anchor-iso="anchorIso"
        :from-date="isFutureWeek ? todayIso : null"
        show-status
        link-sessions
      />
    </template>
  </section>
</template>
