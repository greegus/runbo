import { fileURLToPath, URL } from 'node:url'

import { configDefaults, defineConfig } from 'vitest/config'

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
    // Agent worktrees are full checkouts; without this every run picks up
    // their copies of the suite too.
    exclude: [...configDefaults.exclude, '.claude/worktrees/**'],
  },
})
