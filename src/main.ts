import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { registerMdiIcons } from './icons'
import router from './router'
import { useAuthStore } from './stores/auth'
import { persistPlugin } from './stores/persist'

import './style.css'

registerMdiIcons()

const pinia = createPinia()
pinia.use(persistPlugin)

const app = createApp(App)
app.use(pinia)

// Auth has to start listening before the router mounts: the guard waits for
// `status` to leave 'loading', and nothing else would ever move it. `init()`
// already forces a terminal status on every path it owns; this catches the one
// case it cannot — a rejection before the state machine is even running — so a
// failure lands on /signin instead of hanging the app on the boot screen.
const authStore = useAuthStore()

authStore.init().catch((error) => {
  console.error('[auth] init failed', error)
  authStore.status = 'signedOut'
})

app.use(router)
app.mount('#app')
