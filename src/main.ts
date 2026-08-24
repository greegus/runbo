import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { registerMdiIcons } from './icons'
import router from './router'

import './style.css'

registerMdiIcons()

createApp(App).use(createPinia()).use(router).mount('#app')
