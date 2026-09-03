<script setup lang="ts">
import { useRoute } from 'vue-router'
import { Icon } from 'vuiii'

const route = useRoute()

const items = [
  { to: '/', label: 'Today', icon: 'home' },
  { to: '/plan', label: 'Plan', icon: 'calendar' },
  { to: '/progress', label: 'Progress', icon: 'chart' },
  { to: '/history', label: 'History', icon: 'history' },
  { to: '/settings', label: 'Settings', icon: 'cog' },
]

// Computed here rather than via `active-class`: two utility classes of equal
// specificity would fight over CSS source order instead of over state.
function isActive(to: string): boolean {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}
</script>

<template>
  <!-- Bottom bar: thumb-reachable, and the safe-area padding keeps the tap
       targets clear of the iOS home indicator.

       The icons are the bar: at arm's length in a bright gym the label is
       confirmation, the shape is what gets read. vuiii sizes `Icon` off a CSS
       variable, so the bump is scoped here rather than fought with a width
       utility the component's own class would outrank. -->
  <nav
    class="shrink-0 border-t border-ink-200 bg-white pb-[env(safe-area-inset-bottom)] [--vuiii-icon-size--large:2rem]"
    aria-label="Main"
  >
    <ul class="mx-auto flex max-w-lg">
      <li v-for="item in items" :key="item.to" class="flex-1">
        <RouterLink
          :to="item.to"
          class="flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-1.5 text-xs font-medium"
          :class="isActive(item.to) ? 'text-accent-600' : 'text-ink-500'"
        >
          <Icon :name="item.icon" size="large" />
          {{ item.label }}
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
