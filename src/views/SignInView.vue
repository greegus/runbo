<script setup lang="ts">
import { FirebaseError } from 'firebase/app'
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Icon, useSubmitAction } from 'vuiii'

import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

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

const { submit: signIn, isSubmitting } = useSubmitAction(() => authStore.signIn(), {
  errorMessage: ({ error }) => signInErrorMessage(error),
})

const { submit: signOut, isSubmitting: isSigningOut } = useSubmitAction(() => authStore.signOut())

// Sign-in resolves the account asynchronously (auth state, then the allowlist
// check), so leaving this screen is driven by the status, not by the click.
// The router guard decides where "ready" actually lands.
watch(
  () => authStore.status,
  (status) => {
    if (status === 'ready') router.push({ name: 'today' })
  },
)
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
          <p class="font-semibold text-ink-900">This account does not have access yet.</p>
          <p class="mt-1 text-ink-500">
            Signed in as <span class="font-medium text-ink-900">{{ authStore.user?.email }}</span
            >. Ask the app owner to add this address to the allowlist, then sign in again.
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
