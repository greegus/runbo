<script setup lang="ts">
import { Icon } from 'vuiii'

import type { Profile } from '@/types'
import StepShell from '@/views/onboarding/steps/StepShell.vue'

withDefaults(
  defineProps<{
    modelValue: Profile
    busy?: boolean
    error?: string | null
  }>(),
  { busy: false, error: null },
)

// The welcome screen changes nothing, but it declares the same emit as every
// other step so the wizard can render the step map with one `<component :is>`.
defineEmits<{
  'update:modelValue': [value: Profile]
  next: []
  back: []
  skip: []
}>()

const POINTS = [
  { icon: 'dumbbell', text: 'Your gym: units, barbell and plates, so every weight we show is one you can load.' },
  { icon: 'history', text: 'Your program: start fresh on GZCLP, or bring your Liftosaur program and history over.' },
  { icon: 'run', text: 'Your cardio: what you actually run, ride or swim today — not what you wish you did.' },
  { icon: 'calendar', text: 'Your week: how many days you have, and which one is long.' },
]
</script>

<template>
  <StepShell
    :step="0"
    title="Welcome to runbo"
    description="Six short questions. You can change every answer later in Settings."
    next-label="Get started"
    :busy="busy"
    :error="error"
    :can-back="false"
    @next="$emit('next')"
    @back="$emit('back')"
    @skip="$emit('skip')"
  >
    <ul class="flex flex-col gap-4">
      <li v-for="point in POINTS" :key="point.icon" class="flex gap-3">
        <Icon :name="point.icon" size="large" class="mt-0.5 shrink-0 text-accent-600" />
        <p class="text-ink-700">{{ point.text }}</p>
      </li>
    </ul>

    <p class="mt-6 text-sm text-ink-500">
      In a hurry? “Skip setup” starts you on GZCLP with no weights set — we'll ask you at the gym — and a 2 × 30 min
      cardio baseline.
    </p>
  </StepShell>
</template>
