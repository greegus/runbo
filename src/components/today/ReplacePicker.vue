<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from 'vuiii'

import type { ReplacementOption } from '@/training/composer'
import { describePrescription, MODALITY_LABELS } from '@/training/zones'
import type { PlannedItem, Profile } from '@/types'
import { WEEKDAY_LABELS, weekdayIndexMondayFirst } from '@/utils/date'

/**
 * "Train something else today": the week's other workouts, one tap each, and
 * the swap to the other track when it offers something they do not.
 *
 * Like `TodayCard`, it decides nothing. The list arrives from
 * `replacementOptions` already filtered — no strength day past the one the
 * rotation is on, nothing that is already logged, no bonus work on a week that
 * is on track — and the pick goes straight back up; what the rest of the week
 * does about it is the composer's business.
 */

const props = withDefaults(
  defineProps<{
    options: ReplacementOption[]
    /** Today on the other track — offered only when no option already holds it. */
    swap?: PlannedItem | null
    zones?: Profile['cardioTrack']['zones']
    busy?: boolean
  }>(),
  { swap: null, zones: undefined, busy: false },
)

const emit = defineEmits<{
  pick: [option: ReplacementOption]
  swap: []
}>()

const open = ref(false)

function describeItem(item: PlannedItem) {
  return {
    icon: item.kind === 'strength' ? 'dumbbell' : item.prescription.modality,
    title:
      item.kind === 'strength'
        ? `Strength · ${item.programDay}`
        : `${MODALITY_LABELS[item.prescription.modality]} · ${item.prescription.kind}`,
    detail: item.kind === 'cardio' ? describePrescription(item.prescription, props.zones) : null,
  }
}

const rows = computed(() => {
  const picks = props.options.map((option) => ({
    ...describeItem(option.item),
    key: `${option.from}-${JSON.stringify(option.item)}`,
    // Where it comes from is what tells the athlete what the pick costs.
    origin:
      option.from !== null
        ? `Moves here from ${WEEKDAY_LABELS[weekdayIndexMondayFirst(option.from)]}`
        : option.item.kind === 'cardio'
          ? 'Missed earlier this week'
          : 'Still owed this week',
    choose: () => emit('pick', option),
  }))

  if (!props.swap) return picks

  return [
    ...picks,
    {
      ...describeItem(props.swap),
      key: 'swap',
      origin: "Swaps tracks — today's session moves later in the week",
      choose: () => emit('swap'),
    },
  ]
})

function choose(row: { choose: () => void }): void {
  if (props.busy) return
  open.value = false
  row.choose()
}
</script>

<template>
  <section v-if="rows.length > 0" class="flex flex-col rounded-xl border border-ink-300 p-1">
    <button
      type="button"
      class="flex min-h-[48px] w-full items-center justify-between rounded-lg px-3 text-base font-semibold text-ink-700"
      :aria-expanded="open"
      aria-controls="replace-picker-list"
      @click="open = !open"
    >
      Train something else today
      <Icon
        name="chevron-down"
        class="ReplacePicker__chevron shrink-0 text-ink-500"
        :class="{ 'rotate-180': open }"
        aria-hidden="true"
      />
    </button>

    <!-- Stays mounted so the height can animate; `inert` keeps the closed list out of reach. -->
    <div
      id="replace-picker-list"
      class="ReplacePicker__panel"
      :class="{ 'ReplacePicker__panel--open': open }"
      :inert="!open"
    >
      <div class="flex min-h-0 flex-col gap-2 overflow-hidden px-2">
        <p class="px-1 text-sm text-ink-500">
          Pick a workout from later this week, or one the week still owes. A later one moves to today — it is not added
          on top.
        </p>

        <ul class="flex flex-col gap-2 pb-2">
          <li v-for="row in rows" :key="row.key">
            <button
              type="button"
              class="flex min-h-[56px] w-full items-start gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 text-left"
              :aria-disabled="props.busy"
              @click="choose(row)"
            >
              <Icon :name="row.icon" class="mt-0.5 shrink-0 text-accent-600" aria-hidden="true" />
              <span class="flex min-w-0 flex-col">
                <span class="text-base font-semibold text-ink-900">{{ row.title }}</span>
                <span v-if="row.detail" class="text-sm tabular-nums text-ink-700">{{ row.detail }}</span>
                <span class="text-sm text-ink-500">{{ row.origin }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 0fr → 1fr animates to the content's own height, whatever the list holds. */
.ReplacePicker__panel {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows 250ms ease-out,
    opacity 200ms ease-out;
}

.ReplacePicker__panel--open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.ReplacePicker__chevron {
  transition: transform 250ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .ReplacePicker__panel,
  .ReplacePicker__chevron {
    transition: none;
  }
}
</style>
