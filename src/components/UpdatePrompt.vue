<script setup lang="ts">
import { Button } from 'vuiii'
import { useRegisterSW } from 'virtual:pwa-register/vue'

/**
 * "A new version is available."
 *
 * The worker installs itself (`registerType: 'autoUpdate'`); this only asks when
 * to RELOAD, because reloading mid-set would throw away a session the athlete is
 * standing in the gym to log. So it is a non-blocking bar they can ignore, never
 * a dialog, and never an automatic refresh.
 *
 * Dismissing is per-page-load rather than persisted: the next visit offers it
 * again, which is the right cadence for something the athlete will accept
 * between sessions rather than during one.
 */
const { needRefresh, updateServiceWorker } = useRegisterSW({
  onRegisteredSW(_url, registration) {
    // A PWA kept on a home screen can run for weeks without a full load, so ask
    // the browser to look for a new worker periodically rather than only on boot.
    if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000)
  },
})

function dismiss(): void {
  needRefresh.value = false
}
</script>

<template>
  <!-- Above the bottom nav, clear of the home indicator, and out of the way of
       the thumb that is mid-workout. -->
  <div
    v-if="needRefresh"
    role="status"
    class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
  >
    <div
      class="pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-xl border border-ink-200 bg-white p-3 shadow-lg"
    >
      <p class="flex-1 text-sm text-ink-900">A new version is available.</p>

      <Button label="Later" variant="text" size="small" class="min-h-[44px]" @click="dismiss()" />
      <Button label="Update" size="small" class="min-h-[44px]" @click="updateServiceWorker(true)" />
    </div>
  </div>
</template>
