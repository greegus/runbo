import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

// Standalone config: loading vite.config.ts would boot the Vue and Tailwind
// plugins that the pure-TS domain tests never need. The `@` alias mirrors
// vite.config.ts so tests resolve imports the way the app does.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
