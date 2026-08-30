<script setup lang="ts">
import { computed, ref } from 'vue'

import AvailabilityForm from '@/components/settings/AvailabilityForm.vue'
import WeekPreview from '@/components/WeekPreview.vue'
import type { Availability } from '@/onboarding/types'
import type { Profile } from '@/types'
import { toIso } from '@/utils/date'
import StepShell from '@/views/onboarding/steps/StepShell.vue'

const props = withDefaults(
  defineProps<{
    modelValue: Profile
    busy?: boolean
    error?: string | null
  }>(),
  { busy: false, error: null },
)

const emit = defineEmits<{
  'update:modelValue': [value: Profile]
  next: []
  back: []
  skip: []
}>()

// Read once, at setup: a computed would re-read the clock on every keystroke,
// and a week that silently re-anchors itself at midnight while the user is
// picking days would move the preview under their hands.
const todayIso = toIso(new Date())

const isValid = ref(true)
const blockedReason = ref<string | null>(null)

function update(availability: Availability): void {
  emit('update:modelValue', { ...props.modelValue, availability })
}

// The preview takes the whole draft — `WeekPreview` coerces the half-filled
// fields itself — and no logged sessions: nothing is logged yet, and an empty
// list is what makes last week's completion ratio read as a full week.
const previewProfile = computed(() => props.modelValue)
</script>

<template>
  <StepShell
    :step="5"
    title="Your week"
    description="How many days you have, which ones you prefer, and which one can be long."
    :busy="busy"
    :error="error"
    :next-disabled="!isValid"
    :next-blocked-reason="blockedReason"
    @next="$emit('next')"
    @back="$emit('back')"
    @skip="$emit('skip')"
  >
    <AvailabilityForm
      :model-value="modelValue.availability"
      @update:model-value="update"
      @update:valid="isValid = $event"
      @update:blocked-reason="blockedReason = $event"
    />

    <template #aside>
      <section class="mt-8" aria-labelledby="week-preview-heading">
        <h2 id="week-preview-heading" class="text-lg font-semibold text-ink-900">This week, as planned</h2>
        <p class="mt-1 mb-3 text-sm text-ink-500">Updates as you change the answers above.</p>

        <WeekPreview :profile="previewProfile" :today-iso="todayIso" />
      </section>
    </template>
  </StepShell>
</template>
