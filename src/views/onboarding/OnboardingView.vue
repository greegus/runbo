<script setup lang="ts">
import { type Component, computed, defineAsyncComponent, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDialogStack } from 'vuiii'

import { seedDraftsFrom } from '@/onboarding/programSeed'
import type { LiftSeedDraft, StepId, ZonesDraft } from '@/onboarding/types'
import {
  advancePatch,
  completePatch,
  FIRST_STEP,
  LAST_STEP,
  normalizeStep,
  skipPatch,
  stepPatch,
} from '@/onboarding/wizard'
import { emptyZonesDraft, zonesDraftFrom } from '@/onboarding/zonesDraft'
import { useProfileStore } from '@/stores/profile'
import type { Profile } from '@/types'

const props = defineProps<{ step: string }>()

const router = useRouter()
const dialog = useDialogStack()
const profileStore = useProfileStore()

// Async so a step the user never reaches — the import path in particular, which
// pulls the whole Liftoscript parser in — is not in the first paint's bundle.
const STEP_COMPONENTS: Record<StepId, Component> = {
  0: defineAsyncComponent(() => import('@/views/onboarding/steps/WelcomeStep.vue')),
  1: defineAsyncComponent(() => import('@/views/onboarding/steps/GymStep.vue')),
  2: defineAsyncComponent(() => import('@/views/onboarding/steps/ProgramStep.vue')),
  3: defineAsyncComponent(() => import('@/views/onboarding/steps/CardioStep.vue')),
  4: defineAsyncComponent(() => import('@/views/onboarding/steps/ZonesStep.vue')),
  5: defineAsyncComponent(() => import('@/views/onboarding/steps/AvailabilityStep.vue')),
  6: defineAsyncComponent(() => import('@/views/onboarding/steps/ReviewStep.vue')),
}

const SAVE_FAILED = 'We couldn’t save that. Check your connection and try again.'

/**
 * The wizard's own copy of the profile, cloned from the live snapshot once and
 * never re-seeded. Re-seeding on every snapshot would look right until the
 * subscription echoed a save back mid-typing and stomped the field the user was
 * still in — the draft is the source of truth for the wizard's lifetime.
 */
const draft = shallowRef<Profile | null>(null)

// Never persisted (an age, a recent 5 km time), but held here rather than in the
// step so that stepping back and forward inside one session restores it.
const zonesDraft = ref<ZonesDraft>(emptyZonesDraft())

// Same reason as `zonesDraft`: the 5RM a lift was computed from is never
// persisted, and the step is remounted on every navigation.
const seedDrafts = ref<LiftSeedDraft[]>([])

const busy = ref(false)
const error = ref<string | null>(null)

const currentStep = computed(() => normalizeStep(props.step))
const stepComponent = computed(() => STEP_COMPONENTS[currentStep.value])

// Only the two steps with un-persistable inputs take an extra binding; passing
// them to every step would leave stray attributes on the ones that never
// declare them.
const stepProps = computed(() => {
  if (currentStep.value === 2) return { seedDrafts: seedDrafts.value }
  if (currentStep.value === 4) return { zonesDraft: zonesDraft.value }

  return {}
})

function toStep(step: StepId, replace = false): Promise<unknown> {
  const to = { name: 'onboarding', params: { step: String(step) } } as const

  return replace ? router.replace(to) : router.push(to)
}

async function next(): Promise<void> {
  const current = draft.value
  if (!current || busy.value) return

  const step = currentStep.value

  busy.value = true
  error.value = null

  try {
    if (step === LAST_STEP) {
      // Every slice was committed by its own step, so finishing is a single
      // field flip. The `await` matters: the guard only stops forcing the wizard
      // once the snapshot carrying `completed: true` has come back.
      await profileStore.save(completePatch())
      await router.replace({ name: 'today' })
      return
    }

    const nextStep = (step + 1) as StepId

    // Forward-only: Review's Edit links drop the user back onto an earlier step,
    // and writing that step's successor would rewind `onboarding.step` — the
    // value the router guard resumes at — behind the work already committed.
    const committed = profileStore.profile?.onboarding.step ?? nextStep
    const furthest = normalizeStep(Math.max(nextStep, committed))

    // One write, not two: a crash between a slice write and a step write would
    // resume the user past data that was never saved.
    await profileStore.save({ ...stepPatch(step, current), ...advancePatch(furthest) })
    await toStep(nextStep)
  } catch {
    // The step does not advance and the draft stays on screen, so nothing the
    // user typed is lost to a failed write.
    error.value = SAVE_FAILED
  } finally {
    busy.value = false
  }
}

/**
 * Pure navigation. Back writes nothing, so `onboarding.step` keeps recording the
 * furthest *committed* step — which is the only sensible place to resume.
 */
function back(): void {
  if (busy.value) return

  const step = currentStep.value
  if (step === FIRST_STEP) return

  void toStep((step - 1) as StepId)
}

async function skip(): Promise<void> {
  if (busy.value) return

  const confirmed = await dialog.confirm({
    title: 'Skip setup?',
    content:
      'We’ll start you on GZCLP with no weights set — we’ll ask you at the gym — and a 2 × 30 min cardio baseline. You can change all of it in Settings.',
    confirmLabel: 'Skip setup',
  })

  if (!confirmed) return

  busy.value = true
  error.value = null

  try {
    // No slice is written: `createDefaultProfile` already put the documented
    // skip defaults in Firestore, and re-sending a half-filled draft would be
    // the opposite of accepting them.
    await profileStore.save(skipPatch())
    await router.replace({ name: 'today' })
  } catch {
    error.value = SAVE_FAILED
  } finally {
    busy.value = false
  }
}

// The guard holds the first navigation until the profile lands, but a reload
// straight onto /onboarding/3 can still render before the snapshot arrives.
watch(
  () => profileStore.profile,
  (profile) => {
    if (!profile || draft.value) return

    draft.value = structuredClone(profile)
    zonesDraft.value = zonesDraftFrom(profile.cardioTrack.zones)
    seedDrafts.value = seedDraftsFrom(profile.strengthTrack.programState, profile.settings.units)
  },
  { immediate: true },
)

// The route has no numeric constraint and the guard passes any /onboarding/*
// URL straight through, so a typo'd or out-of-range step is corrected here —
// canonicalising the URL rather than rendering an empty shell.
watch(
  () => props.step,
  (step) => {
    if (String(normalizeStep(step)) !== step) void toStep(normalizeStep(step), true)
  },
  { immediate: true },
)
</script>

<template>
  <p v-if="!draft" class="flex h-full items-center justify-center p-4 text-ink-500" role="status">Loading…</p>

  <component
    :is="stepComponent"
    v-else
    v-model="draft"
    v-bind="stepProps"
    :busy="busy"
    :error="error"
    @update:zones-draft="zonesDraft = $event"
    @update:seed-drafts="seedDrafts = $event"
    @next="next"
    @back="back"
    @skip="skip"
  />
</template>
