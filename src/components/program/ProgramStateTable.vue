<script setup lang="ts">
import { computed } from 'vue'

import DiagnosticsList from '@/components/DiagnosticsList.vue'
import PlateHint from '@/components/strength/PlateHint.vue'
import { variationCounts } from '@/import/mergeProgramState'
import { prescribe } from '@/liftoscript/evaluator'
import type { PrescribedSet, Program } from '@/liftoscript/types'
import { format } from '@/liftoscript/weight'
import { evalContextFromSettings } from '@/training/plates'
import type { ExerciseState, Profile, WeightValue } from '@/types'

/**
 * What the app thinks the athlete is lifting, read-only.
 *
 * This is NOT `DerivedStateTable`: that one edits `DerivedRow[]` during the
 * import flow, where every number is a guess awaiting confirmation. Here every
 * number is already the truth the engine prescribes from, so nothing on this
 * screen is editable — the way to change a working weight is to lift.
 *
 * Every value comes out of a pure module: `prescribe` for the sets,
 * `variationCounts` for the stage count, `format`/`PlateHint` for the weight.
 * The component decides nothing.
 */
const props = withDefaults(
  defineProps<{
    programState: Record<string, ExerciseState>
    /** `null` when the saved text does not parse — then only the stored state is shown. */
    program: Program | null
    settings: Profile['settings']
    week?: number
    day?: number
  }>(),
  { week: 1, day: 1 },
)

interface StateRow {
  key: string
  state: ExerciseState
  /** The working weight the progression has arrived at, or null while unknown. */
  weight: WeightValue | null
  stage: number
  stageCount: number | null
  askWeight: boolean
  sets: PrescribedSet[]
  diagnostics: ReturnType<typeof prescribe>['diagnostics']
}

const counts = computed(() => (props.program ? variationCounts(props.program) : {}))

const rows = computed<StateRow[]>(() =>
  Object.keys(props.programState)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const state = props.programState[key]
      const program = props.program
      // The stage the app will actually use, not a slot the program no longer
      // has: `variationOf` clamps the index, so showing the raw number would
      // claim a stage the athlete is not on.
      const stageCount = counts.value[key] ?? null
      const result = program
        ? prescribe(program, key, state, evalContextFromSettings(props.settings, { week: props.week, day: props.day }))
        : null

      return {
        key,
        state,
        weight: state.weights[0] ?? null,
        stage: stageCount ? Math.min(Math.max(state.setVariationIndex, 1), stageCount) : state.setVariationIndex,
        stageCount,
        askWeight: state.askWeight === true || state.weights.length === 0,
        sets: result?.sets ?? [],
        diagnostics: result?.diagnostics ?? [],
      }
    }),
)

/** `3+` for an AMRAP set, `8-12` for a range — the reps as the program writes them. */
function repsLabel(set: PrescribedSet): string {
  const reps = set.minReps === undefined ? `${set.reps}` : `${set.minReps}-${set.reps}`
  return set.isAmrap ? `${reps}+` : reps
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p v-if="rows.length === 0" class="text-sm text-ink-500">
      No lifts yet — paste or write your program above and save.
    </p>

    <ul v-else role="list" class="flex flex-col gap-3">
      <li v-for="row in rows" :key="row.key" class="flex flex-col gap-2 rounded-lg border border-ink-200 p-3">
        <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 class="font-semibold text-ink-900">{{ row.key }}</h3>

          <!-- vuiii ships no Badge, so the stage pill is hand-rolled like the
               ones in WeekPreview and DiagnosticsList. -->
          <span
            v-if="row.stageCount !== null && row.stageCount > 1"
            class="rounded border border-ink-300 px-2 py-0.5 text-xs font-semibold text-ink-700"
          >
            Stage {{ row.stage }} of {{ row.stageCount }}
          </span>
        </div>

        <p v-if="row.weight" class="text-2xl font-semibold tabular-nums text-ink-900">{{ format(row.weight) }}</p>
        <p v-else class="text-sm text-ink-500">No working weight yet.</p>

        <PlateHint v-if="row.weight" :weight="row.weight" :settings="settings" />

        <p v-if="row.askWeight" class="text-sm text-accent-700">We'll ask you for this weight at the gym.</p>

        <div v-if="row.sets.length" class="flex flex-col gap-1">
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Next session</p>

          <ul role="list" class="flex flex-wrap gap-1.5">
            <li
              v-for="(set, index) in row.sets"
              :key="index"
              class="rounded bg-ink-50 px-2 py-1 text-sm tabular-nums text-ink-700"
            >
              {{ repsLabel(set) }} × {{ set.askWeight ? '?' : format(set.weight) }}
            </li>
          </ul>
        </div>

        <!-- A lift the program no longer mentions still has state, and
             `prescribe` says so in words. Hiding that would leave a weight on
             screen that nothing will ever prescribe. -->
        <DiagnosticsList v-if="row.diagnostics.length" :diagnostics="row.diagnostics" />
      </li>
    </ul>
  </div>
</template>
