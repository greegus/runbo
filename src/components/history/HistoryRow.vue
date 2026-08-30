<script setup lang="ts">
import { computed } from 'vue'
import { Button, Icon } from 'vuiii'

import PrescriptionCard from '@/components/cardio/PrescriptionCard.vue'
import { format } from '@/liftoscript/weight'
import type { HistoryEntry } from '@/session/historyList'
import type { Profile, SetLog } from '@/types'

/**
 * One logged session as a collapsible row.
 *
 * It decides nothing: whether this is the row that may be deleted arrives as
 * `deletable`, because only the full list can answer that and a row comparing
 * itself against its own index would offer the button on a stale page.
 */
const props = withDefaults(
  defineProps<{
    entry: HistoryEntry
    profile: Profile
    expanded?: boolean
    deletable?: boolean
    busy?: boolean
    error?: string | null
  }>(),
  { expanded: false, deletable: false, busy: false, error: null },
)

const emit = defineEmits<{
  'update:expanded': [value: boolean]
  delete: []
}>()

const session = computed(() => props.entry.session)

const exercises = computed(() =>
  (session.value.exercises ?? []).map((exercise) => ({
    key: `${exercise.tier ?? 0}:${exercise.name}`,
    name: exercise.name,
    tier: exercise.tier ?? null,
    sets: exercise.sets,
  })),
)

/** '5 × 100 kg', or the word for a set that was never touched — a blank cell reads as a zero. */
function describeSet(set: SetLog): string {
  if (set.completedReps === null) return `— × ${format(set.weight)}`

  return `${set.completedReps}${set.isAmrap ? '+' : ''} × ${format(set.weight)}`
}

function toggle(): void {
  emit('update:expanded', !props.expanded)
}

/**
 * vuiii's `disabled` is CSS-only — `pointer-events: none` leaves the button
 * tabbable and Enter still fires `@click` — so the guard lives on the handler,
 * never on the styling alone.
 */
function requestDelete(): void {
  if (!props.deletable || props.busy) return
  emit('delete')
}
</script>

<template>
  <li class="rounded-xl border border-ink-200 bg-white">
    <button
      type="button"
      class="flex w-full min-h-[56px] items-center gap-3 p-3 text-left"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <Icon :name="session.kind === 'cardio' ? 'run' : 'dumbbell'" size="large" class="shrink-0 text-accent-600" />

      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-baseline gap-2">
          <span class="font-semibold text-ink-900">{{ entry.title }}</span>
          <!-- Word, not colour: an active session is unfinished, not a variant. -->
          <span
            v-if="entry.isActive"
            class="rounded-full border border-accent-300 bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-800"
          >
            In progress
          </span>
        </span>
        <span class="block text-sm text-ink-500">
          {{ entry.human }}<template v-if="entry.subtitle"> · {{ entry.subtitle }}</template>
        </span>
      </span>

      <Icon :name="expanded ? 'chevron-up' : 'chevron-down'" class="shrink-0 text-ink-400" />
    </button>

    <div v-if="expanded" class="flex flex-col gap-3 border-t border-ink-200 p-3">
      <!-- Cardio: the same card the athlete logged against, in its completed form. -->
      <PrescriptionCard
        v-if="session.kind === 'cardio' && session.prescription"
        :prescription="session.prescription"
        :zones="profile.cardioTrack.zones"
        completed
        :session="session"
      />

      <p v-else-if="session.kind === 'cardio'" class="text-sm text-ink-500">
        Logged without a prescription{{ typeof session.minutes === 'number' ? ` — ${session.minutes} min` : '' }}.
      </p>

      <template v-else>
        <section v-for="exercise in exercises" :key="exercise.key" class="flex flex-col gap-1">
          <h3 class="flex items-baseline gap-2 text-sm font-semibold text-ink-900">
            <span
              v-if="exercise.tier"
              class="rounded border border-ink-200 px-1.5 py-0.5 text-xs font-semibold text-ink-600"
            >
              T{{ exercise.tier }}
            </span>
            {{ exercise.name }}
          </h3>
          <ul role="list" class="flex flex-wrap gap-1.5">
            <li
              v-for="(set, index) in exercise.sets"
              :key="index"
              class="rounded-lg border border-ink-200 bg-ink-50 px-2 py-1 text-sm tabular-nums text-ink-700"
            >
              {{ describeSet(set) }}
            </li>
          </ul>
        </section>

        <p v-if="exercises.length === 0" class="text-sm text-ink-500">No lifts were logged in this session.</p>

        <!-- The engine's own sentences about what the session changed. -->
        <section v-if="session.progressionSummary?.length" class="flex flex-col gap-1">
          <h3 class="text-sm font-semibold tracking-wide text-ink-500 uppercase">What changed</h3>
          <ul role="list" class="flex flex-col gap-1">
            <li v-for="(line, index) in session.progressionSummary" :key="index" class="text-sm text-ink-700">
              {{ line }}
            </li>
          </ul>
        </section>
      </template>

      <!-- No trash icon is registered, and an unregistered name renders nothing
           at all — so the one destructive action in the app is a word. -->
      <div v-if="deletable" class="flex flex-col gap-2">
        <Button
          label="Delete this session"
          color="secondary"
          variant="outlined"
          class="min-h-[48px]"
          :disabled="busy"
          :aria-disabled="busy"
          :loading="busy"
          @click="requestDelete"
        />
        <p class="text-xs text-ink-500">
          {{
            entry.restoresState
              ? 'Deleting it puts your program back to the weights it had before this session.'
              : 'Deleting it changes nothing about your program.'
          }}
        </p>
        <p v-if="error" role="alert" class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm">{{ error }}</p>
      </div>
    </div>
  </li>
</template>
