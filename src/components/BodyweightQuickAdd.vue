<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, Icon, Input } from 'vuiii'

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
// The placeholder says what is missing, so a greyed Save is never unexplained.
const canSave = computed(() => usableWeight.value !== null)

/**
 * The field shows today's stored weight: already logged, or just saved. Firestore
 * updates the local snapshot before the server acknowledges, so the echo of a
 * save is the honest "saved" signal — a queued offline write shows as saved,
 * which it is, and never as an error. Typing a different number clears it.
 */
const isSaved = computed(() => props.entry !== undefined && usableWeight.value === props.entry.weight)

function save(): void {
  const value = usableWeight.value
  if (value === null || props.busy) return

  // The field keeps the number: a failed write must leave it there to retry.
  emit('submit', { date: props.todayIso, weight: value })
}
</script>

<template>
  <section class="flex flex-col gap-3 rounded-lg border border-ink-200 p-4" aria-label="Bodyweight">
    <!-- The heading doubles as the field's label: one line says what and when. -->
    <h2 class="text-base font-semibold text-ink-900">
      Today's bodyweight <span class="font-normal text-ink-500">({{ props.unit }})</span>
    </h2>

    <div class="flex items-center gap-3">
      <Input
        type="number"
        value-as-number
        inputmode="decimal"
        min="0"
        step="0.1"
        size="large"
        class="min-h-[48px] min-w-0 flex-1 tabular-nums"
        placeholder="Enter a weight"
        :model-value="weight"
        :aria-label="`Today's bodyweight in ${props.unit}`"
        @update:model-value="setWeight"
      >
        <template v-if="isSaved" #suffix>
          <!-- vuiii's own suffixIcon is greyed at half opacity; the slot gets no
               wrapper of its own, so this one centres the check and keeps it
               off the edge. -->
          <span class="flex shrink-0 items-center pr-3">
            <Icon
              name="check-circle"
              class="shrink-0 text-green-600 [--vuiii-icon-size:1.5rem]"
              role="img"
              aria-label="Saved"
            />
          </span>
        </template>
      </Input>

      <Button
        color="primary"
        label="Save"
        size="large"
        class="min-h-[48px]"
        :disabled="!canSave"
        :aria-disabled="!canSave || props.busy"
        :loading="props.busy"
        @click="save()"
      />
    </div>

    <p v-if="props.error" role="alert" class="text-sm text-accent-700">
      {{ props.error }}
    </p>
  </section>
</template>
