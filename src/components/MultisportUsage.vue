<script setup lang="ts">
import { computed, ref } from 'vue'
import { IconButton } from 'vuiii'

import { monthOf, type MultisportCard, multisportMonth, shiftMonth } from '@/training/multisport'
import type { Session } from '@/types'
import { parseIso } from '@/utils/date'

/**
 * One month of the Multisport card: how many entries it paid for, and how far
 * that is from paying for itself. The month steps back through history but not
 * past the current one — next month has nothing to count yet.
 */
const props = defineProps<{
  sessions: Session[]
  card: MultisportCard
  todayIso: string
}>()

const currentMonth = computed(() => monthOf(props.todayIso))
const month = ref(monthOf(props.todayIso))

const usage = computed(() => multisportMonth(props.sessions, month.value, props.card))

const monthLabel = computed(() =>
  parseIso(`${month.value}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
)

/** The bar fills towards break-even, and stays full once the card has paid. */
const progress = computed(() =>
  usage.value.breakEvenEntries > 0 ? Math.min(usage.value.entries / usage.value.breakEvenEntries, 1) * 100 : 100,
)

function money(amount: number): string {
  return `${Math.round(amount).toLocaleString('cs-CZ')} Kč`
}
</script>

<template>
  <section class="flex flex-col gap-3 rounded-xl border border-ink-200 p-4" aria-labelledby="multisport-title">
    <header class="flex items-center gap-2">
      <IconButton
        icon="chevron-left"
        variant="text"
        size="large"
        class="min-h-[48px] min-w-[48px]"
        title="Previous month"
        @click="month = shiftMonth(month, -1)"
      />
      <div class="flex min-w-0 flex-1 flex-col items-center">
        <h2 id="multisport-title" class="text-base font-semibold text-ink-900">Multisport</h2>
        <span class="text-xs text-ink-500">{{ monthLabel }}</span>
      </div>
      <IconButton
        icon="chevron-right"
        variant="text"
        size="large"
        class="min-h-[48px] min-w-[48px]"
        title="Next month"
        :disabled="month >= currentMonth"
        :aria-disabled="month >= currentMonth"
        @click="month < currentMonth && (month = shiftMonth(month, 1))"
      />
    </header>

    <p class="text-sm text-ink-700">
      <span class="text-2xl font-bold text-ink-900 tabular-nums">{{ usage.entries }}</span>
      of {{ usage.breakEvenEntries }} {{ usage.breakEvenEntries === 1 ? 'entry' : 'entries' }} to break even
    </p>

    <div
      class="h-3 overflow-hidden rounded-full bg-ink-100"
      role="progressbar"
      :aria-valuenow="usage.entries"
      aria-valuemin="0"
      :aria-valuemax="usage.breakEvenEntries"
      :aria-label="`${usage.entries} of ${usage.breakEvenEntries} entries to break even`"
    >
      <div
        class="h-full rounded-full transition-[width] duration-300"
        :class="usage.remaining === 0 ? 'bg-success-600' : 'bg-accent-600'"
        :style="{ width: `${progress}%` }"
      />
    </div>

    <!-- The money, as the athlete thinks of it: what the entries were worth
         against what the card cost, then the gap or the saving. -->
    <p class="text-sm text-ink-600 tabular-nums">
      {{ money(usage.value) }} of {{ money(card.monthlyPrice) }} in entries ·
      <span v-if="usage.remaining > 0">
        {{ usage.remaining }} more {{ usage.remaining === 1 ? 'entry' : 'entries' }} to pay off
      </span>
      <span v-else class="font-semibold text-success-700">paid off, {{ money(usage.balance) }} saved</span>
    </p>
  </section>
</template>
