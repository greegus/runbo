<script setup lang="ts">
import { Icon, IconButton } from 'vuiii'

/**
 * The header of a session screen, laid out like the Today card so a workout
 * reads the same on the way in as it did on Today: its icon, its name
 * ("Run · easy 66 min", "Strength · # DAY 4") and one line under it, a
 * "Logged" mark once it is done, and the way back.
 */
defineProps<{
  icon: string
  title: string
  subtitle?: string | null
  done?: boolean
}>()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <header class="flex items-start gap-3 px-4 pt-4">
    <!-- The Today card's icon size, so the two line up. -->
    <Icon
      :name="icon"
      size="large"
      class="shrink-0 text-accent-600 [--vuiii-icon-size--large:1.9375rem]"
      aria-hidden="true"
    />
    <div class="min-w-0 flex-1">
      <h1 class="text-2xl font-bold text-ink-900">{{ title }}</h1>
      <p v-if="subtitle" class="text-lg leading-snug font-semibold tabular-nums text-ink-700">{{ subtitle }}</p>
    </div>
    <span v-if="done" class="flex shrink-0 items-center gap-1 pt-1.5 text-sm font-semibold text-success-700">
      <Icon name="check" aria-hidden="true" />
      Logged
    </span>
    <!-- The way out mid-session: the bottom nav is hidden on session screens.
         `self-start` because vuiii centres its buttons with align-self, which
         beats the header's items-start. -->
    <IconButton
      icon="close"
      variant="text"
      size="large"
      class="-mt-2 -mr-2 min-h-[48px] min-w-[48px] shrink-0 self-start"
      aria-label="Back to Today"
      @click="emit('close')"
    />
  </header>
</template>
