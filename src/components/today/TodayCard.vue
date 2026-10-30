<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from 'vuiii'

import PrescriptionCard from '@/components/cardio/PrescriptionCard.vue'
import type { PlannedItem, Profile, Session } from '@/types'

/**
 * Today's single card: what to do, and the one tap that starts it.
 *
 * It decides nothing. Every predicate — is this a rest day, is a session
 * already running, is the week a deload — arrives as a prop from `@/session/today`, so the composer and the schedule are never
 * called from here.
 */

const props = withDefaults(
  defineProps<{
    item: PlannedItem | null
    isRestDay: boolean
    isDeloadWeek?: boolean
    /** Pre-built strength weights line, e.g. 'Squat 100 kg - Bench Press 70 kg'. */
    headline?: string | null
    zones?: Profile['cardioTrack']['zones']
    /** An unfinished session for today: the primary action then resumes it. */
    activeSession?: Session | null
    /** Today's finished session: the day is logged and must not be started again. */
    doneSession?: Session | null
    explanation?: string | null
    busy?: boolean
    error?: string | null
  }>(),
  {
    isDeloadWeek: false,
    headline: null,
    zones: undefined,
    activeSession: null,
    doneSession: null,
    explanation: null,
    busy: false,
    error: null,
  },
)

const emit = defineEmits<{
  start: []
  resume: [session: Session]
}>()

/**
 * The day is finished. `composeWeek` deliberately keeps today's `planned` item
 * after a session is logged, so without this the card reads exactly as it did
 * before training and a second tap would create a second document — and a
 * second GZCLP progression from one training day. A session still running wins,
 * because resuming it is the correct next action.
 */
const isDone = computed(() => props.doneSession !== null && props.activeSession === null)

const primaryLabel = computed(() => (props.activeSession ? 'Resume session' : 'Start session'))

function primary(): void {
  if (props.busy || isDone.value) return

  const active = props.activeSession
  if (active) {
    emit('resume', active)
    return
  }

  if (props.item) emit('start')
}
</script>

<template>
  <section class="flex flex-col gap-4 rounded-xl border border-ink-200 bg-white p-4" aria-labelledby="today-card-title">
    <header class="flex flex-wrap items-center gap-2">
      <h2 id="today-card-title" class="text-sm font-medium text-ink-500">Today</h2>

      <!-- A lighter week is planned, not a mistake. -->
      <span
        v-if="props.isDeloadWeek"
        class="rounded-full border border-accent-300 bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-800"
      >
        Deload week
      </span>
    </header>

    <!-- Strength -->
    <div v-if="props.item?.kind === 'strength'" class="flex items-start gap-3">
      <Icon name="dumbbell" size="large" class="mt-1 shrink-0 text-accent-600" aria-hidden="true" />
      <div class="min-w-0">
        <p class="text-2xl font-bold text-ink-900">Strength · {{ props.item.programDay }}</p>
        <p v-if="props.headline" class="text-lg leading-snug font-semibold tabular-nums text-ink-700">
          {{ props.headline }}
        </p>
      </div>
    </div>

    <!-- Cardio -->
    <PrescriptionCard
      v-else-if="props.item?.kind === 'cardio'"
      :prescription="props.item.prescription"
      :zones="props.zones"
    />

    <!-- Rest -->
    <div v-else class="flex items-start gap-3">
      <Icon name="check" size="large" class="mt-1 shrink-0 text-ink-400" aria-hidden="true" />
      <div>
        <p class="text-2xl font-bold text-ink-900">Rest day</p>
        <p class="text-sm text-ink-500">Nothing is planned. Recovery is part of the week.</p>
      </div>
    </div>

    <p v-if="props.explanation" class="text-sm text-ink-500">{{ props.explanation }}</p>

    <p v-if="props.activeSession" role="status" class="text-sm text-ink-700">
      You have a session in progress from earlier today.
    </p>

    <!-- Already trained today: no start affordance at all, or the day gets
         logged twice and the progression advances twice. -->
    <template v-if="isDone">
      <p role="status" class="text-sm text-ink-700">Session done. Today is logged.</p>
      <router-link
        :to="{ name: 'history' }"
        class="min-h-[48px] w-full rounded-xl border border-ink-300 px-4 py-3 text-center text-base font-semibold text-ink-700"
      >
        See it in History
      </router-link>
    </template>

    <!-- The one tap that starts training: full width, accent, thumb-height. -->
    <button
      v-else-if="props.item || props.activeSession"
      type="button"
      class="min-h-[56px] w-full rounded-xl bg-accent-600 px-4 text-lg font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
      :aria-disabled="props.busy"
      @click="primary()"
    >
      {{ props.busy ? 'Starting…' : primaryLabel }}
    </button>

    <p v-if="props.error" role="alert" class="text-sm text-accent-700">{{ props.error }}</p>
  </section>
</template>
