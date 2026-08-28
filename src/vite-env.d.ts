/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_FIREBASE_API_KEY: string
  readonly VITE_APP_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_APP_FIREBASE_PROJECT_ID: string
  readonly VITE_APP_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_APP_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_APP_FIREBASE_APP_ID: string
  readonly VITE_APP_FIREBASE_MEASUREMENT_ID: string
  /** Any truthy value routes the DEV build at the emulators declared in `firebase.json`. */
  readonly VITE_USE_EMULATOR: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
