<script setup lang="ts">
import { ref } from 'vue'
import { IconButton, useFocusTrap } from 'vuiii'

import DiagnosticsList from '@/components/DiagnosticsList.vue'
import { format } from '@/liftoscript/weight'
import { type LiftProjection, setsLabel } from '@/session/projection'

/**
 * The upcoming sessions of one lift, as a table.
 *
 * Display only: every row comes out of `projectLift`, which runs the program's
 * own progression. The parent mounts this with `v-if`, so the focus trap binds
 * when the sheet appears and hands focus back when it goes — unlike
 * `ReadinessSheet`, nothing here has to survive being closed.
 */
withDefaults(
  defineProps<{
    /** The lift as the athlete knows it — 'T1 Squat'. */
    title: string
    projection: LiftProjection
    /** What the first row is called: 'Today' from inside a session, else the next one. */
    firstLabel?: string
  }>(),
  { firstLabel: 'Next' },
)

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement>()

useFocusTrap(panel, { initialFocus: () => panel.value })
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-end justify-center">
      <div class="absolute inset-0 bg-ink-900/40" @click="emit('close')" />

      <div
        ref="panel"
        class="relative flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="projection-title"
        tabindex="-1"
        @keydown.esc="emit('close')"
      >
        <header class="flex items-start justify-between gap-3">
          <div>
            <h2 id="projection-title" class="text-xl font-bold text-ink-900">{{ title }}</h2>
            <p class="text-sm text-ink-500">Where this lift goes if every session goes to plan.</p>
          </div>

          <IconButton
            icon="close"
            size="large"
            variant="text"
            class="min-h-[48px] min-w-[48px]"
            aria-label="Close the projection"
            @click="emit('close')"
          />
        </header>

        <p v-if="projection.sessions.length === 0 && projection.diagnostics.length === 0" class="text-sm text-ink-500">
          Set a working weight first — there is nothing to count up from yet.
        </p>

        <table v-if="projection.sessions.length" class="w-full text-left tabular-nums">
          <thead class="text-xs font-semibold uppercase tracking-wide text-ink-500">
            <tr>
              <th scope="col" class="py-2 pr-3 font-semibold">Session</th>
              <th scope="col" class="py-2 pr-3 font-semibold">Sets</th>
              <th scope="col" class="py-2 text-right font-semibold">Weight</th>
            </tr>
          </thead>

          <tbody class="divide-y divide-ink-100">
            <tr v-for="session in projection.sessions" :key="session.index" class="text-ink-900">
              <td class="py-2 pr-3 text-ink-500">
                {{ session.index === 1 ? firstLabel : `+${session.index - 1}` }}
              </td>
              <td class="py-2 pr-3">
                {{ setsLabel(session.sets) }}
                <!-- The scheme starting over is the row that breaks the pattern
                     (GZCLP's stage-3 reset also drops the weight); without a
                     word it reads like a typo. -->
                <span v-if="session.stageReset" class="ml-1 text-xs font-semibold text-accent-700">new cycle</span>
              </td>
              <td class="py-2 text-right font-semibold">{{ format(session.weight) }}</td>
            </tr>
          </tbody>
        </table>

        <DiagnosticsList v-if="projection.diagnostics.length" :diagnostics="projection.diagnostics" />

        <p v-if="projection.sessions.length" class="text-xs text-ink-500">
          Assumes every set is completed at its target reps, AMRAP sets included. A missed session or a big AMRAP
          changes what comes next — the table follows your program, not the calendar.
        </p>
      </div>
    </div>
  </Teleport>
</template>
