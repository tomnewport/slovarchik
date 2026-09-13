import { computed, reactive } from 'vue'

import { getMeta, setMeta } from '../lib/idb.js'
import { coalesce } from '../lib/coalesce.js'
import { INSTALLED, compareVersions, parseVersion } from '../lib/appVersion.js'

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
// Home shows a banner; the swap happens when the learner asks for it, between
// questions rather than during one.
//
// The store also answers the other half of the question the Data screen asks:
// not just "is something waiting?" but "what is running here, what is deployed,
// and when did we last actually ask?". The waiting worker is a
// browser-side fact and says nothing about the deployment when nothing is
// waiting — an install that has never managed a successful update check looks
// exactly like one that is genuinely current. So `checkForUpdate` also fetches
// `version.json` from the deployment, and the *reachability* of that fetch is
// what `lastCheckedAt` records: a check that never got an answer is not a check.
//
// The registration itself belongs to `virtual:pwa-register`, which only exists
// inside a Vite build — so `initAppUpdate` takes its `registerSW` as an
// argument rather than importing it. `main.js` supplies the real one; a test
// supplies a fake and everything below is ordinary code.

/** How long to wait for the new worker to take over before reloading anyway. */
const TAKEOVER_GRACE_MS = 5000

/** Where the deployment publishes what it is serving (see vite.config.js). */
const BASE = import.meta.env.BASE_URL || '/'
const versionUrl = () => `${BASE}version.json`

/** Meta key holding the last successful check, so a reload doesn't say "never". */
const CHECK_KEY = 'updateCheck'

export const state = reactive({
  /** A newer build is installed and waiting for permission to take over. */
  available: false,
  /** `applyUpdate` is in flight — the reload onto the new build is imminent. */
  applying: false,
  /** A check is in flight. */
  checking: false,
  /**
   * When the deployment last actually answered us (ms since epoch), or null if
   * it never has. Only a check that got a reply sets this: an offline attempt
   * leaves the last real answer standing, because that is what the learner is
   * being told the age of.
   */
  lastCheckedAt: null,
  /** The most recent check could not reach the deployment at all. */
  lastCheckFailed: false,
  /**
   * What the deployment said it was serving, as of `lastCheckedAt`.
   * @type {import('../lib/appVersion.js').AppVersion|null}
   */
  deployed: null,
})

/** The build running here — commit and release date, baked in at build time. */
export const installed = INSTALLED

/**
 * How the deployment compares with the build running here: 'current', 'newer',
 * 'older' or 'unknown'. 'unknown' until a check has actually got an answer.
 */
export const deployedStatus = computed(() => compareVersions(INSTALLED, state.deployed))

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
 * Ask the deployment which build it is serving.
 *
 * `cache: 'no-store'` keeps the HTTP cache out of it; `version.json` is kept
 * out of the precache manifest (vite.config.js, guarded by
 * scripts/check-precache.mjs) so the service worker stays out of it too. Both
 * matter for the same reason: a cached answer would report the build we are
 * already running, no matter what is deployed.
 *
 * The two failures are worth separating. A *reply* we cannot read (a 404 from a
 * deploy older than this file, an HTML error page) means the deployment was
 * reached but cannot name itself — the check happened. A rejected fetch means
 * we are offline and no check happened at all.
 *
 * @returns {Promise<{ reached: boolean, version: import('../lib/appVersion.js').AppVersion|null }>}
 */
async function fetchDeployedVersion() {
  let res
  try {
    res = await fetch(versionUrl(), { cache: 'no-store' })
  } catch {
    return { reached: false, version: null }
  }
  if (!res.ok) return { reached: true, version: null }
  try {
    return { reached: true, version: parseVersion(await res.json()) }
  } catch {
    return { reached: true, version: null }
  }
}

/**
 * Look for a new build now: ask the browser to re-check the worker, and ask the
 * deployment what it is serving. Resolves once both are done; `state.available`
 * says whether a build is installed and waiting, `state.deployed` what the
 * server has.
 *
 * Coalesced (#659) rather than guarded by a flag, so the Data screen's check on
 * open and a press of Reload a moment later share one run instead of the second
 * being dropped — the press still gets the verdict it needs to act on.
 *
 * @returns {Promise<boolean>} whether an update is waiting.
 */
export const checkForUpdate = coalesce(async function checkForUpdate() {
  state.checking = true
  try {
    try {
      await registration?.update()
      // `update()` resolves once a newly found worker has installed, at which
      // point it is waiting. `onNeedRefresh` normally sets the flag off the same
      // transition; reading the registration here takes the race out of it.
      if (registration?.waiting) state.available = true
    } catch {
      // Offline, or the worker is gone — nothing to report beyond what we know.
    }

    const { reached, version } = await fetchDeployedVersion()
    state.lastCheckFailed = !reached
    if (reached) {
      state.lastCheckedAt = Date.now()
      // Null when the deployment couldn't name itself: that is the honest
      // answer, and holding the previous one would date-stamp a stale reading
      // with a fresh check time.
      state.deployed = version
      await persistCheck()
    }
  } finally {
    state.checking = false
  }
  return state.available
})

/** Remember the last answer, so a reload doesn't report "never checked". */
async function persistCheck() {
  try {
    await setMeta(CHECK_KEY, { lastCheckedAt: state.lastCheckedAt, deployed: state.deployed })
  } catch {
    // Storage is full or blocked. The check still stands for this session; it
    // simply won't survive a reload, which is not worth an error toast.
  }
}

/**
 * Restore the last recorded check from IndexedDB. A no-op once a check has
 * happened this session — that answer is newer than anything stored.
 *
 * @returns {Promise<void>}
 */
export const loadUpdateCheck = coalesce(async function loadUpdateCheck() {
  if (state.lastCheckedAt) return
  let stored
  try {
    stored = await getMeta(CHECK_KEY)
  } catch {
    return // no IndexedDB (private mode, a blocked origin) — nothing to restore
  }
  if (!stored || typeof stored !== 'object') return
  // Checked again while the read was in flight: that answer is the current one.
  if (state.lastCheckedAt) return
  if (typeof stored.lastCheckedAt === 'number') state.lastCheckedAt = stored.lastCheckedAt
  state.deployed = parseVersion(stored.deployed)
})

/** Test seam: forget the registration and the flags. */
export function resetAppUpdate() {
  state.available = false
  state.applying = false
  state.checking = false
  state.lastCheckedAt = null
  state.lastCheckFailed = false
  state.deployed = null
  updateSW = null
  registration = null
  reloadPage = () => window.location.reload()
}
