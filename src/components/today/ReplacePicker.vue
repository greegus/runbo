<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from 'vuiii'

import type { ReplacementOption } from '@/training/composer'
import { describePrescription, MODALITY_LABELS } from '@/training/zones'
import type { Profile } from '@/types'
import { WEEKDAY_LABELS, weekdayIndexMondayFirst } from '@/utils/date'

/**
 * "Train something else today": the week's other workouts, one tap each.
 *
 * Like `TodayCard`, it decides nothing. The list arrives from
 * `replacementOptions` already filtered — no strength day past the one the
 * rotation is on, nothing that is already logged — and the pick goes straight
 * back up; what the rest of the week does about it is the composer's business.
 */

const props = withDefaults(
  defineProps<{
    options: ReplacementOption[]
    zones?: Profile['cardioTrack']['zones']
    busy?: boolean
  }>(),
  { zones: undefined, busy: false },
)

const emit = defineEmits<{
  pick: [option: ReplacementOption]
}>()

const open = ref(false)

const rows = computed(() =>
  props.options.map((option) => {
    const item = option.item

    return {
      option,
      icon: item.kind === 'strength' ? 'dumbbell' : item.prescription.modality,
      title:
        item.kind === 'strength'
          ? `Strength · ${item.programDay}`
          : `${MODALITY_LABELS[item.prescription.modality]} · ${item.prescription.kind}`,
      detail: item.kind === 'cardio' ? describePrescription(item.prescription, props.zones) : null,
      // Where it comes from is what tells the athlete what the swap costs.
      origin:
        option.from !== null
          ? `Planned for ${WEEKDAY_LABELS[weekdayIndexMondayFirst(option.from)]}`
          : item.kind === 'cardio'
            ? 'Missed earlier this week'
            : 'Next in your rotation',
    }
  }),
)

function pick(option: ReplacementOption): void {
  if (props.busy) return
  open.value = false
  emit('pick', option)
}
</script>

<template>
  <section v-if="props.options.length > 0" class="flex flex-col gap-2">
    <button
      type="button"
      class="flex min-h-[48px] w-full items-center justify-between rounded-xl border border-ink-300 px-4 text-base font-semibold text-ink-700"
      :aria-expanded="open"
      aria-controls="replace-picker-list"
      @click="open = !open"
    >
      Train something else today
      <Icon :name="open ? 'chevron-up' : 'chevron-down'" class="shrink-0 text-ink-500" aria-hidden="true" />
    </button>

    <div v-if="open" id="replace-picker-list" class="flex flex-col gap-2">
      <p class="text-sm text-ink-500">
        Pick a workout from later this week, or one you missed. It moves to today — it is not added on top.
      </p>

      <ul class="flex flex-col gap-2">
        <li v-for="row in rows" :key="`${row.option.from}-${row.title}-${row.detail}`">
          <button
            type="button"
            class="flex min-h-[56px] w-full items-start gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 text-left"
            :aria-disabled="props.busy"
            @click="pick(row.option)"
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
  </section>
</template>
