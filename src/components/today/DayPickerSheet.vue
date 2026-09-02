<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Icon, IconButton } from 'vuiii'

import BottomSheet from '@/components/BottomSheet.vue'
import type { DayPickerModel, PickerDay } from '@/session/dayPicker'

/**
 * The calendar behind the button in the Today header: every day the athlete may
 * open as "the day" — to backfill one they trained but never logged, or to
 * train a planned day ahead of time.
 *
 * It decides nothing. Which days exist, which of them can be opened, what each
 * one is called and whether it was done, missed or is still to come all arrive
 * in `model` from `buildDayPicker`; this component lays the rows out and emits
 * the tapped date.
 */

const props = defineProps<{
  open: boolean
  /** `null` while the profile or the sessions have not landed. */
  model: DayPickerModel | null
  /** The day the Today screen is currently about. */
  selectedIso: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  select: [dateIso: string]
}>()

const list = ref<HTMLElement>()

function close(): void {
  emit('update:open', false)
}

function pick(day: PickerDay): void {
  if (!day.selectable) return
  emit('select', day.date)
  close()
}

/**
 * Five weeks of rows is a long scroll, and the day the athlete is looking for
 * is almost always near today — so the sheet opens with the current day in
 * view, not with three weeks ago at the top.
 */
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    list.value?.querySelector<HTMLElement>('[aria-current="date"]')?.scrollIntoView({ block: 'center' })
  },
)
</script>

<template>
  <BottomSheet :open="open" labelled-by="day-picker-title" @dismiss="close">
    <header class="flex items-start justify-between gap-3">
      <div>
        <h2 id="day-picker-title" class="text-xl font-bold text-ink-900">Choose a day</h2>
        <p class="text-sm text-ink-500">
          Any training day from the last three weeks up to a week ahead. A missed day offers the work that is still
          outstanding — nothing in the rotation is skipped.
        </p>
      </div>

      <IconButton
        icon="close"
        size="large"
        variant="text"
        class="min-h-[48px] min-w-[48px]"
        aria-label="Close"
        @click="close"
      />
    </header>

    <!-- The sessions arrive asynchronously; an empty calendar before they land
         would be a list of days that were never trained. -->
    <div v-if="!model" role="status" class="flex flex-col gap-2" aria-busy="true">
      <span class="sr-only">Loading your days…</span>
      <div v-for="index in 5" :key="index" class="h-14 animate-pulse rounded-lg bg-ink-100" />
    </div>

    <div v-else ref="list" class="flex flex-col gap-5">
      <section
        v-for="week in model.weeks"
        :key="week.weekStart"
        class="flex flex-col gap-2"
        :aria-labelledby="`day-picker-week-${week.weekStart}`"
      >
        <h3 :id="`day-picker-week-${week.weekStart}`" class="flex items-baseline justify-between gap-3 text-sm">
          <span class="font-semibold text-ink-900">{{ week.label }}</span>
          <span class="text-xs text-ink-500">{{ week.range }}</span>
        </h3>

        <ul class="flex flex-col divide-y divide-ink-200 rounded-lg border border-ink-200">
          <li v-for="day in week.days" :key="day.date">
            <button
              v-if="day.selectable"
              type="button"
              class="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent-600"
              :class="[
                day.isToday ? 'bg-accent-50' : '',
                day.date === selectedIso ? 'ring-2 ring-accent-600 ring-inset' : '',
              ]"
              :aria-current="day.date === selectedIso ? 'date' : undefined"
              @click="pick(day)"
            >
              <!-- The three-letter label is for the eye; the full date is what a
                   screen reader should read out, so both are in the DOM. -->
              <time
                :datetime="day.date"
                class="flex w-10 shrink-0 flex-col text-sm font-semibold leading-tight"
                :class="day.isToday ? 'text-accent-600' : 'text-ink-500'"
              >
                <span aria-hidden="true">{{ day.label }}</span>
                <span aria-hidden="true" class="text-xs font-normal">{{ day.date.slice(8) }}</span>
                <span class="sr-only">{{ day.human }}{{ day.isToday ? ' (today)' : '' }}</span>
              </time>

              <span class="flex min-w-0 flex-1 flex-col text-sm text-ink-900">
                <span class="flex min-w-0 items-center gap-2">
                  <Icon
                    :name="day.kind === 'strength' ? 'dumbbell' : 'run'"
                    class="shrink-0 text-ink-500"
                    aria-hidden="true"
                  />
                  <span :class="day.kind === 'strength' ? 'font-medium' : ''">{{ day.title }}</span>
                </span>
                <span v-if="day.detail" class="pl-7 text-xs text-ink-500">{{ day.detail }}</span>
              </span>

              <!-- Status is a word and a shape, never colour alone. -->
              <span v-if="day.status === 'done'" class="flex shrink-0 items-center">
                <Icon name="check" class="text-accent-600" aria-hidden="true" />
                <span class="sr-only">done</span>
              </span>
              <span v-else-if="day.status === 'missed'" class="shrink-0 text-xs text-ink-500">missed</span>
              <span v-else-if="day.isToday" class="shrink-0 text-xs font-semibold text-accent-600">today</span>
            </button>

            <!-- A rest day with nothing logged has nothing to open. It stays in
                 the list so the week still reads as a week. -->
            <div
              v-else
              class="flex min-h-[56px] items-center gap-3 px-3 py-2"
              :class="day.isToday ? 'bg-accent-50' : ''"
            >
              <time
                :datetime="day.date"
                class="flex w-10 shrink-0 flex-col text-sm font-semibold leading-tight"
                :class="day.isToday ? 'text-accent-600' : 'text-ink-400'"
              >
                <span aria-hidden="true">{{ day.label }}</span>
                <span aria-hidden="true" class="text-xs font-normal">{{ day.date.slice(8) }}</span>
                <span class="sr-only">{{ day.human }}{{ day.isToday ? ' (today)' : '' }}</span>
              </time>
              <span class="text-sm text-ink-400">Rest</span>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </BottomSheet>
</template>
