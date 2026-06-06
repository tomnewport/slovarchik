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

// Catch unhandled promise rejections (async functions called without await,
// e.g. initVocab, loadReports, the session setup() call).
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Slovarchik] unhandled rejection', event.reason)
  raiseError(event.reason)
})

// Catch uncaught synchronous errors outside Vue's call wrappers.
window.addEventListener('error', (event) => {
  console.error('[Slovarchik] uncaught error', event.error)
  raiseError(event.error)
})

app.use(router).mount('#app')

// Kick off the cache load + (online) refresh; views react as words arrive.
initVocab()
// Load the learner's progress (counts, batches) so the pill and home reflect it.
loadProgress()
// Load feedback-sound preferences so they're ready before the first answer.
loadSettings()
