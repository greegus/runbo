<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { IconButton, RadioButtonGroup } from 'vuiii'

import { readinessAdvice, scoreReadiness, type ReadinessInput } from '@/training/readiness'
import type { SessionKind } from '@/types'

/**
 * The optional pre-session readiness check.
 *
 * It EMITS the three readings and nothing else. It has no store, no service and
 * no profile: making the write somebody else's job is what makes "readiness
 * never touches program state" impossible to get wrong from here. The score,
 * the band and the advice string all come from `@/training/readiness` — this
 * component restates neither the thresholds nor the wording.
 */

interface Props {
  open: boolean
  kind: SessionKind
  busy?: boolean
  /**
   * The sheet is also shown from inside an already-created session, where
   * submitting only records the answers — promising "Start session" there reads
   * as though a second session is about to be created.
   */
  submitLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  busy: false,
  submitLabel: 'Start session',
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [input: ReadinessInput]
  skip: []
}>()

/**
 * DECISION: the pickers seed at 3, the middle of the scale. The sheet must be
 * answerable in one tap for someone who is simply "fine", and an unseeded
 * control would either block Save or force three taps before the athlete can
 * get to the bar.
 */
const NEUTRAL = 3

const scaleOptions = [1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) }))

const sleep = ref(NEUTRAL)
const energy = ref(NEUTRAL)
const soreness = ref(NEUTRAL)

const panel = ref<HTMLElement>()
let lastFocused: HTMLElement | null = null

const input = computed<ReadinessInput>(() => ({
  sleep: sleep.value,
  energy: energy.value,
  soreness: soreness.value,
}))

const score = computed(() => scoreReadiness(input.value))

/** Verbatim from the domain module, or nothing at all above the threshold. */
const advice = computed(() => readinessAdvice(score.value.total, props.kind))

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * `aria-modal="true"` is a promise: Tab must not walk out into the page behind
 * the backdrop, because from there Escape no longer reaches this panel and a
 * keyboard user has no way out of a dialog that claims to be modal.
 *
 * vuiii's `useFocusTrap` binds on mount, and this panel is `v-if`-ed inside a
 * component that stays mounted for the life of the screen, so the trap would
 * attach to nothing. The cycle is therefore handled here, on the panel itself.
 */
function onTab(event: KeyboardEvent): void {
  const root = panel.value
  if (!root) return

  const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  )

  if (focusable.length === 0) {
    event.preventDefault()
    root.focus()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement

  if (event.shiftKey ? active === first || !root.contains(active) : active === last || !root.contains(active)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  }
}

function close(): void {
  emit('update:open', false)
}

/**
 * Skipping is an outcome, not a dismissal: the backdrop, the close button and
 * Escape all land here, so an athlete in a hurry is one tap from the bar and the
 * session starts with `readiness` simply absent.
 */
function skip(): void {
  if (props.busy) return
  emit('skip')
  close()
}

function submit(): void {
  if (props.busy) return
  emit('submit', input.value)
  close()
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      // Fresh answers every session — yesterday's sleep score is not today's.
      sleep.value = NEUTRAL
      energy.value = NEUTRAL
      soreness.value = NEUTRAL

      lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      panel.value?.focus()
      return
    }

    lastFocused?.focus()
    lastFocused = null
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-end justify-center">
      <!-- Tapping outside is a skip, never a silent cancel. -->
      <div class="absolute inset-0 bg-ink-900/40" @click="skip" />

      <div
        ref="panel"
        class="relative flex max-h-[90vh] w-full max-w-lg flex-col gap-5 overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="readiness-title"
        tabindex="-1"
        @keydown.esc="skip"
        @keydown.tab="onTab"
      >
        <header class="flex items-start justify-between gap-3">
          <div>
            <h2 id="readiness-title" class="text-xl font-bold text-ink-900">How are you feeling?</h2>
            <p class="text-sm text-ink-500">Optional. It only changes the advice below, never your program.</p>
          </div>

          <IconButton
            icon="close"
            size="large"
            variant="text"
            class="min-h-[48px] min-w-[48px]"
            aria-label="Skip the readiness check"
            @click="skip"
          />
        </header>

        <fieldset class="flex flex-col gap-2">
          <legend class="text-sm font-medium text-ink-900">Sleep</legend>
          <RadioButtonGroup
            v-model="sleep"
            aria-label="Sleep, 1 terrible to 5 great"
            :options="scaleOptions"
            option-label="label"
            option-value="value"
            size="large"
            class="min-h-[56px] w-full"
          />
          <div class="flex justify-between text-xs text-ink-500">
            <span>1 · terrible</span>
            <span>5 · great</span>
          </div>
        </fieldset>

        <fieldset class="flex flex-col gap-2">
          <legend class="text-sm font-medium text-ink-900">Energy</legend>
          <RadioButtonGroup
            v-model="energy"
            aria-label="Energy, 1 flat to 5 fresh"
            :options="scaleOptions"
            option-label="label"
            option-value="value"
            size="large"
            class="min-h-[56px] w-full"
          />
          <div class="flex justify-between text-xs text-ink-500">
            <span>1 · flat</span>
            <span>5 · fresh</span>
          </div>
        </fieldset>

        <!-- Higher is ALWAYS better, soreness included: 1 = wrecked, 5 = none.
             Inverting this scale is the classic bug — the poles are spelled out
             so the athlete cannot read it the other way round either. -->
        <fieldset class="flex flex-col gap-2">
          <legend class="text-sm font-medium text-ink-900">Soreness</legend>
          <RadioButtonGroup
            v-model="soreness"
            aria-label="Soreness, 1 wrecked to 5 no soreness"
            :options="scaleOptions"
            option-label="label"
            option-value="value"
            size="large"
            class="min-h-[56px] w-full"
          />
          <div class="flex justify-between text-xs text-ink-500">
            <span>1 · wrecked</span>
            <span>5 · no soreness</span>
          </div>
        </fieldset>

        <p class="text-sm text-ink-700">
          Readiness <span class="font-bold tabular-nums">{{ score.total }}</span
          ><span class="tabular-nums">/15</span> · {{ score.band }}
        </p>

        <p
          v-if="advice"
          class="rounded-lg border border-accent-200 bg-accent-50 p-3 text-sm text-accent-800"
          role="status"
        >
          {{ advice }}
        </p>

        <div class="flex flex-col gap-2">
          <button
            type="button"
            class="min-h-[56px] rounded-xl bg-accent-600 px-4 text-base font-semibold text-white"
            :aria-disabled="busy"
            @click="submit"
          >
            {{ busy ? `${submitLabel}…` : submitLabel }}
          </button>

          <button
            type="button"
            class="min-h-[48px] rounded-xl border border-ink-200 px-4 text-base font-semibold text-ink-700"
            :aria-disabled="busy"
            @click="skip"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
