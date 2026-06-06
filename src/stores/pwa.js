// Reactive wrapper around the service-worker registration so the Data screen
// can show PWA status (offline-ready, current build, last update check) and
// offer a manual "check for updates". The auto-reload when a new worker takes
// control lives in main.js; here we only surface state and trigger update().
import { reactive } from 'vue'

const LAST_CHECKED_KEY = 'pwa:lastChecked'

export const pwaState = reactive({
  supported: false, // browser exposes serviceWorker
  ready: false, // a worker is registered for this app
  offlineReady: false, // a worker controls this page (assets cached for offline)
  updateAvailable: false, // a newer worker has installed and is ready to take over
  checking: false, // an update() call is in flight
  lastChecked: null, // epoch ms of the last update check
})

let registration = null

function readLastChecked() {
  try {
    const v = localStorage.getItem(LAST_CHECKED_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

function writeLastChecked(ts) {
  try {
    localStorage.setItem(LAST_CHECKED_KEY, String(ts))
  } catch {
    /* storage may be unavailable (private mode) — non-fatal */
  }
}

function watchInstalling(sw) {
  if (!sw) return
  sw.addEventListener('statechange', () => {
    // A worker reaching "installed" while a controller already exists is an
    // update waiting to take over (a first-ever install has no prior controller).
    if (sw.state === 'installed' && navigator.serviceWorker.controller) {
      pwaState.updateAvailable = true
    }
  })
}

/** Read the current SW state and start tracking updates. Safe to call anywhere. */
export async function initPwa() {
  pwaState.lastChecked = readLastChecked()
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  pwaState.supported = true
  pwaState.offlineReady = Boolean(navigator.serviceWorker.controller)
  try {
    // registerSW.js registers the worker on window 'load'; `ready` resolves
    // once one is active, so we fall back to it if registration isn't up yet.
    registration = (await navigator.serviceWorker.getRegistration()) ?? null
    if (!registration) registration = await navigator.serviceWorker.ready
  } catch {
    return
  }
  if (!registration) return
  pwaState.ready = true
  if (registration.waiting) pwaState.updateAvailable = true
  watchInstalling(registration.installing)
  registration.addEventListener('updatefound', () => watchInstalling(registration.installing))
}

/**
 * Ask the browser to re-fetch the service worker. A deployed update installs,
 * activates (skipWaiting) and claims the page — at which point the
 * controllerchange listener in main.js reloads onto the fresh build. Resolves
 * once the check completes; any reload happens independently.
 */
export async function checkForUpdate() {
  if (pwaState.checking) return
  pwaState.checking = true
  try {
    if (registration) await registration.update()
  } catch {
    /* offline or transient — nothing to surface beyond the timestamp */
  } finally {
    pwaState.lastChecked = Date.now()
    writeLastChecked(pwaState.lastChecked)
    pwaState.checking = false
  }
}

/** Reset module state — tests only. */
export function _resetForTests() {
  registration = null
  Object.assign(pwaState, {
    supported: false,
    ready: false,
    offlineReady: false,
    updateAvailable: false,
    checking: false,
    lastChecked: null,
  })
}
