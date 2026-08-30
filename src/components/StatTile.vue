<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { Icon } from 'vuiii'

const props = withDefaults(
  defineProps<{
    label: string
    value: string | number
    unit?: string
    hint?: string
    /** One of the 22 names registered in `src/icons.ts`. */
    icon?: string | null
    emphasis?: boolean
    to?: RouteLocationRaw | null
  }>(),
  {
    unit: '',
    hint: '',
    icon: null,
    emphasis: false,
    to: null,
  },
)

/**
 * A fresh profile has no streak, no tonnage and no minutes. A confident `0`
 * reads as a failure the athlete did not have, so nothing-yet renders as an
 * em dash — and then the unit is meaningless too and is dropped.
 *
 * DECISION: the contract says the caller formats the value, so this is the
 * only interpretation done here: an empty string or a non-finite number is
 * "no data yet". A caller that means a real zero passes the string '0'.
 */
const hasValue = computed(() => {
  if (typeof props.value === 'number') return Number.isFinite(props.value)

  return props.value.trim().length > 0
})

const displayValue = computed(() => (hasValue.value ? String(props.value) : '—'))
</script>

<template>
  <component
    :is="props.to ? 'router-link' : 'div'"
    :to="props.to ?? undefined"
    class="flex flex-col gap-1 rounded-lg border border-ink-200 bg-ink-50 p-4"
    :class="
      props.to ? 'min-h-[48px] hover:border-ink-300 focus-visible:outline-2 focus-visible:outline-accent-600' : ''
    "
  >
    <span class="flex items-center gap-1.5 text-xs font-medium text-ink-500">
      <Icon v-if="props.icon" :name="props.icon" aria-hidden="true" class="text-ink-400" />
      {{ props.label }}
    </span>

    <span class="flex items-baseline gap-1">
      <!-- The value is what is read at arm's length: it carries the size and
           the weight, the label does not. -->
      <span
        class="text-3xl font-semibold tabular-nums"
        :class="props.emphasis && hasValue ? 'text-accent-600' : 'text-ink-900'"
      >
        {{ displayValue }}
      </span>
      <span v-if="props.unit && hasValue" class="text-sm font-medium text-ink-500">{{ props.unit }}</span>
    </span>

    <span v-if="props.hint" class="text-xs text-ink-500">{{ props.hint }}</span>
  </component>
</template>
