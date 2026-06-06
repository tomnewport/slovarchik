import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router/index.js'
import { initVocab } from './stores/vocab.js'
import { loadProgress } from './stores/progress.js'
import { loadSettings } from './stores/settings.js'
import { raiseError } from './stores/errorToast.js'
import './style.css'

const app = createApp(App)

app.config.errorHandler = (err, _instance, info) => {
  console.error('[Slovarchik]', info, err)
  raiseError(err)
}

app.use(router).mount('#app')

// Kick off the cache load + (online) refresh; views react as words arrive.
initVocab()
// Load the learner's progress (counts, batches) so the pill and home reflect it.
loadProgress()
// Load feedback-sound preferences so they're ready before the first answer.
loadSettings()
