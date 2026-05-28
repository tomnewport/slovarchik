import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router/index.js'
import { initVocab } from './stores/vocab.js'
import './style.css'

createApp(App).use(router).mount('#app')

// Kick off the cache load + (online) refresh; views react as words arrive.
initVocab()
