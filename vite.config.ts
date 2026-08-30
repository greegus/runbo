import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      // `autoUpdate` installs the new worker as soon as it is ready; the prompt
      // in `App.vue` only asks when to RELOAD, so a session in progress is never
      // interrupted by one.
      registerType: 'autoUpdate',
      // The manifest is generated from here, so there is exactly one of them.
      // A second, hand-written `public/manifest.webmanifest` used to sit beside
      // it with an empty `icons` array — installable in neither.
      manifest: {
        name: 'runbo',
        short_name: 'runbo',
        description: 'GZCLP strength training and prescribed cardio, composed into one week.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#d13906',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          // Maskable is a separate file, not the same one relabelled: Android
          // crops to a circle, and the full-bleed lettermark loses its stem.
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      includeAssets: ['icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // The app shell only. Firestore data is NOT cached here — the persistent
        // local cache in `firebaseApp.ts` owns offline data, and a service
        // worker caching the same reads would serve a second, staler copy.
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // Off in dev: a service worker between Vite's HMR and the page turns
        // every edit into a cache question.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
