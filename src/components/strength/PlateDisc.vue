<script setup lang="ts">
import { computed } from 'vue'

import { formatPlateWeight, type PlateColor, plateColor } from '@/training/plates'
import type { Profile } from '@/types'

import { PLATE_PAINT } from './platePaint'

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
    /** The gym's own paint for this size; the competition colour when absent. */
    color?: PlateColor
  }>(),
  { compact: false, color: undefined },
)

const colorClass = computed(() => {
  const paint = PLATE_PAINT[props.color ?? plateColor(props.weight, props.units)]
  return `${paint.fill} ${paint.ink} ${paint.rim} ring-2 ring-inset`
})
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
