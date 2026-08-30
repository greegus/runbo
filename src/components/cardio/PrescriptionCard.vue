<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from 'vuiii'

import { describePrescription } from '@/training/zones'
import type { CardioPrescription, Modality, Profile, Session } from '@/types'

const props = withDefaults(
  defineProps<{
    prescription: CardioPrescription
    zones?: Profile['cardioTrack']['zones']
    completed?: boolean
    session?: Session | null
  }>(),
  { zones: undefined, completed: false, session: null },
)

const MODALITY_ICONS: Record<Modality, string> = { run: 'run', bike: 'bike', swim: 'swim' }
const MODALITY_LABELS: Record<Modality, string> = { run: 'Run', bike: 'Bike', swim: 'Swim' }

/**
 * The headline is `describePrescription` verbatim. It already degrades: with no
 * HR and no pace configured it appends the RPE cue, so the line is never just a
 * duration and the zone is always something an athlete can act on.
 */
const headline = computed(() => describePrescription(props.prescription, props.zones))

const structure = computed(() => props.prescription.structure ?? null)

const stats = computed(() => {
  const session = props.session
  if (!session) return []

  return [
    { label: 'Minutes', value: session.minutes, unit: '' },
    { label: 'Distance', value: session.distanceKm, unit: 'km' },
    { label: 'Avg HR', value: session.avgHr, unit: 'bpm' },
    { label: 'RPE', value: session.rpe, unit: '' },
  ].filter((stat): stat is { label: string; value: number; unit: string } => typeof stat.value === 'number')
})
</script>

<template>
  <section class="flex flex-col gap-3 rounded-lg border border-ink-200 bg-white p-4">
    <header class="flex items-center gap-3">
      <Icon :name="MODALITY_ICONS[prescription.modality]" size="large" class="shrink-0 text-accent-600" />
      <div class="min-w-0">
        <p class="text-sm text-ink-500">
          {{ completed ? 'Logged' : 'Today' }}
        </p>
        <h2 class="text-lg font-semibold text-ink-900">
          {{ MODALITY_LABELS[prescription.modality] }} · {{ prescription.kind }}
        </h2>
      </div>
      <Icon v-if="completed" name="check" size="large" class="ml-auto shrink-0 text-accent-600" />
    </header>

    <!-- Read at arm's length mid-session: the whole prescription on one line,
         large, with the numerals aligned. -->
    <p class="text-xl leading-snug font-semibold tabular-nums text-ink-900">{{ headline }}</p>

    <!-- Intervals get their own line as well as their place inside the
         headline: mid-run the three numbers are the only thing being checked. -->
    <dl v-if="structure" class="grid grid-cols-3 gap-2 rounded-lg bg-ink-50 p-3 text-center">
      <div>
        <dt class="text-xs text-ink-500">Reps</dt>
        <dd class="text-2xl font-semibold tabular-nums text-ink-900">{{ structure.reps }}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-500">Work</dt>
        <dd class="text-2xl font-semibold tabular-nums text-ink-900">{{ structure.workMinutes }} min</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-500">Rest</dt>
        <dd class="text-2xl font-semibold tabular-nums text-ink-900">{{ structure.restMinutes }} min</dd>
      </div>
    </dl>

    <template v-if="completed">
      <dl v-if="stats.length" class="grid grid-cols-2 gap-3">
        <div v-for="stat in stats" :key="stat.label" class="rounded-lg bg-ink-50 p-3">
          <dt class="text-xs text-ink-500">{{ stat.label }}</dt>
          <dd class="text-2xl font-semibold tabular-nums text-ink-900">
            {{ stat.value }}<span v-if="stat.unit" class="ml-1 text-sm font-normal text-ink-500">{{ stat.unit }}</span>
          </dd>
        </div>
      </dl>

      <p v-if="session?.notes" class="text-sm whitespace-pre-line text-ink-700">{{ session.notes }}</p>

      <p v-if="session?.source === 'strava'" class="text-sm text-ink-500">Imported from Strava.</p>
    </template>
  </section>
</template>
