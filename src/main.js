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

// Auto-reload when an updated service worker takes control, so a deployed fix
// actually reaches an already-open PWA instead of running stale cached code
// until the next cold start (#190). registerSW.js (injected by vite-plugin-pwa)
// only registers the worker; the Workbox SW uses skipWaiting + clientsClaim, so
// a new version activates and claims this page — we just have to reload on that.
if ('serviceWorker' in navigator) {
  // Only an *update* should trigger a reload. On a first-ever visit the page is
  // not yet controlled, so the worker claiming it for the first time is not a
  // stale-code swap and must not bounce the user.
  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return
    reloading = true
    window.location.reload()
  })
}

app.use(router).mount('#app')

// Kick off the cache load + (online) refresh; views react as words arrive.
initVocab()
// Load the learner's progress (counts, batches) so the pill and home reflect it.
loadProgress()
// Load feedback-sound preferences so they're ready before the first answer.
loadSettings()
