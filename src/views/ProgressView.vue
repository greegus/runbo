<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { Button, Card, FormGroup, Select } from 'vuiii'

import { bodyweightChartInput, cardioChartInput, liftChartInput, shortDate } from '@/charts/adapters'
import { buildBarChart } from '@/charts/barChart'
import { buildLineChart } from '@/charts/lineChart'
import BarChart from '@/components/charts/BarChart.vue'
import LineChart from '@/components/charts/LineChart.vue'
import StatTile from '@/components/StatTile.vue'
import { useBodyweightStore } from '@/stores/bodyweight'
import { useProfileStore } from '@/stores/profile'
import { useSessionsStore } from '@/stores/sessions'
import { liftCatalogue, liftProgress, readinessSplit, recordRows, weeklySeries } from '@/training/progressStats'
import { bodyweightTrend } from '@/training/stats'
import type { BodyweightEntry } from '@/types'
import { addDays, startOfWeekMonday, toIso, WEEK_LENGTH } from '@/utils/date'

/**
 * Progress: five questions, each answered by a pure module, none of them
 * answered with an invented number.
 *
 * The clock is read here and nowhere below — every window is threaded into the
 * pure calls as an ISO day, exactly as TodayView does it.
 *
 * The rule the whole screen is built around: loading is not empty, and empty is
 * not zero. A fresh athlete has no sessions, no records and no weigh-ins, and
 * every block below has to say something true about that rather than draw an
 * axis with nothing on it.
 */
const profileStore = useProfileStore()
const sessionsStore = useSessionsStore()
const bodyweightStore = useBodyweightStore()

const todayIso = ref(toIso(new Date()))

/** Twelve weeks is a mesocycle block plus context — a full phone screen of bars. */
const CARDIO_WEEKS = 12

/**
 * Below this the split is two anecdotes with a divider between them. The screen
 * says so instead of showing tiles that invite a conclusion.
 */
const READINESS_MIN_SESSIONS = 5

const loadError = ref<string | null>(null)

/**
 * The bodyweight listener's third state, held here because the store exposes
 * none: `bind()` empties `entries` on every mount, so an empty list means "the
 * listener has not answered yet" until the array it installed is replaced. A
 * listener error counts as an answer — a skeleton for a reply that is never
 * coming is worse than the empty line.
 */
const bodyweightBaseline = shallowRef<BodyweightEntry[] | null>(null)
const bodyweightAnswered = computed(
  () =>
    bodyweightStore.error !== null ||
    (bodyweightBaseline.value !== null && bodyweightStore.entries !== bodyweightBaseline.value),
)

const profile = computed(() => profileStore.profile)
const sessions = computed(() => sessionsStore.allSessions)
const units = computed(() => profile.value?.settings.units ?? 'kg')

function load(force: boolean): void {
  loadError.value = null
  sessionsStore.loadAllHistory(force ? { force: true } : undefined).catch((error: unknown) => {
    console.error('[progress] loading history failed', error)
    loadError.value = 'Your history could not be loaded. Check your connection and try again.'
  })
}

/**
 * A failure is its own state, not a skeleton that never resolves: the store
 * leaves `isAllLoaded` false when the paging rejects, so without this the screen
 * would keep asserting `aria-busy` while nothing is loading, and the only way to
 * retry would be to leave the tab and come back.
 */
function retryLoad(): void {
  if (sessionsStore.isLoadingAll) return
  load(true)
}

/**
 * Both the weights and the whole history are bound here, keyed on the UID and
 * not on either list being empty: a second account signing in without a reload
 * would otherwise read the first account's rows.
 */
watch(
  () => profileStore.profile?.id,
  (uid) => {
    if (!uid) {
      bodyweightStore.reset()
      bodyweightBaseline.value = null
      return
    }

    bodyweightStore.bind(uid)
    // The array `bind` just installed, before the listener has answered. The
    // store has no `isLoaded`, and `bind` empties `entries` synchronously, so
    // identity is what separates "no weigh-ins" from "not asked yet" here.
    bodyweightBaseline.value = bodyweightStore.entries
    load(false)
  },
  { immediate: true },
)

onMounted(() => {
  if (!profileStore.profile) return

  // A session finished since the last exhaustive page would be missing from
  // every chart here. The live listener is the only thing that knows about it,
  // so ask it — re-paging the collection on every visit to this tab would undo
  // the whole point of sharing `loadAllHistory` with the export.
  const known = new Set(sessions.value.map((session) => session.id))
  const stale = sessionsStore.isAllLoaded && sessionsStore.weekSessions.some((session) => !known.has(session.id))

  if (stale) load(true)
})

const isLoading = computed(() => !profile.value || (!sessionsStore.isAllLoaded && loadError.value === null))
const hasSessions = computed(() => sessions.value.length > 0)

// --- Per-lift -------------------------------------------------------------

const catalogue = computed(() => (profile.value ? liftCatalogue(profile.value, sessions.value) : []))
const hasLiftData = computed(() => catalogue.value.some((choice) => choice.sessionCount > 0))

const selectedLift = ref<string | null>(null)

// The selection follows the catalogue rather than being seeded once: the first
// page of history arriving after mount would otherwise leave the picker on a
// lift that no longer exists, or on nothing at all.
watch(
  catalogue,
  (choices) => {
    if (selectedLift.value && choices.some((choice) => choice.key === selectedLift.value)) return
    selectedLift.value = choices[0]?.key ?? null
  },
  { immediate: true },
)

const liftLabel = computed(() => catalogue.value.find((choice) => choice.key === selectedLift.value)?.label ?? 'Lift')

const liftLayout = computed(() =>
  buildLineChart(
    liftChartInput(
      selectedLift.value ? liftProgress(sessions.value, selectedLift.value, units.value) : [],
      units.value,
    ),
  ),
)

// --- Weekly cardio --------------------------------------------------------

const weeks = computed(() =>
  profile.value
    ? weeklySeries(
        profile.value,
        sessions.value,
        addDays(startOfWeekMonday(todayIso.value), -WEEK_LENGTH * (CARDIO_WEEKS - 1)),
        CARDIO_WEEKS,
      )
    : [],
)

// Twelve bars of zero say "you trained nothing" with the authority of a chart.
// One sentence says the same thing without the ceremony.
const hasCardio = computed(() => weeks.value.some((week) => week.doneMinutes > 0))
const cardioLayout = computed(() => buildBarChart(cardioChartInput(weeks.value)))

// --- Records --------------------------------------------------------------

const records = computed(() => recordRows(sessions.value, units.value))

// --- Bodyweight -----------------------------------------------------------

const bodyweightPoints = computed(() => bodyweightTrend(bodyweightStore.entries))
const bodyweightLayout = computed(() => buildLineChart(bodyweightChartInput(bodyweightPoints.value, units.value)))

// --- Readiness ------------------------------------------------------------

const readiness = computed(() => (profile.value ? readinessSplit(profile.value, sessions.value) : null))
const hasReadiness = computed(() => (readiness.value?.scoredSessions ?? 0) >= READINESS_MIN_SESSIONS)

function tonnageValue(value: { value: number } | null): string {
  // StatTile renders an em dash for anything non-finite, and a real zero has to
  // arrive as a string to survive that.
  return value === null ? '' : String(value.value)
}
</script>

<template>
  <section class="mx-auto flex max-w-lg flex-col gap-4 p-4">
    <h1 class="text-2xl font-bold">Progress</h1>

    <!-- A failure is not a slow load: the skeleton stands down and the athlete
         gets something to press. -->
    <div
      v-if="loadError"
      role="alert"
      class="flex flex-col gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm"
    >
      <p>{{ loadError }}</p>
      <Button
        label="Try again"
        variant="outlined"
        class="min-h-[48px]"
        :loading="sessionsStore.isLoadingAll"
        :disabled="sessionsStore.isLoadingAll"
        :aria-disabled="sessionsStore.isLoadingAll"
        @click="retryLoad()"
      />
    </div>

    <!-- Loading is its own state. An empty `allSessions` before the first page
         resolves means "not answered yet", never "nothing there". -->
    <div v-if="isLoading" role="status" aria-busy="true" class="flex flex-col gap-4">
      <span class="sr-only">Loading your history…</span>
      <div class="h-[180px] animate-pulse rounded-lg bg-ink-100" />
      <div class="h-[180px] animate-pulse rounded-lg bg-ink-100" />
      <div class="h-24 animate-pulse rounded-lg bg-ink-100" />
    </div>

    <!-- Nothing logged at all: no frames, no axes, one sentence and a way out. -->
    <Card v-else-if="!hasSessions && loadError === null">
      <p class="text-sm text-ink-600">
        Nothing to chart yet. Log a session and your weights, cardio minutes and records start showing up here.
      </p>
      <Button :to="{ name: 'today' }" size="large" class="mt-3 min-h-[48px]">Go to Today</Button>
    </Card>

    <!-- Nothing loaded AND the load failed renders neither state: the alert
         above has already said what happened, and "nothing to chart yet" would
         be a claim about data we never read. -->
    <template v-else-if="hasSessions">
      <!-- Per-lift ---------------------------------------------------------->
      <section class="flex flex-col gap-3">
        <h2 class="text-lg font-semibold">Lifts</h2>

        <p v-if="!hasLiftData" class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-500">
          No lifts logged yet.
        </p>

        <template v-else>
          <FormGroup label="Lift">
            <template #default="{ id }">
              <Select
                :id="id"
                v-model="selectedLift"
                :options="catalogue"
                option-label="label"
                option-value="key"
                size="large"
                class="min-h-[48px]"
              />
            </template>
          </FormGroup>

          <LineChart
            chart-id="lift"
            :title="liftLabel"
            subtitle="Working weight and estimated 1RM per training day"
            :layout="liftLayout"
          />
        </template>
      </section>

      <!-- Weekly cardio ----------------------------------------------------->
      <section class="flex flex-col gap-3">
        <h2 class="text-lg font-semibold">Cardio</h2>

        <p v-if="!hasCardio" class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-500">
          No cardio logged in the last 12 weeks.
        </p>

        <BarChart
          v-else
          chart-id="cardio"
          title="Weekly cardio minutes"
          subtitle="Bars are minutes logged; the dashed line is what the week asked for."
          :layout="cardioLayout"
        />
      </section>

      <!-- Records ----------------------------------------------------------->
      <section class="flex flex-col gap-3">
        <h2 class="text-lg font-semibold">Records</h2>

        <p v-if="records.length === 0" class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-500">
          No records yet — your first completed set sets all three.
        </p>

        <!-- A table, not a chart: four ordered columns say more about three
             bests per lift than any picture of the same numbers. -->
        <div v-else class="overflow-x-auto rounded-lg border border-ink-200">
          <table class="w-full text-left text-sm">
            <caption class="sr-only">
              Personal records, most recent first
            </caption>
            <thead>
              <tr class="bg-ink-50 text-xs font-medium text-ink-500">
                <th scope="col" class="px-3 py-2">Lift</th>
                <th scope="col" class="px-3 py-2">Record</th>
                <th scope="col" class="px-3 py-2">Value</th>
                <th scope="col" class="px-3 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in records" :key="row.id" class="border-t border-ink-100">
                <td class="px-3 py-2 text-ink-900">{{ row.lift }}</td>
                <td class="px-3 py-2 text-ink-500">{{ row.label }}</td>
                <td class="px-3 py-2 font-semibold tabular-nums text-ink-900">{{ row.value }}</td>
                <td class="px-3 py-2 tabular-nums text-ink-500">{{ shortDate(row.date) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Bodyweight -------------------------------------------------------->
      <section class="flex flex-col gap-3">
        <h2 class="text-lg font-semibold">Bodyweight</h2>

        <!-- The listener has not answered yet: an empty list is not "no
             weigh-ins", and this block is re-entered on every visit. -->
        <div
          v-if="!bodyweightAnswered"
          role="status"
          aria-busy="true"
          class="h-[180px] animate-pulse rounded-lg bg-ink-100"
        >
          <span class="sr-only">Loading your weigh-ins…</span>
        </div>

        <p
          v-else-if="bodyweightStore.error"
          role="alert"
          class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm"
        >
          Your weigh-ins could not be loaded.
        </p>

        <div
          v-else-if="bodyweightPoints.length === 0"
          class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-500"
        >
          <p>No weigh-ins yet.</p>
          <router-link
            :to="{ name: 'today' }"
            class="mt-1 inline-flex min-h-[48px] items-center font-medium text-accent-600 underline"
          >
            Add one on Today
          </router-link>
        </div>

        <LineChart
          v-else
          chart-id="bodyweight"
          title="Bodyweight"
          subtitle="Every weigh-in, with the 7-day rolling average through it"
          :layout="bodyweightLayout"
        />
      </section>

      <!-- Readiness vs performance ------------------------------------------>
      <section v-if="readiness" class="flex flex-col gap-3">
        <h2 class="text-lg font-semibold">Readiness and performance</h2>

        <!-- DECISION: two means and a count, never a scatter. Readiness is
             optional and often skipped, so at this many sessions a cloud of
             points would invite a correlation claim the data cannot support. -->
        <p v-if="!hasReadiness" class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-500">
          Readiness needs a few more sessions before it says anything.
          <template v-if="readiness.scoredSessions > 0">
            {{ readiness.scoredSessions }} of your sessions carry an answer so far.
          </template>
        </p>

        <template v-else>
          <p class="text-sm text-ink-500">
            Average weight moved per strength session, split by how you felt beforehand — from
            {{ readiness.scoredSessions }} sessions that carry an answer.
          </p>

          <div class="grid grid-cols-2 gap-3">
            <StatTile
              label="Feeling good"
              :value="tonnageValue(readiness.highMeanTonnage)"
              :unit="units"
              hint="Mean tonnage"
              emphasis
            />
            <StatTile
              label="Feeling ok or poor"
              :value="tonnageValue(readiness.lowMeanTonnage)"
              :unit="units"
              hint="Mean tonnage"
            />
          </div>

          <p class="text-xs text-ink-500">
            This is a description of what you logged, not a prediction. Readiness never changes a prescription.
          </p>
        </template>
      </section>
    </template>
  </section>
</template>
