<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

/**
 * The bottom sheet every modal flow on this app's phone screens sits in.
 *
 * It owns the mechanics of being a modal and nothing else: the backdrop, focus
 * on open, focus restored on close, the Tab cycle and Escape. It does not decide
 * what dismissing MEANS — the backdrop and Escape both emit `dismiss`, and the
 * parent picks the verb (the readiness sheet calls it a skip, the day picker a
 * close), because a sheet that silently cancels is the one thing a dismissal
 * must never be.
 */

const props = defineProps<{
  open: boolean
  /** id of the heading inside the slot — `aria-labelledby` for the dialog. */
  labelledBy: string
}>()

const emit = defineEmits<{
  dismiss: []
}>()

const panel = ref<HTMLElement>()
let lastFocused: HTMLElement | null = null

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * `aria-modal="true"` is a promise: Tab must not walk out into the page behind
 * the backdrop, because from there Escape no longer reaches this panel and a
 * keyboard user has no way out of a dialog that claims to be modal.
 *
 * vuiii's `useFocusTrap` binds on mount, and this panel is `v-if`-ed inside a
 * component that stays mounted for the life of the screen, so the trap would
 * attach to nothing. The cycle is therefore handled here, on the panel itself.
 */
function onTab(event: KeyboardEvent): void {
  const root = panel.value
  if (!root) return

  const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  )

  if (focusable.length === 0) {
    event.preventDefault()
    root.focus()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement

  if (event.shiftKey ? active === first || !root.contains(active) : active === last || !root.contains(active)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      panel.value?.focus()
      return
    }

    lastFocused?.focus()
    lastFocused = null
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-end justify-center">
      <div class="absolute inset-0 bg-ink-900/40" @click="emit('dismiss')" />

      <div
        ref="panel"
        class="relative flex max-h-[90vh] w-full max-w-lg flex-col gap-5 overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl focus:outline-none"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="labelledBy"
        tabindex="-1"
        @keydown.esc="emit('dismiss')"
        @keydown.tab="onTab"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
