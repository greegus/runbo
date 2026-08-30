<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from 'vuiii'

import PrescriptionCard from '@/components/cardio/PrescriptionCard.vue'
import { describePrescription } from '@/training/zones'
import type { PlannedItem, Profile, Session } from '@/types'

/**
 * Today's single card: what to do, and the one tap that starts it.
 *
 * It decides nothing. Every predicate — is this a rest day, may the athlete
 * claim or swap, is a session already running, is the week a deload — arrives
 * as a prop from `@/session/today`, so the composer and the schedule are never
 * called from here.
 */

const props = withDefaults(
  defineProps<{
    item: PlannedItem | null
    isRestDay: boolean
    isDeloadWeek?: boolean
    catchUp?: PlannedItem | null
    canClaim?: boolean
    canSwap?: boolean
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
    catchUp: null,
    canClaim: false,
    canSwap: false,
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
  claim: []
  swap: []
}>()

/**
 * Claiming is offered only on a rest day the week is actually behind on —
 * `catchUp` is already null when the budget is covered, and `canClaim` is the
 * parent's form of the same predicate. Both must agree before the control
 * appears, so a bonus session can never be offered to someone on track.
 */
const showClaim = computed(() => props.isRestDay && props.catchUp !== null && props.canClaim)

/**
 * The day is finished. `composeWeek` deliberately keeps today's `planned` item
 * after a session is logged, so without this the card reads exactly as it did
 * before training and a second tap would create a second document — and a
 * second GZCLP progression from one training day. A session still running wins,
 * because resuming it is the correct next action.
 */
const isDone = computed(() => props.doneSession !== null && props.activeSession === null)

const primaryLabel = computed(() => (props.activeSession ? 'Resume session' : 'Start session'))

/** The catch-up line is the domain's own sentence, never assembled here. */
const catchUpCardio = computed(() =>
  props.catchUp?.kind === 'cardio' ? describePrescription(props.catchUp.prescription, props.zones) : null,
)

function primary(): void {
  if (props.busy || isDone.value) return

  const active = props.activeSession
  if (active) {
    emit('resume', active)
    return
  }

  if (props.item) emit('start')
}

function claim(): void {
  if (props.busy || !showClaim.value) return
  emit('claim')
}

function swap(): void {
  if (props.busy || !props.canSwap) return
  emit('swap')
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

    <div v-if="showClaim || props.canSwap" class="flex flex-col gap-2">
      <template v-if="showClaim">
        <button
          type="button"
          class="min-h-[48px] w-full rounded-xl border border-accent-600 px-4 text-base font-semibold text-accent-700"
          :aria-disabled="props.busy"
          @click="claim()"
        >
          Claim today
        </button>
        <!-- Catching up, never adding: the week owes this session. -->
        <p class="text-sm text-ink-500">
          The week is behind. Claiming today picks up
          <template v-if="props.catchUp?.kind === 'strength'">the {{ props.catchUp.programDay }} strength day</template>
          <template v-else-if="catchUpCardio">{{ catchUpCardio }}</template>
          — it is outstanding work, not an extra session.
        </p>
      </template>

      <template v-if="props.canSwap">
        <button
          type="button"
          class="min-h-[48px] w-full rounded-xl border border-ink-300 px-4 text-base font-semibold text-ink-700"
          :aria-disabled="props.busy"
          @click="swap()"
        >
          Swap today
        </button>
        <p class="text-sm text-ink-500">
          Trains the other track instead. Today's session keeps its place later in the week — nothing is dropped.
        </p>
      </template>
    </div>

    <p v-if="props.error" role="alert" class="text-sm text-accent-700">{{ props.error }}</p>
  </section>
</template>
