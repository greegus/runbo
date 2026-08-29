<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { Button, FormGroup, Icon, Select } from 'vuiii'

import DerivedStateTable from '@/components/program/DerivedStateTable.vue'
import ImportHistoryForm from '@/components/program/ImportHistoryForm.vue'
import ImportPasteForm from '@/components/program/ImportPasteForm.vue'
import ProgramForm from '@/components/settings/ProgramForm.vue'
import { deriveState, type DerivedState } from '@/import/deriveState'
import type { ImportResult } from '@/import/liftosaurHistory'
import { parseProgram } from '@/liftoscript/parser'
import { CURSOR_SOURCE_COPY, SUSPECT_CURSOR_COPY } from '@/onboarding/deriveCopy'
import { applyRowEdits, buildCursorRow, buildDerivedRows } from '@/onboarding/derivedRows'
import { strengthTrackFromAdoption, strengthTrackFromDrafts } from '@/onboarding/programSeed'
import type { CursorRow, DerivedRow, LiftSeedDraft } from '@/onboarding/types'
import { saveSession } from '@/services/sessionsService'
import { GZCLP_ROTATION, programDayAt } from '@/training/gzclp'
import type { ExerciseState, Profile } from '@/types'
import StepShell from '@/views/onboarding/steps/StepShell.vue'

const props = withDefaults(
  defineProps<{
    modelValue: Profile
    // Owned by the wizard, not by this step: the step is remounted on every
    // navigation, and a 5RM that was typed but never computed would otherwise be
    // gone the moment the athlete stepped back to check something.
    seedDrafts: LiftSeedDraft[]
    busy?: boolean
    error?: string | null
  }>(),
  { busy: false, error: null },
)

const emit = defineEmits<{
  'update:modelValue': [value: Profile]
  'update:seedDrafts': [value: LiftSeedDraft[]]
  next: []
  back: []
  skip: []
}>()

interface Adopted {
  programText: string
  programState: Record<string, ExerciseState>
  source: 'paste' | 'fallback'
}

const path = ref<'choose' | 'fresh' | 'import'>('choose')

// DECISION: the paste box starts empty rather than pre-filled with the profile's
// programText. A fresh profile already carries the built-in GZCLP source, and
// showing it here would read as "you have already pasted something" to an
// athlete who has pasted nothing.
const pasteText = ref('')
const adopted = ref<Adopted | null>(null)
const importResult = ref<ImportResult | null>(null)
// shallowRef, not ref: the derived state is written straight to Firestore on
// accept, and a deep reactive proxy would put Proxy objects into the document
// payload rather than the plain `ExerciseState` shapes the services expect.
const derived = shallowRef<DerivedState | null>(null)
const rows = ref<DerivedRow[]>([])
const cursorRow = ref<CursorRow | null>(null)
const cursorValue = ref(0)
const localError = ref<string | null>(null)
const saving = ref(false)

const sessions = computed(() => importResult.value?.sessions ?? [])

/**
 * The picker offers the four GZCLP days, never the pasted program's day list.
 * `rotationCursor` is read by the composer as an index into `GZCLP_ROTATION`
 * (`planWeek` always hands it that array), so offering the twelve days of a
 * three-week paste would let the athlete pick a day the scheduler silently
 * wraps into a different one.
 */
const cursorOptions = GZCLP_ROTATION.map((name, index) => ({ value: index, label: name }))

// Derived from the live selection rather than from `cursorRow.nextProgramDay`,
// which is a one-shot derivation and would go stale the moment the Select moves.
const nextDayLabel = computed(() => programDayAt(cursorValue.value))

// The paste has more days than the rotation the composer schedules, so the
// four-day answer needs explaining rather than quietly truncating.
const cursorIsFolded = computed(() => (cursorRow.value?.dayNames.length ?? 0) > GZCLP_ROTATION.length)

// A first-run profile already carries the built-in GZCLP, but the athlete has
// not chosen anything yet — `onboarding.step` is the furthest step the wizard
// committed, and the draft is cloned once, so > 2 means step 2 was already done.
const hasCommittedProgram = computed(() => props.modelValue.onboarding.step > 2)

const nextDisabled = computed(() => {
  // Re-entering the step resets the path, and forcing a re-choice there would
  // mean rebuilding the track — which on the fresh path overwrites an imported
  // program's text with the built-in GZCLP.
  if (path.value === 'choose') return !hasCommittedProgram.value
  if (path.value === 'import') return adopted.value === null
  return false
})

const nextLabel = computed(() => (derived.value ? 'Save this and continue' : 'Continue'))

/**
 * The derivation is re-run whenever the adopted program or the imported history
 * changes. It never throws, so there is nothing to guard — but it is deliberately
 * NOT a computed: the rows it produces are edited, and a computed would throw
 * every edit away on the next unrelated re-render.
 */
watch([adopted, sessions], ([program, history]) => {
  if (!program || history.length === 0) {
    derived.value = null
    rows.value = []
    cursorRow.value = null
    return
  }

  const state = deriveState({
    sessions: history,
    programText: program.programText,
    settings: props.modelValue.settings,
    baseProgramState: program.programState,
  })

  // `deriveState` does not hand back the program it parsed, so the day names the
  // cursor picker needs have to be recovered from the same text.
  const { program: parsed } = parseProgram(program.programText)

  derived.value = state
  rows.value = buildDerivedRows(state, state.programState, parsed)
  cursorRow.value = buildCursorRow(state, parsed)
  cursorValue.value = state.rotationCursor
})

/**
 * Leaving the import path abandons the import. Without this the parsed history
 * stays in `importResult`, and `onNext` would write every imported session to
 * Firestore while `strengthTrackToSave` seeded the track from the fresh-GZCLP
 * form as if there were no history at all.
 */
watch(path, (next) => {
  if (next === 'import') return

  importResult.value = null
  adopted.value = null
  pasteText.value = ''
  derived.value = null
  rows.value = []
  cursorRow.value = null
  cursorValue.value = 0
  localError.value = null
})

function onAdopt(value: Adopted): void {
  adopted.value = value
  localError.value = null
}

function strengthTrackToSave() {
  const base = props.modelValue.strengthTrack

  if (path.value === 'fresh') {
    return strengthTrackFromDrafts(props.seedDrafts, base, props.modelValue.settings.units)
  }

  const program = adopted.value
  if (!program) return base

  // Re-pasting the program without re-uploading the history leaves no derivation
  // to read a cursor from — keeping the committed one, rather than resetting to
  // 0, is what stops a second visit from restarting the rotation at A1.
  if (!derived.value) return strengthTrackFromAdoption(program, base, base.rotationCursor)

  return {
    ...strengthTrackFromAdoption(program, base, cursorValue.value),
    programState: applyRowEdits(rows.value, derived.value.programState),
  }
}

/**
 * Sessions first, then the profile — and the profile write is the parent's, on
 * `next`. A crash between the two leaves the account with the history and the
 * wizard still on this step: re-running the import overwrites the same ids, so
 * nothing duplicates and nothing is lost. The reverse order would persist a
 * program state derived from history that was never saved.
 */
async function onNext(): Promise<void> {
  localError.value = null

  // Nothing was chosen on this visit: the strengthTrack the previous visit
  // committed passes through untouched. Rebuilding it from the fresh-GZCLP
  // drafts would overwrite an imported program's text with the built-in one.
  if (path.value === 'choose') {
    emit('next')
    return
  }

  if (sessions.value.length > 0) {
    saving.value = true
    try {
      // `merge: true` with the ids the mapper derives from the Liftosaur record:
      // importing the same export twice overwrites instead of duplicating.
      await Promise.all(sessions.value.map((session) => saveSession(session, false)))
    } catch {
      localError.value = 'We couldn’t save your imported workouts. Check your connection and try again.'
      return
    } finally {
      saving.value = false
    }
  }

  emit('update:modelValue', { ...props.modelValue, strengthTrack: strengthTrackToSave() })
  emit('next')
}
</script>

<template>
  <StepShell
    :step="2"
    title="Your program"
    description="Bring the program you are already running, or start fresh on GZCLP."
    :busy="busy || saving"
    :error="error ?? localError"
    :next-disabled="nextDisabled"
    :next-label="nextLabel"
    @next="onNext()"
    @back="$emit('back')"
    @skip="$emit('skip')"
  >
    <!-- The two paths are offered as equals. An athlete arriving with three
         years of Liftosaur history and one arriving with none are both first-
         class users, and a default selection would make one of them feel like
         the exception. -->
    <div v-if="path === 'choose'" class="flex flex-col gap-4">
      <!-- Only offered once a program has actually been committed: on a first
           visit there is nothing to keep, and Continue is disabled until one of
           the two paths is picked. -->
      <Button
        v-if="hasCommittedProgram"
        variant="text"
        class="min-h-[48px] self-start"
        label="Keep the program I already set up"
        @click="onNext()"
      />

      <button
        type="button"
        class="flex min-h-[48px] flex-col gap-1 rounded-lg border border-ink-200 p-4 text-left"
        @click="path = 'import'"
      >
        <span class="flex items-center gap-2 text-base font-semibold text-ink-900">
          <Icon name="history" class="text-accent-600" />
          Continue from Liftosaur
        </span>
        <span class="text-sm text-ink-500">
          Paste your program text, and optionally your JSON history export. We work out the weight and the stage you are
          on, and you confirm every number before anything is saved.
        </span>
      </button>

      <button
        type="button"
        class="flex min-h-[48px] flex-col gap-1 rounded-lg border border-ink-200 p-4 text-left"
        @click="path = 'fresh'"
      >
        <span class="flex items-center gap-2 text-base font-semibold text-ink-900">
          <Icon name="dumbbell" class="text-accent-600" />
          Start fresh with GZCLP
        </span>
        <span class="text-sm text-ink-500">
          Four days, ten lifts. Tell us the weight you are working with for each — or leave it empty and we’ll ask you
          at the gym.
        </span>
      </button>
    </div>

    <div v-else class="flex flex-col gap-6">
      <div>
        <Button
          variant="text"
          prefix-icon="chevron-left"
          class="min-h-[48px]"
          label="Choose a different way to start"
          @click="path = 'choose'"
        />
      </div>

      <ProgramForm
        v-if="path === 'fresh'"
        :model-value="seedDrafts"
        :settings="modelValue.settings"
        @update:model-value="$emit('update:seedDrafts', $event)"
      />

      <template v-else>
        <ImportPasteForm v-model="pasteText" :settings="modelValue.settings" @adopt="onAdopt" />

        <template v-if="adopted">
          <p class="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm text-ink-700">
            <Icon name="check" class="mt-0.5 shrink-0 text-accent-600" />
            <span>
              {{
                adopted.source === 'paste'
                  ? 'We’ll run your program exactly as you pasted it.'
                  : 'We’ll run the built-in GZCLP with the weights we read from your paste.'
              }}
            </span>
          </p>

          <ImportHistoryForm :uid="modelValue.id" :units="modelValue.settings.units" @result="importResult = $event" />
        </template>

        <template v-if="derived && cursorRow">
          <!-- The cursor sits above the table, on its own: it is a different kind
               of answer from a per-lift weight, and burying it in the list is how
               an athlete ends up starting the week on the wrong day. -->
          <section class="flex flex-col gap-3 rounded-lg border border-ink-200 p-4">
            <h3 class="text-base font-semibold text-ink-900">Where you are in the rotation</h3>

            <p class="text-sm text-ink-700">
              Your next workout is <strong>{{ nextDayLabel }}</strong
              >.
            </p>

            <p v-if="cursorIsFolded" class="text-sm text-ink-500">
              Your program has {{ cursorRow.dayNames.length }} days written out, but runbo plans the rotation as the
              four GZCLP days — pick the one you are on.
            </p>

            <FormGroup label="Next workout">
              <template #default="{ id }">
                <Select :id="id" v-model="cursorValue" class="min-h-[48px]" type="number" :options="cursorOptions" />
              </template>
            </FormGroup>

            <p v-if="cursorRow.confidence !== 'certain'" class="text-sm text-ink-500">
              {{ CURSOR_SOURCE_COPY[cursorRow.source] }}
            </p>

            <!-- Shown even when the confidence is `certain`: a session labelled A1
                 that logged none of A1's lifts makes the label itself worthless. -->
            <p v-if="cursorRow.suspect" role="alert" class="flex gap-3 text-sm text-ink-700">
              <Icon name="alert" class="mt-0.5 shrink-0 text-accent-600" />
              <span>{{ SUSPECT_CURSOR_COPY.replace('{day}', cursorRow.lastProgramDay ?? 'a day') }}</span>
            </p>
          </section>

          <DerivedStateTable v-model="rows" :report="derived.report" :settings="modelValue.settings" />
        </template>
      </template>
    </div>
  </StepShell>
</template>
