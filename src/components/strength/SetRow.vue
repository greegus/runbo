<script setup lang="ts">
import { computed } from 'vue'
import { IconButton } from 'vuiii'

import { format } from '@/liftoscript/weight'
import { resetSet, setAmrapReps, skipSet, startsRest, tapSet } from '@/session/setCycle'
import type { LoggedSet } from '@/session/types'
import type { Profile } from '@/types'

import PlateHint from './PlateHint.vue'

/**
 * One prescribed working set.
 *
 * The row owns no state and no rules: every transition comes from
 * `@/session/setCycle`, it never mutates `modelValue`, and it emits the next
 * `LoggedSet` for the parent to store. `first-log` is the ONLY rest-timer
 * trigger, and it fires exactly on `startsRest` — a correction of an already
 * finished set must not restart a 3:00 clock.
 */
const props = withDefaults(
  defineProps<{
    modelValue: LoggedSet
    /** 1-based, displayed as "Set 3". */
    setNumber: number
    /** `null` renders no plate hint — the lift is not a barbell lift. */
    plateSettings?: Profile['settings'] | null
    disabled?: boolean
    disabledReason?: string | null
  }>(),
  { plateSettings: null, disabled: false, disabledReason: null },
)

const emit = defineEmits<{
  'update:modelValue': [set: LoggedSet]
  'first-log': []
}>()

const set = computed(() => props.modelValue)

/** '8-12' for a range, plain '5' otherwise; '+' marks an AMRAP. */
const repTarget = computed(() => {
  const base = set.value.minReps ? `${set.value.minReps}-${set.value.prescribedReps}` : String(set.value.prescribedReps)

  return set.value.isAmrap ? `${base}+` : base
})

const weightLabel = computed(() => format(set.value.weight))

/**
 * The AMRAP numeral before the set is confirmed is the prescription, shown as a
 * preview — the stepper seeds there on the first change.
 */
const amrapReps = computed(() => set.value.completedReps ?? set.value.prescribedReps)

const stateLabel = computed(() => {
  if (set.value.phase === 'skipped') return 'skipped'
  if (set.value.phase === 'done') return `${set.value.completedReps} reps done`

  return 'not logged'
})

const tapLabel = computed(
  () => `Set ${props.setNumber}, ${repTarget.value} reps at ${weightLabel.value}, ${stateLabel.value}`,
)

/** vuiii's `disabled` is CSS-only, so every handler guards itself as well. */
function commit(next: LoggedSet): void {
  if (props.disabled) return

  emit('update:modelValue', next)
  if (startsRest(set.value, next)) emit('first-log')
}

function onTap(): void {
  commit(tapSet(set.value))
}

function onStep(delta: number): void {
  commit(setAmrapReps(set.value, amrapReps.value + delta))
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Non-AMRAP: the WHOLE row is the tap target. It is tapped mid-set, one
         handed, with chalky hands — a small button inside a row would be missed. -->
    <button
      v-if="!set.isAmrap"
      type="button"
      class="flex w-full min-h-[56px] items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
      :class="[
        set.phase === 'done' ? 'border-accent-600 bg-accent-600 text-white' : '',
        set.phase === 'untouched' ? 'border-ink-300 bg-white text-ink-900' : '',
        set.phase === 'skipped' ? 'border-dashed border-ink-300 bg-ink-50 text-ink-400' : '',
        disabled ? 'opacity-50' : '',
      ]"
      :disabled="disabled"
      :aria-disabled="disabled"
      :aria-label="tapLabel"
      @click="onTap"
    >
      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span class="font-semibold" :class="set.phase === 'done' ? 'text-white' : 'text-ink-500'">
            Set {{ setNumber }}
          </span>
          <span v-if="set.label" :class="set.phase === 'done' ? 'text-accent-100' : 'text-ink-500'">
            {{ set.label }}
          </span>
        </span>

        <span
          class="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-base tabular-nums"
          :class="set.phase === 'skipped' ? 'line-through' : ''"
        >
          <span class="font-semibold">{{ repTarget }} reps</span>
          <span :class="set.phase === 'done' ? 'text-accent-100' : 'text-ink-600'">{{ weightLabel }}</span>
        </span>

        <PlateHint
          v-if="plateSettings"
          :weight="set.weight"
          :settings="plateSettings"
          compact
          class="mt-0.5"
          :class="set.phase === 'done' ? 'text-accent-100!' : ''"
        />
      </span>

      <!-- Untouched and skipped are both `completedReps: null` in the stored
           model; on screen they must never look alike, so untouched shows the
           prescription in ink and skipped says the word. -->
      <span class="shrink-0 text-right tabular-nums">
        <span v-if="set.phase === 'done'" class="block text-4xl leading-none font-bold">
          {{ set.completedReps }}
        </span>
        <span v-else-if="set.phase === 'skipped'" class="block text-base font-semibold uppercase">Skipped</span>
        <span v-else class="block text-3xl leading-none font-semibold text-ink-300">{{ set.prescribedReps }}</span>
      </span>
    </button>

    <!-- AMRAP: a stepper, never the cycle. The answer is "however many I got",
         which is usually ABOVE the prescription, and cycling down from 5 to
         reach 12 is absurd. -->
    <div
      v-else
      class="rounded-xl border-2 px-4 py-3"
      :class="[
        set.phase === 'done' ? 'border-accent-600 bg-accent-50' : '',
        set.phase === 'untouched' ? 'border-ink-300 bg-white' : '',
        set.phase === 'skipped' ? 'border-dashed border-ink-300 bg-ink-50 text-ink-400' : '',
        disabled ? 'opacity-50' : '',
      ]"
    >
      <div class="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span class="font-semibold text-ink-500">Set {{ setNumber }}</span>
        <span class="font-semibold text-ink-900 tabular-nums">{{ repTarget }} reps</span>
        <span class="text-ink-600 tabular-nums">{{ weightLabel }}</span>
        <span v-if="set.label" class="text-ink-500">{{ set.label }}</span>
      </div>

      <PlateHint v-if="plateSettings" :weight="set.weight" :settings="plateSettings" class="mt-0.5" />

      <div class="mt-3 flex items-center justify-between gap-3">
        <IconButton
          icon="minus"
          variant="outlined"
          size="large"
          class="min-h-[48px] min-w-[48px]"
          aria-label="One rep fewer"
          :disabled="disabled"
          :aria-disabled="disabled"
          @click="onStep(-1)"
        />

        <!-- Tapping the numeral confirms the set at the prescription; once
             confirmed it is a no-op, so a stray tap cannot destroy a typed number. -->
        <button
          type="button"
          class="flex min-h-[56px] flex-1 flex-col items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
          :disabled="disabled"
          :aria-disabled="disabled"
          :aria-label="tapLabel"
          @click="onTap"
        >
          <span
            class="text-5xl leading-none font-bold tabular-nums"
            :class="[
              set.phase === 'done' ? 'text-accent-600' : 'text-ink-300',
              set.phase === 'skipped' ? 'text-ink-300 line-through' : '',
            ]"
          >
            {{ set.phase === 'skipped' ? '—' : amrapReps }}
          </span>
          <span class="mt-1 text-xs uppercase" :class="set.phase === 'done' ? 'text-accent-700' : 'text-ink-500'">
            {{ set.phase === 'done' ? 'reps done' : set.phase === 'skipped' ? 'skipped' : 'tap to log' }}
          </span>
        </button>

        <IconButton
          icon="plus"
          variant="outlined"
          size="large"
          class="min-h-[48px] min-w-[48px]"
          aria-label="One rep more"
          :disabled="disabled"
          :aria-disabled="disabled"
          @click="onStep(1)"
        />
      </div>

      <div class="mt-2 flex justify-end gap-4">
        <button
          type="button"
          class="min-h-[48px] px-2 text-sm font-medium text-ink-600 underline"
          :disabled="disabled"
          :aria-disabled="disabled"
          @click="commit(skipSet(set))"
        >
          Skip
        </button>
        <button
          type="button"
          class="min-h-[48px] px-2 text-sm font-medium text-ink-600 underline"
          :disabled="disabled"
          :aria-disabled="disabled"
          @click="commit(resetSet(set))"
        >
          Clear
        </button>
      </div>
    </div>

    <!-- A greyed control with no explanation is a dead end. -->
    <p v-if="disabled && disabledReason" role="status" class="text-sm text-accent-700">
      {{ disabledReason }}
    </p>
  </div>
</template>
