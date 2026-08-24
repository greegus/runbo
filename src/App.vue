<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { DialogStack, SnackbarStack } from 'vuiii'

import AppNav from '@/components/AppNav.vue'

const route = useRoute()

// Sign-in and the onboarding wizard are full-screen flows — the tabs would
// only offer dead ends there.
const showNav = computed(() => !route.meta.hideNav)
</script>

<template>
  <div class="flex h-full flex-col">
    <main class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <RouterView />
    </main>

    <AppNav v-if="showNav" />
  </div>

  <DialogStack />
  <SnackbarStack />
</template>
