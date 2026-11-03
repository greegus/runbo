<script setup lang="ts">
/**
 * A field's unit, inside the field: `<template #suffix><InputUnit unit="kg" /></template>`.
 * Hidden from screen readers — the field's own label names the unit.
 */
withDefaults(defineProps<{ unit: string; compact?: boolean }>(), { compact: false })
</script>

<template>
  <!-- `compact` for a narrow field, such as a plate weight beside its colour. -->
  <span
    class="flex shrink-0 items-center text-base font-normal text-ink-500"
    :class="compact ? 'pr-3' : 'pr-4'"
    aria-hidden="true"
  >
    {{ unit }}
  </span>
</template>
