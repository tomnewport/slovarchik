// What build is running here, what build the deployment is serving, and how
// those two relate.
//
// The installed half is baked in at build time: `vite.config.js` `define`s the
// commit and the release timestamp, so the running bundle knows what it is.
// The deployed half is `version.json`, written by the same build and fetched at
// runtime (src/stores/appUpdate.js does the I/O) — deliberately excluded from
// the service worker's precache, because a precached copy would be answered
// from the install that is already running and could never report a newer one.
//
// Two builds are compared by commit first and by release timestamp second. The
// commit says whether they are the same build at all; the timestamp is the only
// thing that says which way round they are, since a short hash carries no
// order. When either side is missing the answer is 'unknown' rather than a
// guess: "we could not tell" is a useful thing for the Data screen to say, and
// "up to date" asserted on no evidence is not.

/** The build this bundle was made from. Both halves are null outside a build. */
export const INSTALLED = Object.freeze({
  commit: typeof __APP_COMMIT_HASH__ === 'string' ? __APP_COMMIT_HASH__ : null,
  released: typeof __APP_BUILD_DATE__ === 'string' ? __APP_BUILD_DATE__ : null,
})

/**
 * @typedef {PlainObject} ReleaseNote
 * @property {string} at   ISO timestamp the change landed
 * @property {string} text one line saying what changed
 */

/**
 * Which build something is: the pair every comparison here is made on.
 *
 * @typedef {PlainObject} BuildStamp
 * @property {string|null} commit   short commit hash the build was made from
 * @property {string|null} released ISO timestamp the build was made at
 */

/**
 * A build stamp as a deployment publishes it, with what changed in it.
 *
 * `INSTALLED` is a bare stamp rather than one of these on purpose: the running
 * build's own notes are read only by the Data screen, and keeping them out of
 * this module keeps them out of the entry chunk (see vite.config.js).
 *
 * @typedef {BuildStamp & { notes: ReleaseNote[] }} AppVersion
 */

/**
 * How many notes to keep out of a fetched document. A bound on what an
 * untrusted-length list can cost us in memory and in IndexedDB, not a display
 * limit — the screen shows far fewer.
 */
const MAX_NOTES = 30

/**
 * Read the `notes` array of a version document, dropping anything malformed.
 *
 * The list is published by the deployment and stored, so it is validated on the
 * way in rather than trusted: an entry needs a parseable date and something to
 * say, or it is not a note.
 *
 * @param {unknown} raw
 * @returns {ReleaseNote[]}
 */
export function parseNotes(raw) {
  if (!Array.isArray(raw)) return []
  const notes = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const at = typeof entry.at === 'string' ? entry.at : ''
    const text = typeof entry.text === 'string' ? entry.text.trim() : ''
    if (!text || Number.isNaN(Date.parse(at))) continue
    notes.push({ at, text })
    if (notes.length === MAX_NOTES) break
  }
  return notes
}

/**
 * The notes that landed after a build was released — what is new to whoever is
 * running it.
 *
 * This is the whole reason a note carries a date. The deployment publishes one
 * window of recent changes for everyone; each install slices it at its own
 * release timestamp, so a learner two versions behind sees two versions' worth
 * and one who has just updated sees none. Nothing has to know which build any
 * particular browser is holding.
 *
 * Without a usable timestamp to slice at, the answer is nothing rather than
 * everything: a list headed "what's new for you" that is really "everything we
 * have" would be wrong for anyone but a first-time visitor.
 *
 * @param {ReleaseNote[]} notes
 * @param {string|null|undefined} since ISO timestamp of the running build
 * @returns {ReleaseNote[]}
 */
export function notesSince(notes, since) {
  const cutoff = Date.parse(since ?? '')
  if (Number.isNaN(cutoff)) return []
  return notes.filter((note) => Date.parse(note.at) > cutoff)
}

/**
 * Read a `version.json` body into a version, or null if it isn't one.
 *
 * Anything can come back from that fetch — a 404 page, an HTML shell served by
 * a misconfigured host, an older deploy that predates the file. A version with
 * neither half is no better than no answer at all, so it is rejected here
 * rather than being reported as a deployment we failed to recognise.
 *
 * @param {unknown} raw parsed JSON body
 * @returns {AppVersion|null}
 */
export function parseVersion(raw) {
  if (!raw || typeof raw !== 'object') return null
  const doc = /** @type {Record<string, unknown>} */ (raw)
  const commit = typeof doc.commit === 'string' && doc.commit ? doc.commit : null
  const released = typeof doc.released === 'string' && doc.released ? doc.released : null
  if (!commit && !released) return null
  return { commit, released, notes: parseNotes(doc.notes) }
}

/**
 * Milliseconds for an ISO release timestamp, or null if it doesn't parse.
 *
 * @param {BuildStamp|null|undefined} version
 * @returns {number|null}
 */
function releasedAt(version) {
  if (!version?.released) return null
  const ms = Date.parse(version.released)
  return Number.isNaN(ms) ? null : ms
}

/**
 * How the deployed build relates to the installed one.
 *
 * - `current` — the same build is deployed; there is nothing to take.
 * - `newer`   — the deployment has moved on; an update is waiting for us.
 * - `older`   — the deployment was rolled back behind this build. Rare, and
 *               worth saying out loud rather than rounding to "up to date":
 *               reloading would move the learner *back* a version.
 * - `unknown` — not enough to tell. No deployed version, or two builds that
 *               differ with no usable timestamp to order them by.
 *
 * @param {BuildStamp|null} installed
 * @param {BuildStamp|null} deployed
 * @returns {'current'|'newer'|'older'|'unknown'}
 */
export function compareVersions(installed, deployed) {
  if (!deployed) return 'unknown'
  const here = installed?.commit ?? null
  const there = deployed.commit ?? null
  if (here && there && here === there) return 'current'

  const hereAt = releasedAt(installed)
  const thereAt = releasedAt(deployed)
  if (hereAt === null || thereAt === null) return 'unknown'
  if (thereAt > hereAt) return 'newer'
  if (thereAt < hereAt) return 'older'
  // Same instant, and not the same commit (or no commits to compare): two
  // builds this close together are the same release for any purpose the Data
  // screen has — but differing hashes mean we genuinely cannot say so.
  return here && there ? 'unknown' : 'current'
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * "just now" / "6 minutes ago" / "3 days ago" for a past instant.
 *
 * Kept deliberately coarse: the question the Data screen answers is "is this
 * check recent enough to trust?", not "how many seconds exactly?".
 *
 * @param {number|null|undefined} at  the instant, ms since epoch
 * @param {number} [now]              ms since epoch, for tests
 * @returns {string|null}             null when there is no instant to describe
 */
export function describeAge(at, now = Date.now()) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  const ms = now - at
  // A clock that has gone backwards (a device time change, a stale record from
  // the future) should read as recent, not as a negative age.
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), 'minute')
  if (ms < DAY) return plural(Math.floor(ms / HOUR), 'hour')
  return plural(Math.floor(ms / DAY), 'day')
}

/** @param {number} n @param {string} unit */
function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}
