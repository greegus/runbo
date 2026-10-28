<script setup lang="ts">
import { formatPlateWeight, type PlateLoad } from '@/training/plates'
import type { Profile } from '@/types'

import PlateDisc from './PlateDisc.vue'

/**
 * The bar and one side's plates as a picture: "20 +" and a disc per plate.
 * Purely visual — the caller owns the text version a screen reader gets, and
 * any "≈" or "closest" note, because those differ between a session hint and
 * the settings check panel.
 */
withDefaults(
  defineProps<{
    load: PlateLoad
    settings: Profile['settings']
    /** Smaller discs for a dense list such as the warmup ramp. */
    compact?: boolean
  }>(),
  { compact: false },
)
</script>

<template>
  <span class="flex flex-wrap items-center gap-1" aria-hidden="true">
    <span>{{ formatPlateWeight(settings.barbellWeight) }}</span>
    <template v-if="load.perSide.length">
      <span>+</span>
      <PlateDisc
        v-for="(plate, index) in load.perSide"
        :key="index"
        :weight="plate"
        :units="settings.units"
        :compact="compact"
      />
    </template>
  </span>
</template>
