<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Card, FormGroup, Input, TabsNav, useSubmitAction } from 'vuiii'

import AvailabilityForm from '@/components/settings/AvailabilityForm.vue'
import CardioForm from '@/components/settings/CardioForm.vue'
import ExportDataCard from '@/components/settings/ExportDataCard.vue'
import GymForm from '@/components/settings/GymForm.vue'
import SectionSaveFooter from '@/components/settings/SectionSaveFooter.vue'
import ZonesForm from '@/components/settings/ZonesForm.vue'
import type { Availability, CardioTrack, CardioZones, GymSettings, ZonesDraft } from '@/onboarding/types'
import { emptyZonesDraft, zonesDraftFrom } from '@/onboarding/zonesDraft'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'
import type { Modality } from '@/types'

const authStore = useAuthStore()
const profileStore = useProfileStore()
const route = useRoute()
const router = useRouter()

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
/**
 * The other sections start as `null` and read as clean until seeded. Zones
 * cannot: `undefined` is a real value ("no zones set"), so before the first
 * seed the empty draft compared unequal to stored zones, the section read as
 * dirty, and the seed skipped it as if it held typing — the stored zones never
 * reached the form, and saving it wrote them away.
 */
const zonesSeeded = ref(false)

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
      saunaOnRestDays: draft.saunaOnRestDays === true,
    },
    {
      modalities: live.modalities,
      weeklyMinutes: live.weeklyMinutes,
      longestSessionMinutes: live.longestSessionMinutes,
      saunaOnRestDays: live.saunaOnRestDays === true,
    },
  )
})

/**
 * The stored zones as the form can show them. `ZonesForm` prunes the paces of
 * sports that are not selected, so a profile still carrying a bike pace from
 * when bike was ticked would read as changed the moment the page opened — and
 * stay "unsaved" no matter what the athlete did.
 */
function zonesForModalities(zones: CardioZones | undefined, modalities: Modality[]): CardioZones | undefined {
  if (!zones?.pace) return zones

  const pace = Object.fromEntries(
    Object.entries(zones.pace).filter(([modality]) => modalities.includes(modality as Modality)),
  ) as NonNullable<CardioZones['pace']>
  const { pace: _stored, ...rest } = zones

  return Object.keys(pace).length > 0 ? { ...rest, pace } : rest
}

const zonesDirty = computed(() => {
  const live = profile.value?.cardioTrack
  if (!live || !zonesSeeded.value) return false

  return differs(zonesValue.value, zonesForModalities(live.zones, cardioDraft.value?.modalities ?? live.modalities))
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
    if (!zonesSeeded.value || (!zonesDirty.value && !zonesDraftUnrecoverable.value)) {
      zonesValue.value = next.cardioTrack.zones ? structuredClone(next.cardioTrack.zones) : undefined
      zonesDraft.value = zonesDraftFrom(next.cardioTrack.zones)
      zonesSeeded.value = true
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

  // Off is an absent key, never `false`: the whole object is republished, so
  // leaving it out is what removes it.
  const { saunaOnRestDays: _stored, ...cardioTrack } = live.cardioTrack

  await profileStore.save({
    cardioTrack: {
      ...cardioTrack,
      modalities: draft.modalities,
      weeklyMinutes: draft.weeklyMinutes,
      longestSessionMinutes: draft.longestSessionMinutes,
      ...(draft.saunaOnRestDays === true ? { saunaOnRestDays: true } : {}),
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

/**
 * Eight cards stacked made the page a long scroll to reach the one section you
 * came for. Grouped by what the athlete is adjusting, each tab is a screen or
 * two at most.
 */
type SettingsTab = 'strength' | 'cardio' | 'schedule' | 'account'

const TAB_LABELS: Record<SettingsTab, string> = {
  strength: 'Strength',
  cardio: 'Cardio',
  schedule: 'Schedule',
  account: 'Account',
}

function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && value in TAB_LABELS
}

/**
 * Kept in the query, not in a ref: "Edit program" leaves for the program editor,
 * and coming back must land on Strength again rather than on the first tab.
 */
const activeTab = computed<SettingsTab>({
  get: () => (isSettingsTab(route.query.tab) ? route.query.tab : 'strength'),
  set: (tab) => {
    void router.replace({ query: { ...route.query, tab } })
  },
})

const tabDirty = computed<Record<SettingsTab, boolean>>(() => ({
  strength: gymDirty.value || timersDirty.value,
  cardio: cardioDirty.value || zonesDirty.value,
  schedule: availabilityDirty.value,
  account: false,
}))

// A hidden tab hides its "Unsaved changes" line too, so the strip carries the
// mark: an edit left behind on another tab must not look like a saved one.
const tabs = computed(() =>
  (Object.keys(TAB_LABELS) as SettingsTab[]).map((key) => ({
    key,
    label: tabDirty.value[key] ? `${TAB_LABELS[key]} •` : TAB_LABELS[key],
  })),
)

const selectedTab = computed<string | undefined>({
  get: () => activeTab.value,
  set: (key) => {
    if (isSettingsTab(key)) activeTab.value = key
  },
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
  <!-- The cards draw no border or background of their own, so vuiii's 1.5rem
       card padding only pushed every section inwards from the page gutter.
       Zero sideways lines them up with the header, on the same 1rem gutter the
       other pages' content sits on. Scoped here rather than set on :root:
       vuiii's dialogs pad themselves with the same variable. -->
  <section class="mx-auto flex max-w-lg flex-col gap-4 p-4 [--vuiii-card-padding:1rem_0]">
    <header>
      <h1 class="text-2xl font-bold text-ink-900">Settings</h1>
      <p v-if="profile" class="mt-1 text-sm text-ink-500">{{ profile.email }}</p>
    </header>

    <!-- The profile arrives through a live subscription; binding the forms to a
         null slice would render a form full of empty fields that looks like a
         wiped profile. -->
    <p v-if="!profile" class="py-8 text-center text-ink-500" role="status">Loading…</p>

    <template v-else>
      <TabsNav
        v-model="selectedTab"
        :tabs="tabs"
        id-base="settings"
        class="-mx-4 scroll-px-4 overflow-x-auto px-4 [&_[role=tab]]:min-h-[48px]"
        aria-label="Settings sections"
      />

      <!-- v-show, not v-if: the forms keep state of their own (half-typed
           fields, open pickers), and switching tabs must not throw it away. -->
      <div
        v-show="activeTab === 'strength'"
        id="settings-panel-strength"
        role="tabpanel"
        aria-labelledby="settings-tab-strength"
        class="flex flex-col gap-4"
      >
        <Card title="Gym">
          <div class="flex flex-col gap-6">
            <GymForm v-if="gymDraft" v-model="gymDraft" v-model:valid="gymValid" />

            <SectionSaveFooter
              :dirty="gymDirty"
              :just-saved="gymSave.justSaved.value"
              :saving="gymSave.isSubmitting.value"
              :invalid="!gymValid"
              @save="gymSave.submit()"
            />
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
              color="primary"
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

            <SectionSaveFooter
              :dirty="timersDirty"
              :just-saved="timersSave.justSaved.value"
              :saving="timersSave.isSubmitting.value"
              :invalid="!timersValid"
              @save="timersSave.submit()"
            />
          </div>
        </Card>
      </div>

      <div
        v-show="activeTab === 'cardio'"
        id="settings-panel-cardio"
        role="tabpanel"
        aria-labelledby="settings-tab-cardio"
        class="flex flex-col gap-4"
      >
        <Card title="Cardio">
          <div class="flex flex-col gap-6">
            <CardioForm v-if="cardioDraft" v-model="cardioDraft" v-model:valid="cardioValid" />

            <SectionSaveFooter
              :dirty="cardioDirty"
              :just-saved="cardioSave.justSaved.value"
              :saving="cardioSave.isSubmitting.value"
              :invalid="!cardioValid"
              @save="cardioSave.submit()"
            />
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

            <SectionSaveFooter
              :dirty="zonesDirty"
              :just-saved="zonesSave.justSaved.value"
              :saving="zonesSave.isSubmitting.value"
              @save="zonesSave.submit()"
            />
          </div>
        </Card>
      </div>

      <div
        v-show="activeTab === 'schedule'"
        id="settings-panel-schedule"
        role="tabpanel"
        aria-labelledby="settings-tab-schedule"
        class="flex flex-col gap-4"
      >
        <Card title="Availability">
          <div class="flex flex-col gap-6">
            <AvailabilityForm v-if="availabilityDraft" v-model="availabilityDraft" v-model:valid="availabilityValid" />

            <SectionSaveFooter
              :dirty="availabilityDirty"
              :just-saved="availabilitySave.justSaved.value"
              :saving="availabilitySave.isSubmitting.value"
              :invalid="!availabilityValid"
              @save="availabilitySave.submit()"
            />
          </div>
        </Card>
      </div>

      <div
        v-show="activeTab === 'account'"
        id="settings-panel-account"
        role="tabpanel"
        aria-labelledby="settings-tab-account"
        class="flex flex-col gap-4"
      >
        <!-- Named, but deliberately not built: a disabled toggle here would read
           as a feature that is merely off. -->
        <Card title="Strava and notifications">
          <p class="text-sm text-ink-500">Connecting Strava and turning on reminders arrive in a later phase.</p>
        </Card>

        <Card title="Export your data">
          <ExportDataCard />
        </Card>

        <Card title="Account">
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
        </Card>
      </div>
    </template>
  </section>
</template>
