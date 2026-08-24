import { createRouter, createWebHistory } from 'vue-router'

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
  ],
})

// TODO(phase 4): auth guard — redirect to /signin when signed out and to
// /onboarding/:step while `profile.onboarding.completed` is false.

export default router
