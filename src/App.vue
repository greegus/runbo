<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DialogStack, SnackbarStack } from 'vuiii'

import AppNav from '@/components/AppNav.vue'
import UpdatePrompt from '@/components/UpdatePrompt.vue'
import { authRedirect } from '@/router/authRedirect'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const profileStore = useProfileStore()

// Sign-in and the onboarding wizard are full-screen flows — the tabs would
// only offer dead ends there.
const showNav = computed(() => !route.meta.hideNav)

// The first navigation is held by the router guard until auth and the profile
// resolve; without this the empty shell (and its nav) would flash first.
const isBooting = computed(
  () => authStore.status === 'loading' || (authStore.status === 'ready' && !profileStore.profile),
)

// Auth changes no route on its own, and the router guard only runs on a
// navigation — so both directions are pushed from here: signing in has to leave
// /signin, and signing out (from Settings, or by the session expiring) has to
// leave the app rather than stare at stale data.
//
// This watcher lives in `App.vue` because `App.vue` is always mounted. The
// same watcher inside SignInView could not work: the boot screen below
// replaces `RouterView` while the status is 'loading', which is exactly the
// window a sign-in passes through, so the view is unmounted — and its watcher
// stopped — before 'ready' arrives.
watch(
  () => authStore.status,
  (status) => {
    const target = authRedirect(status, typeof route.name === 'string' ? route.name : null)
    if (target) router.push({ name: target })
  },
)
</script>

<template>
  <div v-if="isBooting" class="flex h-full items-center justify-center p-4">
    <p class="text-ink-500" role="status">Loading…</p>
  </div>

  <div v-else class="flex h-full flex-col">
    <main class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <RouterView />
    </main>

    <AppNav v-if="showNav" />
  </div>

  <!-- Outside the booting branch: a new version is worth offering even on the
       sign-in screen, and the prompt renders nothing until there is one. -->
  <UpdatePrompt />

  <DialogStack />
  <SnackbarStack />
</template>
