<script setup lang="ts">
import { computed } from 'vue'

import { formatPlateWeight, type PlateColor, plateColor } from '@/training/plates'
import type { Profile } from '@/types'

/**
 * One plate, drawn as a disc in its rack colour with the weight inside. The
 * colour is what a lifter finds on the rack from across the room; the number is
 * still there because a colour alone means nothing to a gym with black iron.
 */
const props = withDefaults(
  defineProps<{
    weight: number
    units: Profile['settings']['units']
    /** Smaller disc for a dense list such as the warmup ramp. */
    compact?: boolean
  }>(),
  { compact: false },
)

// Light plates get dark ink and an outline: white on white would be invisible,
// and white digits on yellow fail contrast under gym lighting. Green is the 700
// for the same reason — white on green-600 is about 3:1. The painted plates get
// a white edge so a red disc stays a disc on a logged set's orange row.
const COLOR_CLASSES: Record<PlateColor, string> = {
  red: 'bg-red-600 text-white ring-1 ring-white',
  blue: 'bg-blue-600 text-white ring-1 ring-white',
  yellow: 'bg-yellow-400 text-ink-900 ring-1 ring-white',
  green: 'bg-green-700 text-white ring-1 ring-white',
  white: 'bg-white text-ink-900 ring-1 ring-ink-300 ring-inset',
  silver: 'bg-ink-200 text-ink-900 ring-1 ring-ink-300 ring-inset',
  black: 'bg-ink-800 text-white ring-1 ring-white',
}

const colorClass = computed(() => COLOR_CLASSES[plateColor(props.weight, props.units)])
</script>

<template>
  <!-- Fixed size so a "1.25" and a "5" line up as a row of plates, not a row of
       pills; tight tracking is what lets four characters fit the small disc. -->
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tighter tabular-nums"
    :class="[colorClass, compact ? 'size-7 text-[11px]' : 'size-8 text-xs']"
  >
    {{ formatPlateWeight(weight) }}
  </span>
</template>
