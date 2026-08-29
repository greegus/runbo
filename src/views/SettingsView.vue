<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, Card, FormGroup, Icon, Input, useSubmitAction } from 'vuiii'

import AvailabilityForm from '@/components/settings/AvailabilityForm.vue'
import CardioForm from '@/components/settings/CardioForm.vue'
import GymForm from '@/components/settings/GymForm.vue'
import ZonesForm from '@/components/settings/ZonesForm.vue'
import type { Availability, CardioTrack, CardioZones, GymSettings, ZonesDraft } from '@/onboarding/types'
import { emptyZonesDraft, zonesDraftFrom } from '@/onboarding/zonesDraft'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'

const authStore = useAuthStore()
const profileStore = useProfileStore()

const profile = computed(() => profileStore.profile)

/** The timers and the comeback threshold are one visual section but two fields. */
interface TimersDraft {
  restTimers: { t1: number; t2: number; t3: number }
  comebackGapDays: number
}

const gymDraft = ref<GymSettings | null>(null)
const gymValid = ref(true)

const timersDraft = ref<TimersDraft | null>(null)

const cardioDraft = ref<CardioTrack | null>(null)
const cardioValid = ref(true)

const zonesValue = ref<CardioZones | undefined>(undefined)
const zonesDraft = ref<ZonesDraft>(emptyZonesDraft())

const availabilityDraft = ref<Availability | null>(null)
const availabilityValid = ref(true)

/**
 * Structural equality by serialisation, with object keys sorted first: key order
 * alone must never read as a change. `zonesValue` is rebuilt by `zonesFromDraft`
 * in its own literal order (`hr` as `{ max, lthr }`) while the live document
 * comes back from Firestore with map keys in lexicographic order (`{ lthr, max
 * }`) — without this the zones section would pin itself permanently dirty and
 * the re-seed watcher below would stop accepting snapshots. Arrays keep their
 * order, so `plates` and `preferredDays` still compare positionally.
 */
function stableKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableKeys)

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>

    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, stableKeys(source[key])]),
    )
  }

  return value
}

function differs(a: unknown, b: unknown): boolean {
  return JSON.stringify(stableKeys(a ?? null)) !== JSON.stringify(stableKeys(b ?? null))
}

const gymDirty = computed(() => {
  const live = profile.value?.settings
  const draft = gymDraft.value
  if (!live || !draft) return false

  return differs(
    { units: draft.units, barbellWeight: draft.barbellWeight, plates: draft.plates },
    { units: live.units, barbellWeight: live.barbellWeight, plates: live.plates },
  )
})

const timersDirty = computed(() => {
  const live = profile.value?.settings
  const draft = timersDraft.value
  if (!live || !draft) return false

  return differs(draft, { restTimers: live.restTimers, comebackGapDays: live.comebackGapDays })
})

const cardioDirty = computed(() => {
  const live = profile.value?.cardioTrack
  const draft = cardioDraft.value
  if (!live || !draft) return false

  return differs(
    {
      modalities: draft.modalities,
      weeklyMinutes: draft.weeklyMinutes,
      longestSessionMinutes: draft.longestSessionMinutes,
    },
    {
      modalities: live.modalities,
      weeklyMinutes: live.weeklyMinutes,
      longestSessionMinutes: live.longestSessionMinutes,
    },
  )
})

const zonesDirty = computed(() => {
  const live = profile.value?.cardioTrack
  if (!live) return false

  return differs(zonesValue.value, live.zones)
})

/**
 * Whether re-seeding the zones draft from a snapshot would destroy typing.
 * `zonesDirty` cannot answer this: an age, a recent effort and every half-filled
 * pair collapse into the same stored number (or into none at all), so a section
 * can be perfectly clean while the draft holds input no snapshot could rebuild.
 * Kept apart from `zonesDirty` on purpose — `zonesDraftFrom` is a deliberate
 * one-way trip (an age comes back as a measured max), so folding this into the
 * dirty flag would leave the section reading "Unsaved changes" forever.
 */
const zonesDraftUnrecoverable = computed(() => differs(zonesDraft.value, zonesDraftFrom(zonesValue.value)))

const availabilityDirty = computed(() => {
  const live = profile.value?.availability
  const draft = availabilityDraft.value
  if (!live || !draft) return false

  return differs(draft, live)
})

// Timers are seconds and the threshold is whole days; both only have to be
// numbers the app can count with. Anything beyond that (what a sane rest is)
// is not a rule this view gets to invent.
const timersValid = computed(() => {
  const draft = timersDraft.value
  if (!draft) return false

  const seconds = [draft.restTimers.t1, draft.restTimers.t2, draft.restTimers.t3]

  return seconds.every((value) => Number.isFinite(value) && value >= 0) && draft.comebackGapDays >= 1
})

/**
 * Re-seeds a section from the live snapshot only while it is clean. Settings
 * edits a document that is still being listened to, so a snapshot arriving
 * mid-edit (our own save echoing back, another device, an offline replay) must
 * not overwrite what the user is typing — but it must land in every section
 * they are not touching, or a stale draft would be saved back over it later.
 */
watch(
  profile,
  (next) => {
    if (!next) return

    if (!gymDirty.value) gymDraft.value = structuredClone(next.settings)
    if (!timersDirty.value) {
      timersDraft.value = structuredClone({
        restTimers: next.settings.restTimers,
        comebackGapDays: next.settings.comebackGapDays,
      })
    }
    if (!cardioDirty.value) cardioDraft.value = structuredClone(next.cardioTrack)
    if (!zonesDirty.value && !zonesDraftUnrecoverable.value) {
      zonesValue.value = next.cardioTrack.zones ? structuredClone(next.cardioTrack.zones) : undefined
      zonesDraft.value = zonesDraftFrom(next.cardioTrack.zones)
    }
    if (!availabilityDirty.value) availabilityDraft.value = structuredClone(next.availability)
  },
  { immediate: true },
)

/**
 * Every patch is rebuilt from the LIVE slice with only the fields this section
 * owns laid over it. Two sections share `settings` (gym and rest timers) and
 * two share `cardioTrack` (cardio and zones), and `updateDoc` replaces a nested
 * object wholesale — so saving a whole draft slice would silently republish the
 * other section's values as they stood when its draft was seeded.
 */
async function saveGym(): Promise<void> {
  const live = profile.value
  const draft = gymDraft.value
  if (!live || !draft) return

  await profileStore.save({
    settings: {
      ...live.settings,
      units: draft.units,
      barbellWeight: draft.barbellWeight,
      plates: draft.plates,
    },
  })
}

async function saveTimers(): Promise<void> {
  const live = profile.value
  const draft = timersDraft.value
  if (!live || !draft) return

  await profileStore.save({
    settings: { ...live.settings, restTimers: draft.restTimers, comebackGapDays: draft.comebackGapDays },
  })
}

async function saveCardio(): Promise<void> {
  const live = profile.value
  const draft = cardioDraft.value
  if (!live || !draft) return

  await profileStore.save({
    cardioTrack: {
      ...live.cardioTrack,
      modalities: draft.modalities,
      weeklyMinutes: draft.weeklyMinutes,
      longestSessionMinutes: draft.longestSessionMinutes,
    },
  })
}

async function saveZones(): Promise<void> {
  const live = profile.value
  if (!live) return

  const zones = zonesValue.value

  // Clearing the zones means the key must be ABSENT, not `undefined`: the whole
  // `cardioTrack` object is republished, so leaving the key out is what removes
  // it, and Firestore rejects an explicit `undefined` outright.
  const cardioTrack = { ...live.cardioTrack }
  delete cardioTrack.zones

  await profileStore.save({ cardioTrack: zones ? { ...cardioTrack, zones } : cardioTrack })
}

async function saveAvailability(): Promise<void> {
  const live = profile.value
  const draft = availabilityDraft.value
  if (!live || !draft) return

  await profileStore.save({ availability: draft })
}

const SAVE_ERROR = 'We couldn’t save that. Check your connection and try again.'

/**
 * One save button's state. `justSaved` is what turns an invisible write into a
 * visible one — the snackbar is gone in seconds and the section otherwise looks
 * exactly as it did while the change was still unsaved.
 */
function useSectionSave(action: () => Promise<void>, label: string) {
  const justSaved = ref(false)

  const { submit, isSubmitting } = useSubmitAction(action, {
    successMessage: `${label} saved.`,
    errorMessage: SAVE_ERROR,
    onSuccess: () => {
      justSaved.value = true
    },
  })

  return { submit, isSubmitting, justSaved }
}

const gymSave = useSectionSave(saveGym, 'Gym setup')
const timersSave = useSectionSave(saveTimers, 'Rest timers')
const cardioSave = useSectionSave(saveCardio, 'Cardio')
const zonesSave = useSectionSave(saveZones, 'Zones')
const availabilitySave = useSectionSave(saveAvailability, 'Availability')

const { submit: signOut, isSubmitting: isSigningOut } = useSubmitAction(() => authStore.signOut(), {
  errorMessage: 'Sign-out did not complete. Please try again.',
})

/** Lifts still waiting for their first weight — the ask-weight prompts Today shows. */
const programSummary = computed(() => {
  const state = profile.value?.strengthTrack.programState ?? {}
  const keys = Object.keys(state)
  const asking = keys.filter((key) => state[key].askWeight || state[key].weights.length === 0)

  return { total: keys.length, asking: asking.length }
})

function setTimer(tier: 't1' | 't2' | 't3', value: unknown): void {
  if (!timersDraft.value) return

  // An empty field emits null and a half-typed one can emit NaN; both would be
  // written straight into the document, where `restTimerFor` divides by them.
  const seconds = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

  timersDraft.value = { ...timersDraft.value, restTimers: { ...timersDraft.value.restTimers, [tier]: seconds } }
}

function setComebackGap(value: unknown): void {
  if (!timersDraft.value) return

  const days = typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.round(value) : 0

  timersDraft.value = { ...timersDraft.value, comebackGapDays: days }
}
</script>

<template>
  <section class="mx-auto flex max-w-lg flex-col gap-6 p-4">
    <header>
      <h1 class="text-2xl font-bold text-ink-900">Settings</h1>
      <p v-if="profile" class="mt-1 text-sm text-ink-500">{{ profile.email }}</p>
    </header>

    <!-- The profile arrives through a live subscription; binding the forms to a
         null slice would render a form full of empty fields that looks like a
         wiped profile. -->
    <p v-if="!profile" class="py-8 text-center text-ink-500" role="status">Loading…</p>

    <template v-else>
      <Card title="Gym">
        <div class="flex flex-col gap-6">
          <GymForm v-if="gymDraft" v-model="gymDraft" v-model:valid="gymValid" />

          <div class="flex items-center justify-between gap-4 border-t border-ink-200 pt-4">
            <p class="text-sm" role="status">
              <span v-if="gymDirty" class="text-accent-600">Unsaved changes</span>
              <span v-else-if="gymSave.justSaved.value" class="inline-flex items-center gap-1 text-ink-500">
                <Icon name="check" />
                Saved
              </span>
            </p>
            <Button
              label="Save"
              size="large"
              class="min-h-[48px]"
              :disabled="!gymDirty || !gymValid"
              :loading="gymSave.isSubmitting.value"
              @click="gymSave.submit()"
            />
          </div>
        </div>
      </Card>

      <Card title="Program">
        <div class="flex flex-col gap-4">
          <p class="text-sm text-ink-500">
            {{ programSummary.total }} lifts in your program,
            <template v-if="programSummary.asking > 0">
              {{ programSummary.asking }} still waiting for a first weight — we'll ask you at the gym.
            </template>
            <template v-else>all with a working weight.</template>
          </p>

          <Button
            label="Edit program"
            variant="outlined"
            size="large"
            block
            class="min-h-[48px]"
            :to="{ name: 'program' }"
          />
        </div>
      </Card>

      <Card title="Rest timers">
        <div class="flex flex-col gap-6">
          <p class="text-sm text-ink-500">How long the timer runs between sets, per tier. Seconds.</p>

          <div class="grid grid-cols-3 gap-3">
            <FormGroup v-if="timersDraft" label="T1">
              <template #default="{ id }">
                <Input
                  :id="id"
                  type="number"
                  value-as-number
                  inputmode="numeric"
                  min="0"
                  step="15"
                  size="large"
                  class="min-h-[48px] text-xl font-semibold tabular-nums"
                  :model-value="timersDraft.restTimers.t1"
                  @update:model-value="setTimer('t1', $event)"
                />
              </template>
            </FormGroup>

            <FormGroup v-if="timersDraft" label="T2">
              <template #default="{ id }">
                <Input
                  :id="id"
                  type="number"
                  value-as-number
                  inputmode="numeric"
                  min="0"
                  step="15"
                  size="large"
                  class="min-h-[48px] text-xl font-semibold tabular-nums"
                  :model-value="timersDraft.restTimers.t2"
                  @update:model-value="setTimer('t2', $event)"
                />
              </template>
            </FormGroup>

            <FormGroup v-if="timersDraft" label="T3">
              <template #default="{ id }">
                <Input
                  :id="id"
                  type="number"
                  value-as-number
                  inputmode="numeric"
                  min="0"
                  step="15"
                  size="large"
                  class="min-h-[48px] text-xl font-semibold tabular-nums"
                  :model-value="timersDraft.restTimers.t3"
                  @update:model-value="setTimer('t3', $event)"
                />
              </template>
            </FormGroup>
          </div>

          <FormGroup
            v-if="timersDraft"
            label="Comeback after a break of"
            hint="Days away before we offer an easier session to come back on."
            :error="timersDraft.comebackGapDays < 1 ? 'Enter at least one day.' : ''"
          >
            <template #default="{ id }">
              <Input
                :id="id"
                type="number"
                value-as-number
                inputmode="numeric"
                min="1"
                step="1"
                size="large"
                class="min-h-[48px] text-xl font-semibold tabular-nums"
                :invalid="timersDraft.comebackGapDays < 1"
                :model-value="timersDraft.comebackGapDays"
                @update:model-value="setComebackGap($event)"
              />
            </template>
          </FormGroup>

          <div class="flex items-center justify-between gap-4 border-t border-ink-200 pt-4">
            <p class="text-sm" role="status">
              <span v-if="timersDirty" class="text-accent-600">Unsaved changes</span>
              <span v-else-if="timersSave.justSaved.value" class="inline-flex items-center gap-1 text-ink-500">
                <Icon name="check" />
                Saved
              </span>
            </p>
            <Button
              label="Save"
              size="large"
              class="min-h-[48px]"
              :disabled="!timersDirty || !timersValid"
              :loading="timersSave.isSubmitting.value"
              @click="timersSave.submit()"
            />
          </div>
        </div>
      </Card>

      <Card title="Cardio">
        <div class="flex flex-col gap-6">
          <CardioForm v-if="cardioDraft" v-model="cardioDraft" v-model:valid="cardioValid" />

          <div class="flex items-center justify-between gap-4 border-t border-ink-200 pt-4">
            <p class="text-sm" role="status">
              <span v-if="cardioDirty" class="text-accent-600">Unsaved changes</span>
              <span v-else-if="cardioSave.justSaved.value" class="inline-flex items-center gap-1 text-ink-500">
                <Icon name="check" />
                Saved
              </span>
            </p>
            <Button
              label="Save"
              size="large"
              class="min-h-[48px]"
              :disabled="!cardioDirty || !cardioValid"
              :loading="cardioSave.isSubmitting.value"
              @click="cardioSave.submit()"
            />
          </div>
        </div>
      </Card>

      <Card title="Zones">
        <div class="flex flex-col gap-6">
          <!-- Bound to the cardio DRAFT's modalities, not the saved ones: a sport
               ticked above appears here immediately, and the form prunes the
               paces of sports that are no longer selected. -->
          <ZonesForm
            v-if="cardioDraft"
            v-model="zonesValue"
            v-model:draft="zonesDraft"
            :modalities="cardioDraft.modalities"
          />

          <div class="flex items-center justify-between gap-4 border-t border-ink-200 pt-4">
            <p class="text-sm" role="status">
              <span v-if="zonesDirty" class="text-accent-600">Unsaved changes</span>
              <span v-else-if="zonesSave.justSaved.value" class="inline-flex items-center gap-1 text-ink-500">
                <Icon name="check" />
                Saved
              </span>
            </p>
            <Button
              label="Save"
              size="large"
              class="min-h-[48px]"
              :disabled="!zonesDirty"
              :loading="zonesSave.isSubmitting.value"
              @click="zonesSave.submit()"
            />
          </div>
        </div>
      </Card>

      <Card title="Availability">
        <div class="flex flex-col gap-6">
          <AvailabilityForm v-if="availabilityDraft" v-model="availabilityDraft" v-model:valid="availabilityValid" />

          <div class="flex items-center justify-between gap-4 border-t border-ink-200 pt-4">
            <p class="text-sm" role="status">
              <span v-if="availabilityDirty" class="text-accent-600">Unsaved changes</span>
              <span v-else-if="availabilitySave.justSaved.value" class="inline-flex items-center gap-1 text-ink-500">
                <Icon name="check" />
                Saved
              </span>
            </p>
            <Button
              label="Save"
              size="large"
              class="min-h-[48px]"
              :disabled="!availabilityDirty || !availabilityValid"
              :loading="availabilitySave.isSubmitting.value"
              @click="availabilitySave.submit()"
            />
          </div>
        </div>
      </Card>

      <!-- Named, but deliberately not built: a disabled toggle here would read
           as a feature that is merely off. -->
      <Card title="Strava and notifications">
        <p class="text-sm text-ink-500">Connecting Strava and turning on reminders arrive in a later phase.</p>
      </Card>

      <Card title="Export your data">
        <p class="text-sm text-ink-500">Downloading everything as JSON arrives in a later phase.</p>
      </Card>

      <Button
        label="Sign out"
        color="secondary"
        variant="outlined"
        size="large"
        block
        class="min-h-[48px]"
        :loading="isSigningOut"
        @click="signOut()"
      />
    </template>
  </section>
</template>
