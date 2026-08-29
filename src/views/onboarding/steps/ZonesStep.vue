<script setup lang="ts">
import ZonesForm from '@/components/settings/ZonesForm.vue'
import type { CardioZones, ZonesDraft } from '@/onboarding/types'
import type { Profile } from '@/types'
import StepShell from '@/views/onboarding/steps/StepShell.vue'

const props = withDefaults(
  defineProps<{
    modelValue: Profile
    /**
     * Owned by `OnboardingView`, not by this step: an age and a recent 5 km time
     * are never persisted, so if they lived here they would be gone the moment
     * the user stepped back and forward again.
     */
    zonesDraft: ZonesDraft
    busy?: boolean
    error?: string | null
  }>(),
  { busy: false, error: null },
)

const emit = defineEmits<{
  'update:modelValue': [value: Profile]
  'update:zonesDraft': [value: ZonesDraft]
  next: []
  back: []
  skip: []
}>()

function update(zones: CardioZones | undefined): void {
  // `zones` is optional on the profile, and the form emits `undefined` — not an
  // empty object — when nothing is filled in, so a skipped step leaves the key
  // absent rather than storing a hollow `{ hr: {}, pace: {} }`.
  emit('update:modelValue', { ...props.modelValue, cardioTrack: { ...props.modelValue.cardioTrack, zones } })
}
</script>

<template>
  <StepShell
    :step="4"
    title="Your zones"
    description="Optional. Without them we still prescribe every session — just by effort instead of by numbers."
    :busy="busy"
    :error="error"
    @next="$emit('next')"
    @back="$emit('back')"
    @skip="$emit('skip')"
  >
    <ZonesForm
      :model-value="modelValue.cardioTrack.zones"
      :draft="zonesDraft"
      :modalities="modelValue.cardioTrack.modalities"
      @update:model-value="update"
      @update:draft="emit('update:zonesDraft', $event)"
    />
  </StepShell>
</template>
