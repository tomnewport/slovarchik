import { createApp } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import { router } from './router/index.js'
import { initVocab } from './stores/vocab.js'
import { loadProgress } from './stores/progress.js'
import { loadSettings } from './stores/settings.js'
import { raiseError } from './stores/errorToast.js'
import { initAppUpdate } from './stores/appUpdate.js'
import { installSeededRandom } from './lib/seed.js'
import './style.css'

// Before anything reads Math.random (vocab shaping, batch/session building), pin
// it to a seeded generator when a seed is supplied — deterministic e2e runs
// (#322). A no-op in normal use.
installSeededRandom()

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

// Register the service worker, and notice when a deployed fix is ready — but
// do not take it yet. #190 auto-reloaded the page the moment a new worker
// claimed it, which put a deployed fix in front of the learner at the cost of
// reloading them mid-question; #691 is that cost, reported. The worker now
// waits (`registerType: 'prompt'`), the store records that an update is
// available, and Home offers it. See src/stores/appUpdate.js.
initAppUpdate(registerSW)

app.use(router).mount('#app')

// Kick off the cache load + (online) refresh; views react as words arrive.
initVocab()
// Load the learner's progress (counts, batches) so the pill and home reflect it.
loadProgress()
// Load feedback-sound preferences so they're ready before the first answer.
loadSettings()
