<script setup lang="ts">
import { computed } from 'vue'

import { format } from '@/liftoscript/weight'
import { formatPlatesForWeight, platesForWeight } from '@/training/plates'
import type { Profile, WeightValue } from '@/types'

/**
 * "What to load" for one barbell weight. All arithmetic comes from
 * `src/training/plates.ts` — this component does none of its own, because the
 * only correct implementation of "what can this bar be loaded to" lives in the
 * engine and duplicating it here is how the hint and the prescription drift.
 */
const props = withDefaults(
  defineProps<{
    weight: WeightValue
    settings: Profile['settings']
    /** One line, no achievable note — for a dense list such as the warmup ramp. */
    compact?: boolean
  }>(),
  { compact: false },
)

// `value === 0` means the caller has not collected a weight yet — an empty bar
// hint would read as a real prescription, so render nothing at all.
const hasWeight = computed(() => Number.isFinite(props.weight?.value) && props.weight.value > 0)

const load = computed(() => platesForWeight(props.weight, props.settings))

const hint = computed(() => formatPlatesForWeight(props.weight, props.settings))

const achievable = computed(() => format(load.value.achievable))
</script>

<template>
  <!-- A weight the gym cannot load must not look like one it can: the hint goes
       accent-coloured and carries a '≈', and outside compact mode it also says
       what the bar will really weigh. -->
  <!-- A <span>, not a <p>: the whole non-AMRAP set row is one <button>, and a
       block element inside a button is invalid HTML. -->
  <span
    v-if="hasWeight"
    class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm tabular-nums"
    :class="load.exact ? 'text-ink-500' : 'text-accent-700'"
  >
    <span>
      <span v-if="!load.exact" aria-hidden="true">≈&nbsp;</span>
      {{ hint }}
    </span>

    <span v-if="!load.exact && !compact" class="font-medium text-accent-700">closest: {{ achievable }}</span>
  </span>
</template>
