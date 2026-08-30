<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DialogStack, SnackbarStack } from 'vuiii'

import AppNav from '@/components/AppNav.vue'
import UpdatePrompt from '@/components/UpdatePrompt.vue'
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

// Signing out (from Settings, or by the session expiring) changes no route on
// its own — without this the user would be left staring at stale data.
watch(
  () => authStore.status,
  (status) => {
    if (status === 'signedOut' || status === 'notAllowlisted') router.push({ name: 'signin' })
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
