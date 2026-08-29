<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { Button, FormGroup, Textarea } from 'vuiii'

import DiagnosticsList from '@/components/DiagnosticsList.vue'
import type { Diagnostic } from '@/liftoscript/diagnostics'

const props = withDefaults(
  defineProps<{
    modelValue: string
    diagnostics?: Diagnostic[]
    readonly?: boolean
    rows?: number
    label?: string
  }>(),
  { diagnostics: () => [], readonly: false, rows: 18, label: 'Program' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const diagnosticsId = useId()

const frameRef = ref<HTMLElement | null>(null)
const gutterRef = ref<HTMLElement | null>(null)
const activeLine = ref<number | null>(null)
const copied = ref(false)

// Measured from the live textarea rather than assumed: vuiii sizes the field in
// `em` from its own CSS variables, so a hard-coded line height here would drift
// the gutter one row further off with every line of a long program.
const metrics = ref({ lineHeight: 20, paddingTop: 12, fontSize: '14px', fontFamily: 'monospace' })

const lines = computed(() => props.modelValue.split('\n'))
const lineCount = computed(() => lines.value.length)

/** Lines the parser complained about, so the gutter marks them without the user scrolling the list. */
const errorLines = computed(() => new Set(props.diagnostics.map((diagnostic) => diagnostic.line)))

const gutterStyle = computed(() => ({
  paddingTop: `${metrics.value.paddingTop}px`,
  fontFamily: metrics.value.fontFamily,
  fontSize: metrics.value.fontSize,
  lineHeight: `${metrics.value.lineHeight}px`,
}))

// vuiii's `TextareaRef` exposes only focus() and select(), and `focusLine` needs
// setSelectionRange and scrollTop — so the element is reached through the frame.
function textareaEl(): HTMLTextAreaElement | null {
  return frameRef.value?.querySelector('textarea') ?? null
}

function measure(): void {
  const element = textareaEl()
  const frame = frameRef.value
  if (!element || !frame) return

  const style = getComputedStyle(element)
  const fontSize = Number.parseFloat(style.fontSize) || 14
  const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.25

  metrics.value = {
    lineHeight,
    // The textarea's own top edge is offset from the frame by the field's border
    // and wrapper padding; both have to be added or every number sits too high.
    paddingTop:
      element.getBoundingClientRect().top - frame.getBoundingClientRect().top + Number.parseFloat(style.paddingTop),
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
  }
}

function syncScroll(): void {
  const element = textareaEl()
  if (element && gutterRef.value) gutterRef.value.scrollTop = element.scrollTop
}

/** Character offset of a 1-based line/col in the current text, clamped to what exists. */
function offsetOf(line: number, col: number): number {
  const row = Math.min(Math.max(line, 1), lines.value.length)
  let offset = 0
  for (let index = 0; index < row - 1; index++) offset += lines.value[index].length + 1
  return offset + Math.min(Math.max(col, 1) - 1, lines.value[row - 1].length)
}

/** Puts the caret on a diagnostic's line and scrolls it into view. Called from the parent and from the list. */
function focusLine(line: number, col: number): void {
  const element = textareaEl()
  if (!element) return

  const row = Math.min(Math.max(line, 1), lines.value.length)
  activeLine.value = row

  const offset = offsetOf(line, col)
  element.focus()
  element.setSelectionRange(offset, offset)
  element.scrollTop = Math.max(0, (row - 1) * metrics.value.lineHeight - element.clientHeight / 2)
  syncScroll()
}

async function copyProgram(): Promise<void> {
  if (!navigator.clipboard) return

  await navigator.clipboard.writeText(props.modelValue)
  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 2000)
}

onMounted(() => {
  measure()
  textareaEl()?.addEventListener('scroll', syncScroll, { passive: true })
  window.addEventListener('resize', measure)
})

onBeforeUnmount(() => {
  textareaEl()?.removeEventListener('scroll', syncScroll)
  window.removeEventListener('resize', measure)
})

defineExpose({ focusLine })
</script>

<template>
  <div class="flex flex-col gap-4">
    <FormGroup :label="label">
      <template #default="{ id }">
        <div ref="frameRef" class="flex items-stretch gap-1">
          <!-- Numbers are decorative for a screen reader — the diagnostics list
               below states the line of every problem in text. -->
          <div
            ref="gutterRef"
            aria-hidden="true"
            class="shrink-0 min-w-[2.5rem] overflow-hidden pr-1 text-right tabular-nums select-none"
            :style="gutterStyle"
          >
            <div
              v-for="n in lineCount"
              :key="n"
              v-memo="[n === activeLine, errorLines.has(n)]"
              :class="
                n === activeLine
                  ? 'font-semibold text-accent-700'
                  : errorLines.has(n)
                    ? 'font-semibold text-accent-600'
                    : 'text-ink-400'
              "
            >
              {{ n }}
            </div>
          </div>

          <!-- `wrap="off"`: a soft-wrapped line takes two rows in the textarea
               but is still one logical line to the parser, so wrapping would
               desynchronise the gutter from the numbers the diagnostics quote.
               Horizontal scrolling inside the field is the lesser evil. -->
          <Textarea
            :id="id"
            class="min-w-0 flex-1 font-mono"
            :model-value="modelValue"
            :readonly="readonly"
            :rows="rows"
            wrap="off"
            spellcheck="false"
            autocapitalize="off"
            autocorrect="off"
            autocomplete="off"
            :aria-describedby="diagnostics.length ? diagnosticsId : undefined"
            @update:model-value="emit('update:modelValue', $event ?? '')"
          />
        </div>
      </template>
    </FormGroup>

    <div>
      <Button
        variant="outlined"
        prefix-icon="check"
        class="min-h-[48px]"
        :label="copied ? 'Copied' : 'Copy program text'"
        @click="copyProgram()"
      />
    </div>

    <!-- Parsing is the parent's job: `ProgramStep` and `ProgramView` apply
         different adoption policies to the same diagnostics, so the editor only
         renders what it is handed. -->
    <section v-if="diagnostics.length" :id="diagnosticsId" class="flex flex-col gap-3">
      <p role="status" class="text-sm text-ink-500">
        {{ diagnostics.length }} {{ diagnostics.length === 1 ? 'problem' : 'problems' }} in this program. Tap one to
        jump to its line.
      </p>

      <DiagnosticsList :diagnostics="diagnostics" interactive @select="focusLine($event.line, $event.col)" />
    </section>
  </div>
</template>
