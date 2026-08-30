<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, FormGroup, Input } from 'vuiii'

import type { BodyweightEntry } from '@/types'

const props = withDefaults(
  defineProps<{
    todayIso: string
    unit: 'kg' | 'lb'
    /** Today's existing entry, if the athlete already weighed in. */
    entry?: BodyweightEntry | undefined
    busy?: boolean
    error?: string | null
  }>(),
  {
    entry: undefined,
    busy: false,
    error: null,
  },
)

const emit = defineEmits<{
  submit: [payload: { date: string; weight: number }]
}>()

const weight = ref<number | null>(props.entry?.weight ?? null)
/** Once the athlete types, the store's own echo must never stomp the field. */
const touched = ref(false)
const lastSubmitted = ref<number | null>(null)

// Re-seed only while untouched: the entry arrives asynchronously (the listener
// may land after first paint, or another device may write), but a snapshot that
// overwrites a half-typed number is the bug SettingsView had to solve twice.
watch(
  () => props.entry?.weight,
  (next) => {
    if (!touched.value) weight.value = next ?? null
  },
)

/** vuiii number inputs emit `null` when cleared and `NaN` half-typed. */
function setWeight(value: unknown): void {
  touched.value = true
  weight.value = typeof value === 'number' && Number.isFinite(value) ? value : null
}

const usableWeight = computed(() => (weight.value !== null && weight.value > 0 ? weight.value : null))
const blockedReason = computed(() => (usableWeight.value === null ? 'Enter a weight' : null))

/**
 * Firestore updates the local snapshot before the server acknowledges, so an
 * echoed entry equal to what we sent is the honest "saved" signal — a queued
 * offline write shows as saved, which it is, and never as an error.
 */
const savedEcho = computed(
  () => lastSubmitted.value !== null && props.entry !== undefined && props.entry.weight === lastSubmitted.value,
)

function save(): void {
  const value = usableWeight.value
  if (value === null || props.busy) return

  lastSubmitted.value = value
  // The field keeps the number: a failed write must leave it there to retry.
  emit('submit', { date: props.todayIso, weight: value })
}
</script>

<template>
  <section class="flex flex-col gap-3 rounded-lg border border-ink-200 p-4" aria-label="Bodyweight">
    <h2 class="text-base font-semibold text-ink-900">Bodyweight</h2>

    <div class="flex items-end gap-3">
      <FormGroup :label="`Today (${props.unit})`" class="flex-1">
        <template #default="{ id }">
          <Input
            :id="id"
            type="number"
            value-as-number
            inputmode="decimal"
            min="0"
            step="0.1"
            size="large"
            class="min-h-[48px] tabular-nums"
            :model-value="weight"
            aria-label="Today's bodyweight"
            @update:model-value="setWeight"
          />
        </template>
      </FormGroup>

      <Button
        label="Save"
        size="large"
        class="min-h-[48px]"
        :disabled="blockedReason !== null"
        :aria-disabled="blockedReason !== null || props.busy"
        :loading="props.busy"
        @click="save()"
      />
    </div>

    <!-- A greyed control with no explanation is a dead end. -->
    <p v-if="blockedReason" role="status" class="text-sm text-ink-500">
      {{ blockedReason }}
    </p>
    <p v-else-if="props.entry" class="text-sm text-ink-500">
      You already logged {{ props.entry.weight }} {{ props.unit }} today. Saving replaces it.
    </p>

    <p v-if="props.error" role="alert" class="text-sm text-accent-700">
      {{ props.error }}
    </p>
    <p v-else-if="savedEcho" role="status" class="text-sm text-ink-500">Saved.</p>
  </section>
</template>
