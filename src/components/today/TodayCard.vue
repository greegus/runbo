<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from 'vuiii'

import Notice from '@/components/Notice.vue'
import { describeTargets, prescriptionTitle } from '@/training/zones'
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
    /** Today is the week's suggested sauna day. */
    saunaSuggested?: boolean
    /** The sauna claimed today — a note on the day, whatever the day holds. */
    saunaClaimed?: Session | null
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
    saunaSuggested: false,
    saunaClaimed: null,
    busy: false,
    error: null,
  },
)

const emit = defineEmits<{
  start: []
  resume: [session: Session]
  'claim-sauna': []
  'unclaim-sauna': [session: Session]
}>()

/**
 * The day is finished. `composeWeek` deliberately keeps today's `planned` item
 * after a session is logged, so without this the card reads exactly as it did
 * before training and a second tap would create a second document — and a
 * second GZCLP progression from one training day. A session still running wins,
 * because resuming it is the correct next action.
 */
const isDone = computed(() => props.doneSession !== null && props.activeSession === null)

/** The targets under the title, as the session screen shows them. */
const cardioLine = computed(() =>
  props.item?.kind === 'cardio' ? describeTargets(props.item.prescription, props.zones) : null,
)

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
  <section class="flex flex-col gap-4 rounded-xl border border-ink-200 bg-white p-4" aria-label="Today's plan">
    <!-- The page title already says "Today"; the header only carries the deload
         badge. A lighter week is planned, not a mistake. -->
    <header v-if="props.isDeloadWeek" class="flex flex-wrap items-center gap-2">
      <span
        class="rounded-full border border-accent-300 bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-800"
      >
        Deload week
      </span>
    </header>

    <!-- Strength -->
    <div v-if="props.item?.kind === 'strength'" class="flex items-start gap-3">
      <Icon name="dumbbell" size="large" class="TodayCard__icon shrink-0 text-accent-600" aria-hidden="true" />
      <div class="min-w-0">
        <p class="text-2xl font-bold text-ink-900">Strength · {{ props.item.programDay }}</p>
        <p v-if="props.headline" class="text-lg leading-snug font-semibold tabular-nums text-ink-700">
          {{ props.headline }}
        </p>
      </div>
    </div>

    <!-- Cardio. Laid out like strength rather than as a PrescriptionCard: that
         card brings its own frame, which nested a box inside this one. The
         intervals breakdown it adds is for mid-session, and the line below
         already carries it. -->
    <div v-else-if="props.item?.kind === 'cardio'" class="flex items-start gap-3">
      <Icon
        :name="props.item.prescription.modality"
        size="large"
        class="TodayCard__icon shrink-0 text-accent-600"
        aria-hidden="true"
      />
      <div class="min-w-0">
        <p class="text-2xl font-bold text-ink-900">
          {{ prescriptionTitle(props.item.prescription) }}
        </p>
        <p class="text-lg leading-snug font-semibold tabular-nums text-ink-700">{{ cardioLine }}</p>
      </div>
    </div>

    <!-- Rest -->
    <div v-else class="flex items-start gap-3">
      <Icon name="meditation" size="large" class="TodayCard__icon shrink-0 text-accent-600" aria-hidden="true" />
      <div>
        <p class="text-2xl font-bold text-ink-900">Rest day</p>
        <p class="text-sm text-ink-500">Nothing is planned. Recovery is part of the week.</p>
      </div>
    </div>

    <!-- A note under the day, not a workout: claimed on a training day it
         leaves the plan above exactly as it was. Undo is right here, because a
         claim is one tap and a mis-tap should be one tap to take back. Before
         a claim, the week's one suggestion shows here on its rest day. -->
    <div
      v-if="props.saunaClaimed || (props.saunaSuggested && !props.item)"
      class="flex min-h-[48px] items-center gap-2 rounded-lg bg-ink-50 py-1 pr-1 pl-3 text-sm text-ink-700"
      :role="props.saunaClaimed ? 'status' : undefined"
    >
      <Icon name="sauna" class="shrink-0 text-accent-600" aria-hidden="true" />

      <template v-if="props.saunaClaimed">
        <span class="min-w-0 flex-1">
          <span class="font-semibold text-ink-900">Sauna claimed</span>
          <span v-if="props.saunaClaimed.minutes" class="tabular-nums"> · {{ props.saunaClaimed.minutes }} min</span>
        </span>
        <Icon name="check" class="shrink-0 text-success-600" aria-hidden="true" />
        <button
          type="button"
          class="min-h-[40px] shrink-0 rounded-lg px-2 font-medium text-ink-500 focus-visible:outline-2 focus-visible:outline-accent-600"
          :disabled="props.busy"
          @click="emit('unclaim-sauna', props.saunaClaimed)"
        >
          Undo
        </button>
      </template>

      <template v-else>
        <span class="min-w-0 flex-1 py-2">
          <span class="font-semibold text-ink-900">Sauna suggested.</span> 15–20 min, easy heat, drink water.
        </span>
        <button
          type="button"
          class="min-h-[40px] shrink-0 rounded-lg border border-accent-600 px-3 font-semibold text-accent-700 focus-visible:outline-2 focus-visible:outline-accent-600"
          :disabled="props.busy"
          @click="emit('claim-sauna')"
        >
          Claim
        </button>
      </template>
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

    <Notice v-if="props.error" tone="error">{{ props.error }}</Notice>
  </section>
</template>

<style scoped>
/*
 * Sized so the title starts where the workout names in ReplacePicker do, the
 * panel right below: there the name sits 60 px in (border 1 + p-1 4 + px-2 8 +
 * row border 1 + px-4 16 + an 18 px icon + gap-3 12), here 1 + p-4 16 + gap-3
 * 12 leave 31 px for the icon. Its height also matches the text-2xl title line.
 */
.TodayCard__icon {
  --vuiii-icon-size--large: 1.9375rem;
}
</style>
