<script setup lang="ts">
import { FirebaseError } from 'firebase/app'
import { computed } from 'vue'
import { Button, Icon, useSubmitAction } from 'vuiii'

import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

/**
 * Three different things stop a sign-in here, and only one of them is about the
 * person reading the screen. Saying "ask the owner to add you" when the
 * allowlist document is missing, or when the database could not be reached,
 * sends them to the wrong person with the wrong question — and it is exactly
 * the kind of wrong-but-plausible message that costs an hour to see through.
 */
const accessTitle = computed(() => {
  switch (authStore.accessStatus) {
    case 'missingConfig':
      return 'Access has not been set up yet.'
    case 'unavailable':
      return 'Access could not be checked.'
    default:
      return 'This account does not have access yet.'
  }
})

const accessDetail = computed(() => {
  switch (authStore.accessStatus) {
    case 'missingConfig':
      return 'The allowlist has not been created, so nobody can get in yet — this is a setup step, not a decision about you.'
    case 'unavailable':
      return 'The allowlist could not be read. Check your connection and try again; if it keeps failing, the database is unreachable.'
    default:
      return 'Ask the app owner to add this address to the allowlist, then sign in again.'
  }
})

/**
 * A user who closes the popup gets no toast at all — the store resolves those
 * codes silently, so nothing reaches here. A popup the *browser* blocked is the
 * opposite: the user did nothing wrong and cannot fix it without being told.
 */
function signInErrorMessage(error: Error): string {
  if (error instanceof FirebaseError && error.code === 'auth/popup-blocked') {
    return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.'
  }

  return 'Sign-in did not complete. Please try again.'
}

// Leaving this screen is not this view's job: sign-in resolves the account
// asynchronously (auth state, then the allowlist check, then the profile), and
// this view is unmounted for the whole of that window — `App.vue` shows the
// boot screen while the status is 'loading'. The status watcher in `App.vue`
// does the redirect, and the router guard decides where "ready" lands.
const { submit: signIn, isSubmitting } = useSubmitAction(() => authStore.signIn(), {
  errorMessage: ({ error }) => signInErrorMessage(error),
})

const { submit: signOut, isSubmitting: isSigningOut } = useSubmitAction(() => authStore.signOut())
</script>

<template>
  <section class="mx-auto flex min-h-full max-w-lg flex-col justify-center gap-8 p-6">
    <header class="text-center">
      <h1 class="text-3xl font-bold text-ink-900">runbo</h1>
      <p class="mt-2 text-ink-500">Strength and cardio in one plan.</p>
    </header>

    <!-- Signed in, but the account is not on the allowlist. The app is
         invite-only and there is no request-access backend, so the only
         action offered is trying a different account. -->
    <div v-if="authStore.status === 'notAllowlisted'" class="flex flex-col gap-4">
      <div class="flex gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm">
        <Icon name="alert" size="large" class="shrink-0 text-accent-600" />
        <div>
          <p class="font-semibold text-ink-900">{{ accessTitle }}</p>
          <p class="mt-1 text-ink-500">
            Signed in as <span class="font-medium text-ink-900">{{ authStore.user?.email }}</span
            >. {{ accessDetail }}
          </p>
        </div>
      </div>

      <Button
        label="Use another account"
        variant="outlined"
        size="large"
        block
        class="min-h-[48px]"
        :loading="isSigningOut"
        @click="signOut()"
      />
    </div>

    <Button
      v-else
      label="Continue with Google"
      prefix-icon="google"
      size="large"
      block
      class="min-h-[48px]"
      :loading="isSubmitting || authStore.status === 'loading'"
      @click="signIn()"
    />
  </section>
</template>
