<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, Card, Icon, useDialogStack } from 'vuiii'

import ProgramEditor from '@/components/program/ProgramEditor.vue'
import ProgramStateTable from '@/components/program/ProgramStateTable.vue'
import { mergeProgramState, variationCounts } from '@/import/mergeProgramState'
import { adoptProgramText } from '@/import/programText'
import { parseProgram } from '@/liftoscript/parser'
import { serializeProgram } from '@/liftoscript/serialize'
import { useProfileStore } from '@/stores/profile'

/**
 * The program text, its diagnostics, and what the app currently thinks the
 * athlete lifts.
 *
 * Two rules shape the save:
 *
 * 1. A program that does not adopt is NOT written. The session screen
 *    prescribes from this text; a program with an error diagnostic prescribes
 *    nothing, and an athlete who saved one would be stuck at the gym with no
 *    way back except retyping. The button is disabled AND says why.
 * 2. Saving merges `programState`, never wipes it. `adoptProgramText` re-seeds
 *    every lift from the text, so writing its state verbatim would reset eight
 *    weeks of progression on a one-word edit. `mergeProgramState` keeps what
 *    exists, seeds what is new, and names what is about to be dropped — the
 *    drop is confirmed before the write, not discovered after it.
 */

const profileStore = useProfileStore()
const dialog = useDialogStack()

const profile = computed(() => profileStore.profile)

const draft = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const justSaved = ref(false)

const dirty = computed(() => draft.value !== (profile.value?.strengthTrack.programText ?? ''))

/**
 * Re-seeds from the live snapshot only while the draft is clean — Settings'
 * rule, for the same reason: this document is still being listened to, and a
 * snapshot arriving mid-edit (our own save echoing back, another device) must
 * not overwrite what is being typed.
 */
watch(
  profile,
  (next) => {
    if (!next) return
    if (!dirty.value) draft.value = next.strengthTrack.programText
  },
  { immediate: true },
)

/** One parse for the whole screen: adoption already carries the parser's diagnostics, in order. */
const adoption = computed(() => adoptProgramText(draft.value))

const errorCount = computed(
  () => adoption.value.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
)

const merge = computed(() =>
  mergeProgramState(profile.value?.strengthTrack.programState ?? {}, adoption.value.programState, {
    variationCounts: variationCounts(adoption.value.program),
  }),
)

/** What is on the screen NOW, parsed — the state table describes the saved program, not the draft. */
const savedProgram = computed(() => {
  const text = profile.value?.strengthTrack.programText
  if (!text) return null

  const { program, diagnostics } = parseProgram(text)
  // A saved program that no longer parses cannot prescribe; showing what it
  // "would" prescribe from a partial AST would be a confident guess.
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? null : program
})

const canSave = computed(() => dirty.value && adoption.value.adopted)

const blockedReason = computed(() => {
  if (!dirty.value) return null
  if (adoption.value.adopted) return null

  return errorCount.value > 0
    ? 'Fix the errors above before saving — a program with errors can’t prescribe anything.'
    : 'Fix the errors or warnings above before saving — a program we can’t fully read can’t prescribe anything.'
})

const canFormat = computed(() => errorCount.value === 0 && draft.value.trim().length > 0)

/** What this save will do to the state, in words, before it happens. */
const saveSummary = computed(() => {
  const { kept, seeded, dropped } = merge.value
  const parts: string[] = []

  if (kept.length > 0) {
    parts.push(`${kept.length} ${kept.length === 1 ? 'lift keeps' : 'lifts keep'} the weight and stage you trained to`)
  }
  if (seeded.length > 0) {
    parts.push(
      `${seeded.length} new ${seeded.length === 1 ? 'lift starts' : 'lifts start'} from the weights in the text`,
    )
  }
  if (dropped.length > 0) {
    parts.push(
      `${dropped.join(', ')} ${dropped.length === 1 ? 'is' : 'are'} no longer in the program and ${
        dropped.length === 1 ? 'loses its' : 'lose their'
      } state`,
    )
  }

  return parts.length > 0 ? `Saving: ${parts.join('; ')}.` : null
})

/**
 * DECISION: formatting is an explicit action, never applied on save. The
 * athlete's own text is stored verbatim — `adoptProgramText` guarantees that —
 * and silently rewriting a program someone pasted from elsewhere is how the
 * text they recognise stops matching the text they see.
 */
function formatProgram(): void {
  if (!canFormat.value) return

  draft.value = serializeProgram(parseProgram(draft.value).program)
}

function revert(): void {
  draft.value = profile.value?.strengthTrack.programText ?? ''
  error.value = null
}

async function save(): Promise<void> {
  // vuiii's `disabled` is CSS-only — the button stays tabbable and Enter still
  // fires @click, so the guard has to be on the handler as well.
  if (!canSave.value || busy.value) return

  // Set before the await: the dialog is an async gap, and a second activation
  // would otherwise queue a second save of a draft that has moved on.
  busy.value = true
  error.value = null
  justSaved.value = false

  const confirmedDrops = merge.value.dropped

  if (confirmedDrops.length > 0) {
    const ok = await dialog.confirm({
      title:
        confirmedDrops.length === 1
          ? 'One lift will lose its state'
          : `${confirmedDrops.length} lifts will lose their state`,
      content: `${confirmedDrops.join(', ')} ${
        confirmedDrops.length === 1 ? 'is' : 'are'
      } no longer in this program, so their working weights and stages are removed. Everything still in the program keeps what it has earned. There is no undo.`,
      confirmLabel: 'Save program',
    })

    if (!ok) {
      busy.value = false
      return
    }
  }

  // Read AFTER the dialog: `profile` is replaced wholesale by every snapshot and
  // `save` is `updateDoc`, which replaces `strengthTrack` wholesale. A session
  // finishing on another device while the dialog was open moves both
  // `programState` and `rotationCursor`; writing the pre-dialog slice back would
  // silently undo it.
  const live = profileStore.profile
  if (!live) {
    busy.value = false
    return
  }

  const result = merge.value

  if (result.dropped.join(' ') !== confirmedDrops.join(' ')) {
    // What was confirmed is no longer what would be written.
    busy.value = false
    error.value = 'Your program changed on another device while we were asking. Check the summary and save again.'
    return
  }

  try {
    // Rebuilt from the live slice: anything of `strengthTrack` not named here
    // (the goal, the rotation cursor) has to be carried over explicitly.
    await profileStore.save({
      strengthTrack: {
        ...live.strengthTrack,
        programText: adoption.value.programText,
        programState: result.programState,
      },
    })
    justSaved.value = true
  } catch (saveError) {
    console.error('[program] save failed', saveError)
    error.value = 'We couldn’t save that. Check your connection and try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="mx-auto flex max-w-lg flex-col gap-4 p-4">
    <header>
      <h1 class="text-2xl font-bold text-ink-900">Program</h1>
      <p class="mt-1 text-sm text-ink-500">
        The workout text the app prescribes from, and the weights it has you on right now.
      </p>
    </header>

    <p v-if="!profile" class="py-8 text-center text-ink-500" role="status">Loading…</p>

    <template v-else>
      <Card title="Program text">
        <div class="flex flex-col gap-4">
          <ProgramEditor v-model="draft" :diagnostics="adoption.diagnostics" label="Liftoscript" />

          <div class="flex flex-wrap gap-2">
            <Button
              label="Format"
              variant="outlined"
              color="secondary"
              class="min-h-[48px]"
              :disabled="!canFormat"
              :aria-disabled="!canFormat"
              @click="formatProgram()"
            />
            <Button
              v-if="dirty"
              label="Discard changes"
              variant="outlined"
              color="secondary"
              class="min-h-[48px]"
              @click="revert()"
            />
          </div>

          <!-- A disabled Save with nothing next to it is a dead end: whatever
               blocks the write has to say so in words. -->
          <p
            v-if="blockedReason"
            role="status"
            class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-700"
          >
            {{ blockedReason }}
          </p>

          <p
            v-else-if="dirty && saveSummary"
            role="status"
            class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-700"
          >
            {{ saveSummary }}
          </p>

          <p v-if="error" role="alert" class="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm">{{ error }}</p>

          <div class="flex items-center justify-between gap-4 border-t border-ink-200 pt-4">
            <p class="text-sm" role="status">
              <span v-if="dirty" class="text-accent-600">Unsaved changes</span>
              <span v-else-if="justSaved" class="inline-flex items-center gap-1 text-ink-500">
                <Icon name="check" />
                Saved
              </span>
            </p>

            <Button
              label="Save program"
              size="large"
              class="min-h-[56px]"
              :disabled="!canSave"
              :aria-disabled="!canSave"
              :loading="busy"
              @click="save()"
            />
          </div>
        </div>
      </Card>

      <Card title="Current state">
        <div class="flex flex-col gap-3">
          <p class="text-sm text-ink-500">
            What the app has you lifting today. These numbers move when you train — they are not edited here.
          </p>

          <p
            v-if="savedProgram === null && Object.keys(profile.strengthTrack.programState).length"
            class="text-sm text-accent-700"
          >
            Your saved program text no longer reads cleanly, so we can’t show what comes next. The weights below are
            still yours.
          </p>

          <ProgramStateTable
            :program-state="profile.strengthTrack.programState"
            :program="savedProgram"
            :settings="profile.settings"
          />
        </div>
      </Card>
    </template>
  </section>
</template>
