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

// The painted plates get white digits and a white edge, so a red disc stays a
// disc on a logged set's orange row. The pastel change plates and chrome get
// dark ink and an inset edge a shade darker than the paint: white on a pastel
// fails contrast under gym lighting, and a pale disc on a white screen needs a
// rim to be a disc at all. Green is the 700 because white on green-600 is
// about 3:1.
const COLOR_CLASSES: Record<PlateColor, string> = {
  red: 'bg-red-600 text-white ring-2 ring-white',
  blue: 'bg-blue-600 text-white ring-2 ring-white',
  yellow: 'bg-yellow-400 text-ink-900 ring-2 ring-white',
  green: 'bg-green-700 text-white ring-2 ring-white',
  grey: 'bg-ink-500 text-white ring-2 ring-white',
  'pale-red': 'bg-red-200 text-red-900 ring-2 ring-red-300 ring-inset',
  'pale-blue': 'bg-blue-200 text-blue-900 ring-2 ring-blue-300 ring-inset',
  'pale-yellow': 'bg-yellow-100 text-yellow-900 ring-2 ring-yellow-300 ring-inset',
  'pale-green': 'bg-green-200 text-green-900 ring-2 ring-green-300 ring-inset',
  'pale-grey': 'bg-ink-100 text-ink-800 ring-2 ring-ink-300 ring-inset',
  silver: 'bg-linear-to-br from-white to-ink-300 text-ink-900 ring-2 ring-ink-400 ring-inset',
  black: 'bg-ink-800 text-white ring-2 ring-white',
}

const colorClass = computed(() => COLOR_CLASSES[plateColor(props.weight, props.units)])
</script>

<template>
  <!-- Fixed size so a "1.25" and a "5" line up as a row of plates, not a row of
       pills; tight tracking is what lets four characters fit the small disc. -->
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tighter tabular-nums"
    :class="[colorClass, compact ? 'size-6 text-[9px]' : 'size-7 text-[10px]']"
  >
    {{ formatPlateWeight(weight) }}
  </span>
</template>
