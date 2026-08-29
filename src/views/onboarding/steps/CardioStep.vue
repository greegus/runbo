<script setup lang="ts">
import { ref } from 'vue'

import CardioForm from '@/components/settings/CardioForm.vue'
import type { CardioTrack } from '@/onboarding/types'
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

function update(cardioTrack: CardioTrack): void {
  emit('update:modelValue', { ...props.modelValue, cardioTrack })
}
</script>

<template>
  <StepShell
    :step="3"
    title="Your cardio"
    description="Tell us what you are doing now. The plan grows from there — it does not start from your goal."
    :busy="busy"
    :error="error"
    :next-disabled="!isValid"
    @next="$emit('next')"
    @back="$emit('back')"
    @skip="$emit('skip')"
  >
    <CardioForm :model-value="modelValue.cardioTrack" @update:model-value="update" @update:valid="isValid = $event" />

    <p v-if="!isValid" role="alert" class="mt-4 text-sm text-ink-500">
      Pick at least one sport and a weekly volume above zero to continue.
    </p>
  </StepShell>
</template>
