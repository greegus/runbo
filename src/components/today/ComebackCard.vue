<script setup lang="ts">
import { format } from '@/liftoscript/weight'
import type { ComebackProposal } from '@/training/comeback'

/**
 * The comeback offer after a long gap.
 *
 * Every sentence comes from `proposal.summary`, which `proposeComeback` already
 * wrote; this component composes no copy of its own and applies nothing. Accept
 * is explicit, and dismiss is local to the parent — the proposal simply
 * reappears while the gap holds and vanishes as soon as a session is logged.
 */

const props = withDefaults(
  defineProps<{
    proposal: ComebackProposal
    busy?: boolean
    error?: string | null
  }>(),
  { busy: false, error: null },
)

const emit = defineEmits<{
  accept: []
  dismiss: []
}>()

function accept(): void {
  if (props.busy) return
  emit('accept')
}

function dismiss(): void {
  if (props.busy) return
  emit('dismiss')
}
</script>

<template>
  <section
    class="flex flex-col gap-3 rounded-xl border border-accent-300 bg-accent-50 p-4"
    aria-labelledby="comeback-title"
  >
    <h2 id="comeback-title" class="text-lg font-bold text-ink-900">Ease back in?</h2>

    <ul class="flex list-none flex-col gap-1 text-sm text-ink-800">
      <li v-for="(line, index) in props.proposal.summary" :key="index">{{ line }}</li>
    </ul>

    <ul v-if="props.proposal.strength.length" class="flex list-none flex-col gap-1 text-sm text-ink-800">
      <li v-for="change in props.proposal.strength" :key="change.exerciseKey" class="flex justify-between gap-3">
        <span class="min-w-0 truncate">{{ change.exerciseKey }}</span>
        <span class="shrink-0 tabular-nums">{{ format(change.from) }} → {{ format(change.to) }}</span>
      </li>
    </ul>

    <div class="flex flex-col gap-2">
      <button
        type="button"
        class="min-h-[48px] w-full rounded-xl bg-accent-600 px-4 text-base font-semibold text-white"
        :aria-disabled="props.busy"
        @click="accept()"
      >
        {{ props.busy ? 'Applying…' : 'Apply the comeback' }}
      </button>

      <button
        type="button"
        class="min-h-[48px] w-full rounded-xl border border-ink-300 bg-white px-4 text-base font-semibold text-ink-700"
        :aria-disabled="props.busy"
        @click="dismiss()"
      >
        No, carry on as before
      </button>
    </div>

    <p v-if="props.error" role="alert" class="text-sm text-accent-800">{{ props.error }}</p>
  </section>
</template>
