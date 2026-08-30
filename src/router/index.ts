import { watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/signin',
      name: 'signin',
      component: () => import('@/views/SignInView.vue'),
      meta: { hideNav: true },
    },
    {
      path: '/onboarding/:step',
      name: 'onboarding',
      component: () => import('@/views/onboarding/OnboardingView.vue'),
      props: true,
      meta: { hideNav: true },
    },
    {
      path: '/',
      name: 'today',
      component: () => import('@/views/TodayView.vue'),
    },
    {
      path: '/plan',
      name: 'plan',
      component: () => import('@/views/PlanView.vue'),
    },
    {
      path: '/progress',
      name: 'progress',
      component: () => import('@/views/ProgressView.vue'),
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('@/views/HistoryView.vue'),
    },
    {
      path: '/program',
      name: 'program',
      component: () => import('@/views/ProgramView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
    },
    // A live session owns the whole viewport: `hideNav` keeps `App.vue` from
    // rendering the tab bar, which would only offer ways to lose a half-logged
    // session. What reaches the screen is the session id, never a planned item —
    // the document is created before navigation, so a reload resolves the same
    // doc. Both routes sit behind the existing auth + onboarding guard.
    {
      path: '/session/strength/:id',
      name: 'strength-session',
      component: () => import('@/views/StrengthSessionView.vue'),
      props: true,
      meta: { hideNav: true },
    },
    {
      path: '/session/cardio/:id',
      name: 'cardio-session',
      component: () => import('@/views/CardioSessionView.vue'),
      props: true,
      meta: { hideNav: true },
    },
  ],
})

/**
 * Resolves once `condition` holds. Both the auth status and the profile
 * arrive asynchronously; redirecting while they are still unknown would
 * bounce a signed-in user to /signin on every cold load.
 */
function until(condition: () => boolean): Promise<void> {
  if (condition()) return Promise.resolve()

  return new Promise((resolve) => {
    const stop = watch(condition, (met) => {
      if (!met) return
      stop()
      resolve()
    })
  })
}

router.beforeEach(async (to) => {
  const authStore = useAuthStore()

  await until(() => authStore.status !== 'loading')

  if (authStore.status !== 'ready') {
    // Both `signedOut` and `notAllowlisted` land on SignInView, which renders
    // the ask-for-access state itself; returning true there avoids a loop.
    return to.name === 'signin' ? true : { name: 'signin' }
  }

  if (to.name === 'signin') return { name: 'today' }

  const profileStore = useProfileStore()

  // `ready` only means allowlisted — the profile document (created by
  // `ensureProfile` on a first sign-in) may still be in flight.
  await until(() => Boolean(profileStore.profile))

  const onboarding = profileStore.profile?.onboarding

  if (onboarding && !onboarding.completed && to.name !== 'onboarding') {
    return { name: 'onboarding', params: { step: String(onboarding.step) } }
  }

  return true
})

export default router
