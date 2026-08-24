<script setup lang="ts">
defineProps<{ step: string }>()
</script>

<template>
  <section class="mx-auto max-w-lg p-4">
    <h1 class="text-2xl font-bold">Onboarding — step {{ step }}</h1>
  </section>
</template>
