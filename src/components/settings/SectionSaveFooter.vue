<script setup lang="ts">
import { Button, Icon } from 'vuiii'

/**
 * The foot of every Settings section: where its state stands, and its own Save.
 * Each section saves on its own — they write different slices of the profile —
 * so each carries one of these rather than the page sharing a single button.
 */
defineProps<{
  dirty: boolean
  /** The section's last save succeeded and nothing has changed since. */
  justSaved: boolean
  saving: boolean
  /** Blocked by a validation error even when there are changes to save. */
  invalid?: boolean
  label?: string
}>()

const emit = defineEmits<{ save: [] }>()
</script>

<template>
  <div class="flex items-center justify-between gap-4 border-t border-ink-200 pt-4">
    <p class="text-sm" role="status">
      <span v-if="dirty" class="inline-flex items-center gap-1 text-accent-600">
        <Icon name="alert" />
        Unsaved changes
      </span>
      <span v-else-if="justSaved" class="inline-flex items-center gap-1 text-success-700">
        <Icon name="check" />
        Saved
      </span>
    </p>
    <Button
      color="primary"
      :label="label ?? 'Save'"
      size="large"
      class="min-h-[48px]"
      :disabled="!dirty || invalid"
      :aria-disabled="!dirty || invalid"
      :loading="saving"
      @click="emit('save')"
    />
  </div>
</template>
