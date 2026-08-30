<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { IconButton } from 'vuiii'

import { formatClock } from '@/utils/duration'

/**
 * The between-sets rest countdown.
 *
 * The one rule that matters: remaining time is DERIVED from a target timestamp
 * (`startedAt + seconds`), never decremented on an interval. A phone that locks
 * mid-rest, a backgrounded tab or a throttled interval would otherwise leave the
 * clock wrong by exactly as long as the screen was off — which on this screen is
 * the difference between a rest timer and a decoration. The interval here only
 * re-reads the wall clock; it never owns the value.
 *
 * This is the single component in Phase 7 allowed to read `Date.now()`. It reads
 * nothing else and writes nothing anywhere.
 */

interface Props {
  seconds: number
  /** Epoch ms of the tap that started this run; `null` = idle, render nothing. */
  startedAt: number | null
  label?: string
}

const props = withDefaults(defineProps<Props>(), {
  startedAt: null,
  label: '',
})

const emit = defineEmits<{
  done: []
  dismiss: []
}>()

const TICK_MS = 200
const EXTEND_SEC = 30

const now = ref(Date.now())
/**
 * DECISION: "+30s" is held locally instead of asking the parent for a new
 * `startedAt`, because a restart is exactly what the parent's `startedAt` means
 * — extending must not look like a fresh set was logged. It resets with every
 * new run, so the contract ("a new `startedAt` is a restart") still holds.
 */
const extraSec = ref(0)
/** `done` must fire exactly once per `startedAt` value. */
const doneFired = ref(false)

let timer: ReturnType<typeof setInterval> | undefined

function stop(): void {
  if (timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }
}

function tick(): void {
  now.value = Date.now()
}

const running = computed(() => props.startedAt !== null)

const totalSec = computed(() => {
  const base = Number.isFinite(props.seconds) ? Math.max(0, props.seconds) : 0
  return base + extraSec.value
})

const remaining = computed(() => {
  if (props.startedAt === null) return 0
  const elapsed = (now.value - props.startedAt) / 1000
  return Math.max(0, totalSec.value - elapsed)
})

const finished = computed(() => running.value && remaining.value <= 0)

const display = computed(() => formatClock(remaining.value))

/**
 * A polite live region that repeated the seconds would be unusable — a screen
 * reader would speak the whole countdown. So the announcement changes on coarse
 * steps only (every 30 s above a minute, every 10 s below it) and at the finish,
 * while the big numerals next to it are `aria-hidden` and update every tick.
 */
const announcement = computed(() => {
  if (!running.value) return ''
  if (finished.value) return props.label ? `${props.label} over` : 'Rest over'

  const step = remaining.value > 60 ? 30 : 10
  const bucket = Math.ceil(remaining.value / step) * step

  return `${formatClock(bucket)} left`
})

// The ring is drawn as a dash offset rather than a CSS animation, so it stays
// truthful after a background/foreground round trip instead of replaying.
const RADIUS = 54
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const dashOffset = computed(() => {
  const fraction = totalSec.value > 0 ? remaining.value / totalSec.value : 0
  return CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, fraction)))
})

function extend(): void {
  // Only while the clock is still running: extending a finished rest would have
  // to re-arm `done` and fire it twice for one `startedAt`.
  if (!running.value || finished.value) return
  extraSec.value += EXTEND_SEC
  tick()
}

function skip(): void {
  if (!running.value) return
  emit('dismiss')
}

/** A new `startedAt` is how the parent expresses "restart" — reset everything. */
watch(
  () => props.startedAt,
  (startedAt) => {
    extraSec.value = 0
    doneFired.value = false
    stop()

    if (startedAt === null) return

    tick()
    timer = setInterval(tick, TICK_MS)
  },
  { immediate: true },
)

watch(finished, (isFinished) => {
  if (!isFinished || doneFired.value) return
  doneFired.value = true
  stop()
  emit('done')
})

onBeforeUnmount(stop)
</script>

<template>
  <div
    v-if="running"
    class="flex items-center gap-4 rounded-xl border px-4 py-3"
    :class="finished ? 'border-accent-600 bg-accent-600 text-white' : 'border-ink-200 bg-white text-ink-900'"
  >
    <div class="relative shrink-0">
      <svg class="RestTimer__ring" viewBox="0 0 120 120" width="72" height="72" aria-hidden="true">
        <circle
          cx="60"
          cy="60"
          :r="RADIUS"
          fill="none"
          stroke-width="8"
          :class="finished ? 'stroke-white/40' : 'stroke-ink-200'"
        />
        <circle
          class="RestTimer__progress"
          cx="60"
          cy="60"
          :r="RADIUS"
          fill="none"
          stroke-width="8"
          stroke-linecap="round"
          :class="finished ? 'stroke-white' : 'stroke-accent-600'"
          :stroke-dasharray="CIRCUMFERENCE"
          :stroke-dashoffset="dashOffset"
          transform="rotate(-90 60 60)"
        />
      </svg>
    </div>

    <div class="min-w-0 flex-1">
      <p v-if="label" class="truncate text-sm font-medium" :class="finished ? 'text-white' : 'text-ink-500'">
        {{ label }}
      </p>

      <!-- The numerals are the visual clock; the live region beside them is the
           spoken one, so the countdown is not read out second by second. -->
      <p class="text-4xl leading-none font-bold tabular-nums" aria-hidden="true">
        {{ finished ? 'Rest over' : display }}
      </p>
      <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <!-- Hidden rather than disabled once the rest is over: there is nothing
           left to extend, and a greyed control with no explanation is a dead end. -->
      <IconButton
        v-if="!finished"
        icon="plus"
        size="large"
        variant="outlined"
        class="min-h-[48px] min-w-[48px]"
        :aria-label="`Add ${EXTEND_SEC} seconds of rest`"
        @click="extend"
      />
      <button
        type="button"
        class="min-h-[48px] rounded-lg px-4 text-sm font-semibold"
        :class="finished ? 'bg-white text-accent-700' : 'border border-ink-200 text-ink-700'"
        @click="skip"
      >
        {{ finished ? 'Done' : 'Skip' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.RestTimer__progress {
  transition: stroke-dashoffset 200ms linear;
}

/* Numerals only: a sweeping ring is decoration, and the number is the content. */
@media (prefers-reduced-motion: reduce) {
  .RestTimer__progress {
    transition: none;
  }

  .RestTimer__ring {
    display: none;
  }
}
</style>
