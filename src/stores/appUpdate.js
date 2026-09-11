import { reactive } from 'vue'

// Whether a newer build is ready, and the means to take it — deliberately
// *not* taken automatically (#691).
//
// This used to be automatic: the worker was built with `skipWaiting`, so a
// deploy activated the moment a launch noticed it, claimed the open page, and
// `main.js` reloaded on `controllerchange`. The effect on a learner was that
// starting a session and, a few seconds later, having the page reload out from
// under them — mid-question, mid-answer — was routine.
//
// A new worker now installs and waits (`registerType: 'prompt'` plus an
// explicit `skipWaiting: false` in vite.config.js), and the only thing a launch
// does on finding one is set `state.available`.
//
// (During the one-off rescue deploy for #703, `skipWaiting` is true and the
// worker takes itself, so `onNeedRefresh` mostly will not fire and this banner
// mostly will not show. That is the point of that deploy, and it is reverted in
// the PR straight after it.)
// Home shows a banner; the swap happens when the learner asks for it, between
// questions rather than during one.
//
// The registration itself belongs to `virtual:pwa-register`, which only exists
// inside a Vite build — so `initAppUpdate` takes its `registerSW` as an
// argument rather than importing it. `main.js` supplies the real one; a test
// supplies a fake and everything below is ordinary code.

/** How long to wait for the new worker to take over before reloading anyway. */
const TAKEOVER_GRACE_MS = 5000

export const state = reactive({
  /** A newer build is installed and waiting for permission to take over. */
  available: false,
  /** `applyUpdate` is in flight — the reload onto the new build is imminent. */
  applying: false,
})

/** @type {((reloadPage?: boolean) => Promise<void>) | null} */
let updateSW = null
/** @type {ServiceWorkerRegistration | null} */
let registration = null
/** @type {() => void} */
let reloadPage = () => window.location.reload()

/**
 * Register the service worker and start watching for a newer build.
 *
 * @param {(options: object) => (reloadPage?: boolean) => Promise<void>} registerSW
 *   `registerSW` from `virtual:pwa-register`.
 * @param {{ reload?: () => void }} [deps] Injection seam for tests.
 * @returns {void}
 */
export function initAppUpdate(registerSW, deps = {}) {
  if (deps.reload) reloadPage = deps.reload
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      state.available = true
    },
    /**
     * @param {string} _swUrl
     * @param {ServiceWorkerRegistration} [reg]
     */
    onRegisteredSW(_swUrl, reg) {
      registration = reg ?? null
    },
  })
}

/**
 * Ask the waiting worker to take over, then land on the new build.
 *
 * `updateSW(true)` sends the skip-waiting message and the plugin's own
 * `controlling` listener reloads us. That listener is the normal path; the
 * timer below is the one that fires when there turns out to be no waiting
 * worker after all (a stale banner, say, or a worker replaced since), so the
 * button is never simply dead.
 *
 * @returns {Promise<void>}
 */
export async function applyUpdate() {
  if (state.applying) return
  state.applying = true
  try {
    await updateSW?.(true)
  } catch {
    // Fall through to the reload — a failed message is exactly the case the
    // grace timer exists for.
  }
  setTimeout(reloadPage, TAKEOVER_GRACE_MS)
}

/**
 * Ask the browser to look for a new build now. Resolves once the check is
 * done; `state.available` says what it found.
 *
 * @returns {Promise<boolean>} whether an update is waiting.
 */
export async function checkForUpdate() {
  try {
    await registration?.update()
    // `update()` resolves once a newly found worker has installed, at which
    // point it is waiting. `onNeedRefresh` normally sets the flag off the same
    // transition; reading the registration here takes the race out of it.
    if (registration?.waiting) state.available = true
  } catch {
    // Offline, or the worker is gone — nothing to report beyond what we know.
  }
  return state.available
}

/** Test seam: forget the registration and the flags. */
export function resetAppUpdate() {
  state.available = false
  state.applying = false
  updateSW = null
  registration = null
  reloadPage = () => window.location.reload()
}
