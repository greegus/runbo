<script setup lang="ts">
import { Icon } from 'vuiii'

import type { Diagnostic } from '@/liftoscript/diagnostics'

const props = withDefaults(
  defineProps<{
    diagnostics: Diagnostic[]
    emptyMessage?: string
    interactive?: boolean
  }>(),
  { emptyMessage: '', interactive: false },
)

const emit = defineEmits<{ select: [diagnostic: Diagnostic] }>()

// The caret is drawn as a second line of spaces inside the same <pre>, so both
// lines must agree on what a "column" is wide. A raw tab would advance to a tab
// stop on the source line and count as one space on the caret line — the caret
// would then point at the wrong character, which is worse than no caret at all.
const TAB_WIDTH = 4

/** Expands tabs to fixed stops, counting UTF-16 units so the arithmetic matches `Diagnostic.col`. */
function expandTabs(text: string): string {
  let out = ''

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    out += char === '\t' ? ' '.repeat(TAB_WIDTH - (out.length % TAB_WIDTH)) : char
  }

  return out
}

/**
 * The caret line of `formatDiagnostic`, tab-aware: the offset is the *rendered*
 * width of everything before the column, not the column number itself.
 */
function caretLine(diagnostic: Diagnostic): string {
  const before = expandTabs(diagnostic.sourceLine.slice(0, Math.max(0, diagnostic.col - 1)))
  return `${' '.repeat(before.length)}^`
}

function onSelect(diagnostic: Diagnostic): void {
  if (props.interactive) emit('select', diagnostic)
}
</script>

<template>
  <!-- Order, wording and severity come from `parseProgram` verbatim: nothing is
       sorted, filtered or reworded here, because the parser's message is the
       only place that knows how to rewrite the offending construct. -->
  <ul v-if="diagnostics.length" role="list" class="flex flex-col gap-3">
    <li
      v-for="(diagnostic, index) in diagnostics"
      :key="`${diagnostic.line}:${diagnostic.col}:${index}`"
      class="overflow-hidden rounded-lg border border-ink-200"
    >
      <component
        :is="interactive ? 'button' : 'div'"
        :type="interactive ? 'button' : undefined"
        class="flex w-full min-h-[48px] items-start gap-3 p-3 text-left"
        @click="onSelect(diagnostic)"
      >
        <!-- The severity word carries the meaning; the colour only reinforces
             it, so the list still reads correctly without colour vision. -->
        <span
          class="shrink-0 rounded px-2 py-0.5 text-xs font-semibold uppercase"
          :class="diagnostic.severity === 'error' ? 'bg-accent-600 text-white' : 'border border-ink-300 text-ink-700'"
        >
          {{ diagnostic.severity }}
        </span>

        <span class="min-w-0 flex-1">
          <span class="font-mono text-xs text-ink-500">{{ diagnostic.line }}:{{ diagnostic.col }}</span>
          <span class="block text-sm text-ink-900">{{ diagnostic.message }}</span>
        </span>

        <Icon v-if="interactive" name="chevron-right" class="mt-0.5 shrink-0 text-ink-400" />
      </component>

      <!-- `sourceLine` is untrusted paste: interpolated as text, never v-html.
           It is also unbounded in length, so the block scrolls on its own
           instead of forcing the page into a horizontal scroll. -->
      <pre
        v-if="diagnostic.sourceLine"
        class="overflow-x-auto border-t border-ink-200 bg-ink-50 px-3 py-2 font-mono text-xs leading-5 text-ink-800"
        >{{ expandTabs(diagnostic.sourceLine) }}
{{ caretLine(diagnostic) }}</pre>
    </li>
  </ul>

  <p v-else-if="emptyMessage" class="flex items-center gap-2 text-sm text-ink-500">
    <Icon name="check" class="shrink-0 text-accent-600" />
    {{ emptyMessage }}
  </p>
</template>
