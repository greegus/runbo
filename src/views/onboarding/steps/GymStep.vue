<script setup lang="ts">
import { ref } from 'vue'

import GymForm from '@/components/settings/GymForm.vue'
import type { GymSettings } from '@/onboarding/types'
import type { Profile } from '@/types'
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

const isValid = ref(true)

// A fresh Profile with one slice replaced: the wizard's draft is what every
// other step reads, and mutating the prop in place would leave the parent's
// `watch`ers (the review summary, the week preview) looking at the same object.
function update(settings: GymSettings): void {
  emit('update:modelValue', { ...props.modelValue, settings })
}
</script>

<template>
  <StepShell
    :step="1"
    title="Your gym"
    description="So every weight we prescribe is one you can actually load on the bar."
    :busy="busy"
    :error="error"
    :next-disabled="!isValid"
    @next="$emit('next')"
    @back="$emit('back')"
    @skip="$emit('skip')"
  >
    <GymForm :model-value="modelValue.settings" @update:model-value="update" @update:valid="isValid = $event" />

    <p v-if="!isValid" role="alert" class="mt-4 text-sm text-ink-500">Fix the highlighted numbers above to continue.</p>
  </StepShell>
</template>
