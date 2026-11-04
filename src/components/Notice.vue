<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from 'vuiii'

/**
 * One inline panel for every message that is not a form field's own error:
 * information, a reason something cannot go ahead, advice, a failure, a
 * confirmation.
 *
 * Tones, by what the message means — never by how loud it should look:
 * - `neutral`: plain information, an empty section, a reason the next step is
 *   blocked ("Enter a weight for …"). A blocked step is guidance, not a fault:
 *   the athlete has not done anything wrong yet.
 * - `info`: the same surface, for a note worth an icon (offline / pending sync,
 *   a tip on what a setting costs).
 * - `warning`: something that leaves wrong data or an unworkable plan behind
 *   if ignored, or advice about today — the accent tint.
 * - `error`: something failed. Red, not the accent: the accent is the app's
 *   "do this" colour, and a failure dressed in it reads as one more call to
 *   action. Dark red on a pale red tint stays legible under gym lighting.
 * - `success`: something went through.
 *
 * An error is announced at once (`role="alert"`); everything else politely
 * (`role="status"`).
 */
type Tone = 'neutral' | 'info' | 'warning' | 'error' | 'success'

const props = withDefaults(
  defineProps<{
    tone?: Tone
    /** An icon name; warning and error carry the alert icon, success the check, unless given. */
    icon?: string | null
    title?: string
    role?: 'alert' | 'status' | null
  }>(),
  { tone: 'neutral', icon: undefined, title: undefined, role: undefined },
)

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'border-ink-200 bg-ink-50 text-ink-700',
  info: 'border-ink-200 bg-ink-50 text-ink-700',
  warning: 'border-accent-200 bg-accent-50 text-accent-800',
  error: 'border-red-300 bg-red-50 text-red-800',
  success: 'border-success-200 bg-success-50 text-success-800',
}

/** The icon's own colour: on the grey surfaces it carries the meaning, on the tints it matches the text. */
const ICON_CLASSES: Record<Tone, string> = {
  neutral: 'text-ink-500',
  info: 'text-accent-600',
  warning: 'text-accent-600',
  error: 'text-red-700',
  success: 'text-success-600',
}

const DEFAULT_ICONS: Record<Tone, string | null> = {
  neutral: null,
  info: null,
  warning: 'alert',
  error: 'alert',
  success: 'check',
}

const iconName = computed(() => (props.icon === undefined ? DEFAULT_ICONS[props.tone] : props.icon))

const ariaRole = computed(() => (props.role === undefined ? (props.tone === 'error' ? 'alert' : 'status') : props.role))
</script>

<template>
  <!-- One icon size everywhere, top-aligned with the first line of text. -->
  <div class="flex gap-2 rounded-lg border p-3 text-sm" :class="TONE_CLASSES[tone]" :role="ariaRole ?? undefined">
    <Icon v-if="iconName" :name="iconName" class="mt-0.5 shrink-0" :class="ICON_CLASSES[tone]" aria-hidden="true" />
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <p v-if="title" class="font-semibold" :class="tone === 'neutral' || tone === 'info' ? 'text-ink-900' : ''">
        {{ title }}
      </p>
      <div><slot /></div>
      <div v-if="$slots.actions" class="mt-2 flex flex-wrap gap-2">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
