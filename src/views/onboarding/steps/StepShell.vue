<script setup lang="ts">
import { computed } from 'vue'
import { Button } from 'vuiii'

import type { StepId } from '@/onboarding/types'
import { LAST_STEP } from '@/onboarding/wizard'

const props = withDefaults(
  defineProps<{
    step: StepId
    title: string
    description?: string
    nextLabel?: string
    nextDisabled?: boolean
    busy?: boolean
    error?: string | null
    canSkip?: boolean
    canBack?: boolean
  }>(),
  {
    description: '',
    nextLabel: 'Continue',
    nextDisabled: false,
    busy: false,
    error: null,
    canSkip: true,
    canBack: true,
  },
)

defineEmits<{
  next: []
  back: []
  skip: []
}>()

// Step 0 is the welcome screen and is not one of the six questions — counting
// it would make the wizard look one step longer than it asks for.
const showProgress = computed(() => props.step >= 1)
const percent = computed(() => Math.round((props.step / LAST_STEP) * 100))
</script>

<template>
  <section class="mx-auto flex min-h-full max-w-lg flex-col">
    <header class="px-4 pt-6">
      <template v-if="showProgress">
        <p class="text-sm font-medium text-ink-500">Step {{ step }} of {{ LAST_STEP }}</p>
        <div
          class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
          role="progressbar"
          :aria-valuenow="step"
          aria-valuemin="1"
          :aria-valuemax="LAST_STEP"
          :aria-label="`Step ${step} of ${LAST_STEP}`"
        >
          <div class="h-full rounded-full bg-accent-600 transition-[width]" :style="{ width: `${percent}%` }" />
        </div>
      </template>

      <h1 class="mt-4 text-2xl font-bold text-ink-900">{{ title }}</h1>
      <p v-if="description" class="mt-1 text-ink-500">{{ description }}</p>
    </header>

    <div class="flex-1 px-4 py-6">
      <slot />
      <slot name="aside" />
    </div>

    <!-- Sticky rather than fixed: on a phone the primary action has to sit
         under the thumb without covering the last form field, and a fixed bar
         would be overlapped by the software keyboard instead of pushed by it. -->
    <footer
      class="sticky bottom-0 border-t border-ink-200 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <!-- Errors are announced here, next to the button that failed, rather
           than in a snackbar the user may have already dismissed. -->
      <p v-if="error" role="alert" class="mb-3 rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-900">
        {{ error }}
      </p>

      <!-- vuiii's `disabled` only adds a class whose CSS is `pointer-events:
           none` — the button stays tabbable and Enter still fires @click, so the
           guard has to be on the handler or an invalid step could be committed
           from the keyboard. -->
      <Button
        :label="nextLabel"
        size="large"
        block
        class="min-h-[56px]"
        :disabled="nextDisabled"
        :aria-disabled="nextDisabled || busy"
        :loading="busy"
        @click="!nextDisabled && !busy && $emit('next')"
      />

      <div class="mt-2 flex items-center justify-between gap-2">
        <Button
          v-if="canBack"
          label="Back"
          variant="text"
          prefix-icon="chevron-left"
          class="min-h-[48px]"
          :disabled="busy"
          :aria-disabled="busy"
          @click="!busy && $emit('back')"
        />
        <span v-else />

        <Button
          v-if="canSkip"
          label="Skip setup"
          variant="text"
          color="secondary"
          class="min-h-[48px]"
          :disabled="busy"
          :aria-disabled="busy"
          @click="!busy && $emit('skip')"
        />
      </div>
    </footer>
  </section>
</template>
