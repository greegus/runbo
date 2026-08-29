<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { FormGroup, Icon, Input, RadioButtonGroup } from 'vuiii'

import type { CardioZones, PaceDraft, ZonesDraft } from '@/onboarding/types'
import {
  clockFromMinutes,
  type ClockParts,
  joinClock,
  minutesFromClock,
  splitClock,
  zonesFromDraft,
} from '@/onboarding/zonesDraft'
import { formatHrZone, formatPaceZone, hrZones, maxFromAge, paceZones, rpeCue, ZONES } from '@/training/zones'
import type { Modality } from '@/types'

const props = defineProps<{
  modelValue: CardioZones | undefined
  draft: ZonesDraft
  modalities: Modality[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: CardioZones | undefined]
  'update:draft': [value: ZonesDraft]
}>()

const HR_MODE_OPTIONS = [
  { value: 'none', label: 'Skip' },
  { value: 'max', label: 'I know my max HR' },
  { value: 'age', label: 'Use my age' },
]

const PACE_MODE_OPTIONS = [
  { value: 'none', label: 'Skip' },
  { value: 'threshold', label: 'I know it' },
  { value: 'recent', label: 'From a recent effort' },
]

/**
 * The stored number is a different animal per modality — seconds per km, km/h,
 * seconds per 100 m — so the label, the entry widget and the distance unit all
 * have to be chosen per modality. Getting this table wrong is the one mistake
 * the zone preview cannot make visible: every unit produces five plausible rows.
 */
const PACE_COPY: Record<Modality, { icon: string; title: string; threshold: string; hint: string; distance: string }> =
  {
    run: {
      icon: 'run',
      title: 'Running',
      threshold: 'Threshold pace per kilometre',
      hint: 'Roughly the pace you could hold for an hour.',
      distance: 'Distance (km)',
    },
    bike: {
      icon: 'bike',
      title: 'Cycling',
      threshold: 'Threshold speed (km/h)',
      hint: 'Roughly the speed you could hold for an hour.',
      distance: 'Distance (km)',
    },
    swim: {
      icon: 'swim',
      title: 'Swimming',
      threshold: 'Threshold pace per 100 m',
      hint: 'Roughly the pace you could hold for an hour.',
      distance: 'Distance (m)',
    },
  }

/** `mm:ss` is only natural where the stored unit is a time; km/h is a plain number. */
function usesClock(modality: Modality): boolean {
  return modality !== 'bike'
}

/**
 * DECISION: the `mm:ss` halves are component-local and seeded once from the
 * draft rather than watched. They are fully derived from `draft.threshold` /
 * `draft.minutes`, and re-deriving them on every emit would fight the user
 * mid-keystroke — typing `5` into minutes would immediately reformat to `0:05`.
 * Back-navigation still restores them, because the parent owns the draft they
 * are seeded from and this component is re-created when the step is re-entered.
 */
const thresholdClock = reactive<Record<Modality, ClockParts>>({
  run: splitClock(props.draft.pace.run.threshold),
  bike: { minutes: null, seconds: null },
  swim: splitClock(props.draft.pace.swim.threshold),
})

const recentClock = reactive<Record<Modality, ClockParts>>({
  run: clockFromMinutes(props.draft.pace.run.minutes),
  bike: clockFromMinutes(props.draft.pace.bike.minutes),
  swim: clockFromMinutes(props.draft.pace.swim.minutes),
})

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Both halves of the v-model move together: the draft keeps what the user
 * typed (age, recent effort), while the emitted zones hold only the reduced
 * numbers the profile stores — and `undefined` when nothing is filled in, so a
 * skipped step leaves `cardioTrack.zones` absent.
 */
function applyDraft(next: ZonesDraft): void {
  emit('update:draft', next)
  emit('update:modelValue', zonesFromDraft(next, props.modalities))
}

function patchDraft(patch: Partial<ZonesDraft>): void {
  applyDraft({ ...props.draft, ...patch })
}

function patchPace(modality: Modality, patch: Partial<PaceDraft>): void {
  applyDraft({
    ...props.draft,
    pace: { ...props.draft.pace, [modality]: { ...props.draft.pace[modality], ...patch } },
  })
}

function setThresholdClock(modality: Modality, part: keyof ClockParts, value: unknown): void {
  thresholdClock[modality][part] = numberOrNull(value)
  patchPace(modality, { threshold: joinClock(thresholdClock[modality]) })
}

function setRecentClock(modality: Modality, part: keyof ClockParts, value: unknown): void {
  recentClock[modality][part] = numberOrNull(value)
  patchPace(modality, { minutes: minutesFromClock(recentClock[modality]) })
}

/** Swimmers think in metres; the domain divides by `distanceKm * 10` for a per-100 m pace. */
function distanceOf(modality: Modality): number | null {
  const km = props.draft.pace[modality].distanceKm

  if (km === null) return null

  return modality === 'swim' ? Math.round(km * 1000) : km
}

function setDistance(modality: Modality, value: unknown): void {
  const entered = numberOrNull(value)

  patchPace(modality, {
    distanceKm: entered === null ? null : modality === 'swim' ? entered / 1000 : entered,
  })
}

const estimatedMax = computed(() => {
  const age = props.draft.age

  if (props.draft.hrMode !== 'age' || age === null || !(age > 0)) return null

  return Math.round(maxFromAge(age))
})

// Previewed from the draft rather than from `modelValue`, so the five ranges
// react to a keystroke without waiting for the parent to echo the emit back.
const resolved = computed(() => zonesFromDraft(props.draft, props.modalities))

const hrPreview = computed(() => hrZones(resolved.value?.hr))

function pacePreview(modality: Modality) {
  return paceZones(modality, resolved.value?.pace?.[modality])
}

const hasAnyZone = computed(
  () => hrPreview.value !== null || props.modalities.some((modality) => pacePreview(modality) !== null),
)

// Dropping a modality in the previous step must also drop its stored pace —
// otherwise a threshold for a sport the user no longer trains stays in the
// profile forever, invisible because nothing renders it.
watch(
  () => props.modalities,
  () => emit('update:modelValue', zonesFromDraft(props.draft, props.modalities)),
  { deep: true },
)
</script>

<template>
  <div class="flex flex-col gap-8">
    <p class="text-sm text-ink-500">
      All of this is optional. Without it every session still gets a target — we just describe it as an effort level
      instead of a number.
    </p>

    <section class="flex flex-col gap-4">
      <h2 class="text-lg font-semibold text-ink-900">Heart rate</h2>

      <!-- fieldset/legend rather than FormGroup: FormGroup's label is a
           `<label for>` pointing at an id no radiogroup can carry. -->
      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm font-medium text-ink-900">Maximum heart rate</legend>
        <RadioButtonGroup
          :options="HR_MODE_OPTIONS"
          option-label="label"
          option-value="value"
          :model-value="props.draft.hrMode"
          class="min-h-[48px]"
          @update:model-value="patchDraft({ hrMode: $event })"
        />
      </fieldset>

      <FormGroup v-if="props.draft.hrMode === 'max'" label="Max HR" hint="bpm — the highest you have ever seen.">
        <template #default="{ id }">
          <Input
            :id="id"
            type="number"
            value-as-number
            inputmode="numeric"
            min="0"
            size="large"
            class="min-h-[48px] text-2xl font-semibold tabular-nums"
            :model-value="props.draft.maxHr"
            @update:model-value="patchDraft({ maxHr: numberOrNull($event) })"
          />
        </template>
      </FormGroup>

      <FormGroup v-else-if="props.draft.hrMode === 'age'" label="Age" hint="We estimate your max with 208 − 0.7 × age.">
        <template #default="{ id }">
          <Input
            :id="id"
            type="number"
            value-as-number
            inputmode="numeric"
            min="0"
            size="large"
            class="min-h-[48px] text-2xl font-semibold tabular-nums"
            :model-value="props.draft.age"
            @update:model-value="patchDraft({ age: numberOrNull($event) })"
          />
        </template>
      </FormGroup>

      <p v-if="estimatedMax !== null" class="text-sm text-ink-500" role="status">
        Estimated max HR: <span class="font-semibold text-ink-900">{{ estimatedMax }} bpm</span>. Only this number is
        saved.
      </p>

      <FormGroup
        label="Threshold heart rate (LTHR)"
        hint="Average HR of a hard hour. If you have it, we use it instead of your max — it tracks fitness far better."
      >
        <template #default="{ id }">
          <Input
            :id="id"
            type="number"
            value-as-number
            inputmode="numeric"
            min="0"
            size="large"
            class="min-h-[48px] text-2xl font-semibold tabular-nums"
            :model-value="props.draft.lthr"
            @update:model-value="patchDraft({ lthr: numberOrNull($event) })"
          />
        </template>
      </FormGroup>

      <div v-if="hrPreview" class="rounded-lg border border-ink-200 p-4">
        <h3 class="text-sm font-semibold text-ink-900">Your heart-rate zones</h3>
        <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <template v-for="zone in hrPreview" :key="zone.zone">
            <dt class="font-medium text-ink-500">Z{{ zone.zone }}</dt>
            <dd class="tabular-nums text-ink-900">{{ formatHrZone(zone) }}</dd>
          </template>
        </dl>
      </div>
      <p v-else class="text-sm text-ink-500">Add a value above to see your zones.</p>
    </section>

    <section v-for="modality in props.modalities" :key="modality" class="flex flex-col gap-4">
      <h2 class="flex items-center gap-2 text-lg font-semibold text-ink-900">
        <Icon :name="PACE_COPY[modality].icon" size="large" class="text-ink-500" />
        {{ PACE_COPY[modality].title }}
      </h2>

      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm font-medium text-ink-900">{{ PACE_COPY[modality].threshold }}</legend>
        <p class="text-sm text-ink-500">{{ PACE_COPY[modality].hint }}</p>
        <RadioButtonGroup
          :options="PACE_MODE_OPTIONS"
          option-label="label"
          option-value="value"
          :model-value="props.draft.pace[modality].mode"
          class="min-h-[48px]"
          @update:model-value="patchPace(modality, { mode: $event })"
        />
      </fieldset>

      <!-- mm:ss as two number fields: a masked text input would have to reject
           keystrokes on a phone keypad, and the domain wants seconds anyway. -->
      <fieldset v-if="props.draft.pace[modality].mode === 'threshold' && usesClock(modality)">
        <legend class="text-sm font-medium text-ink-900">
          {{ PACE_COPY[modality].threshold }}
        </legend>
        <div class="mt-2 flex items-end gap-2">
          <label class="flex flex-1 flex-col gap-1 text-xs text-ink-500">
            Minutes
            <Input
              type="number"
              value-as-number
              inputmode="numeric"
              min="0"
              size="large"
              class="min-h-[48px] text-2xl font-semibold tabular-nums"
              :model-value="thresholdClock[modality].minutes"
              @update:model-value="setThresholdClock(modality, 'minutes', $event)"
            />
          </label>
          <span class="pb-3 text-2xl font-semibold text-ink-400" aria-hidden="true">:</span>
          <label class="flex flex-1 flex-col gap-1 text-xs text-ink-500">
            Seconds
            <Input
              type="number"
              value-as-number
              inputmode="numeric"
              min="0"
              max="59"
              size="large"
              class="min-h-[48px] text-2xl font-semibold tabular-nums"
              :model-value="thresholdClock[modality].seconds"
              @update:model-value="setThresholdClock(modality, 'seconds', $event)"
            />
          </label>
        </div>
      </fieldset>

      <FormGroup v-else-if="props.draft.pace[modality].mode === 'threshold'" label="Threshold speed" hint="km/h">
        <template #default="{ id }">
          <Input
            :id="id"
            type="number"
            value-as-number
            inputmode="decimal"
            min="0"
            step="0.1"
            size="large"
            class="min-h-[48px] text-2xl font-semibold tabular-nums"
            :model-value="props.draft.pace[modality].threshold"
            @update:model-value="patchPace(modality, { threshold: numberOrNull($event) })"
          />
        </template>
      </FormGroup>

      <div v-else-if="props.draft.pace[modality].mode === 'recent'" class="flex flex-col gap-4">
        <FormGroup :label="PACE_COPY[modality].distance" hint="A recent hard effort — we take it as your threshold.">
          <template #default="{ id }">
            <Input
              :id="id"
              type="number"
              value-as-number
              inputmode="decimal"
              min="0"
              step="0.1"
              size="large"
              class="min-h-[48px] text-2xl font-semibold tabular-nums"
              :model-value="distanceOf(modality)"
              @update:model-value="setDistance(modality, $event)"
            />
          </template>
        </FormGroup>

        <fieldset v-if="usesClock(modality)">
          <legend class="text-sm font-medium text-ink-900">Time</legend>
          <div class="mt-2 flex items-end gap-2">
            <label class="flex flex-1 flex-col gap-1 text-xs text-ink-500">
              Minutes
              <Input
                type="number"
                value-as-number
                inputmode="numeric"
                min="0"
                size="large"
                class="min-h-[48px] text-2xl font-semibold tabular-nums"
                :model-value="recentClock[modality].minutes"
                @update:model-value="setRecentClock(modality, 'minutes', $event)"
              />
            </label>
            <span class="pb-3 text-2xl font-semibold text-ink-400" aria-hidden="true">:</span>
            <label class="flex flex-1 flex-col gap-1 text-xs text-ink-500">
              Seconds
              <Input
                type="number"
                value-as-number
                inputmode="numeric"
                min="0"
                max="59"
                size="large"
                class="min-h-[48px] text-2xl font-semibold tabular-nums"
                :model-value="recentClock[modality].seconds"
                @update:model-value="setRecentClock(modality, 'seconds', $event)"
              />
            </label>
          </div>
        </fieldset>

        <FormGroup v-else label="Time" hint="minutes">
          <template #default="{ id }">
            <Input
              :id="id"
              type="number"
              value-as-number
              inputmode="numeric"
              min="0"
              size="large"
              class="min-h-[48px] text-2xl font-semibold tabular-nums"
              :model-value="props.draft.pace[modality].minutes"
              @update:model-value="patchPace(modality, { minutes: numberOrNull($event) })"
            />
          </template>
        </FormGroup>
      </div>

      <div v-if="pacePreview(modality)" class="rounded-lg border border-ink-200 p-4">
        <h3 class="text-sm font-semibold text-ink-900">Your {{ PACE_COPY[modality].title.toLowerCase() }} zones</h3>
        <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <template v-for="zone in pacePreview(modality)" :key="zone.zone">
            <dt class="font-medium text-ink-500">Z{{ zone.zone }}</dt>
            <dd class="tabular-nums text-ink-900">{{ formatPaceZone(zone) }}</dd>
          </template>
        </dl>
      </div>
      <p v-else-if="props.draft.pace[modality].mode !== 'none'" class="text-sm text-ink-500">
        Add a value above to see your zones.
      </p>
    </section>

    <!-- The honest fallback: the domain always has an RPE cue, so a skipped
         step is a complete configuration rather than a missing one. -->
    <section v-if="!hasAnyZone" class="rounded-lg border border-ink-200 bg-ink-50 p-4">
      <h2 class="text-sm font-semibold text-ink-900">Without zones, sessions look like this</h2>
      <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <template v-for="zone in ZONES" :key="zone">
          <dt class="font-medium text-ink-500">Z{{ zone }}</dt>
          <dd class="text-ink-900">{{ rpeCue(zone) }}</dd>
        </template>
      </dl>
    </section>
  </div>
</template>
