// Guard the precache/runtime-cache partition (#665, pinning the #266 decision).
//
// The service worker precaches the app shell and deliberately does NOT precache
// the vocab. That split is the single most-reasoned decision in the caching
// design: precaching `vocab/**` pulled the full multi-MB corpus into the SW on
// first install and, because any word change alters the precache revision,
// forced every client to re-download the whole precache on *every deploy* — for
// a couple of changed word files. The vocab is served by a runtime cache
// instead (see the workbox block in vite.config.js).
//
// Nothing enforced that. A `globIgnores` line quietly dropped, or a glob
// widened, would restore the old behaviour and no test would notice — the
// symptom is a slow first install and a fat deploy, neither of which fails a
// build. This reads the *generated* manifest rather than the config, so it
// holds whatever vite-plugin-pwa actually emitted.
//
// It also asserts the vocab has no runtime cache of its own (#670). That rule
// was removed once the offline e2e showed it was always empty — a first visit's
// fetches happen before the worker controls the page, and every later visit
// reads IndexedDB instead of fetching — while still shadowing manifest.json and
// hiding a deploy's vocab change for a launch.
//
// That one has to be checked here rather than in a browser, and the reason is
// worth keeping: Workbox opens a runtime cache lazily, on the first request it
// actually handles. Since no vocab request ever reaches the worker, the cache
// is never created, so `caches.keys()` cannot tell "the rule is gone" from "the
// rule is there and has never fired". Every runtime assertion about it passes
// either way. The generated sw.js is the only place the difference is visible.
//
// It guards a second, smaller partition for the same kind of reason.
// `version.json` says what the *deployment* is serving, and the Data screen
// fetches it to tell the learner whether they are behind. Precached, it would
// be answered from the install doing the asking, so the check would report "up
// to date" forever — a guard that always passes, which is worse than none.
//
// Reads dist/sw.js, so it must run after `npm run build`.

import { readFileSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The precache manifest entries baked into a built sw.js.
 *
 * vite-plugin-pwa inlines the manifest as a minified JS array literal, so the
 * keys are unquoted and it is not JSON. Matching the `{url:"…",revision:…}`
 * pairs directly is both simpler and steadier than trying to evaluate it.
 */
export function precacheEntries(swSource) {
  return [...swSource.matchAll(/\{url:"([^"]+)",revision:(?:"([^"]*)"|null)\}/g)].map((m) => ({
    url: m[1],
    revision: m[2] ?? null,
  }))
}

/** Precached entries that are vocab data — that is, the ones that must not exist. */
export function vocabEntries(entries) {
  return entries.filter((e) => /(^|\/)vocab\//.test(e.url))
}

/**
 * Precached entries that are the deployed-version document — the other thing
 * that must not be there. Matched at the root and under a base path.
 */
export function versionEntries(entries) {
  return entries.filter((e) => /(^|\/)version\.json$/.test(e.url))
}

/**
 * Runtime-cache routes over the vocab in a built sw.js — the ones that must not
 * exist (#670).
 *
 * Matches both halves of what such a rule emits: the cache name, and a route
 * whose URL pattern tests a `/vocab/…` path. Either alone is enough to fail;
 * looking for both means a rule re-added under a different cache name, or the
 * same name attached to a different matcher, is still caught.
 */
export function vocabRuntimeRoutes(swSource) {
  const found = []
  if (/cacheName:\s*["']([^"']*vocab[^"']*)["']/.test(swSource)) {
    found.push(`a runtime cache named "${RegExp.$1}"`)
  }
  if (/registerRoute\([^;]{0,400}?\\\/vocab\\\//.test(swSource)) {
    found.push('a registerRoute() whose URL pattern matches /vocab/')
  }
  return found
}

export function renderSummary(entries, offenders, runtimeRoutes = [], versionOffenders = []) {
  const lines = []
  if (offenders.length) {
    lines.push('### 🗂️ Precache partition — broken', '')
    lines.push(
      `\`vocab/**\` must not be precached, but ${offenders.length} vocab ` +
        `${offenders.length === 1 ? 'file is' : 'files are'} in the manifest:`,
      '',
    )
    for (const e of offenders.slice(0, 10)) lines.push(`- \`${e.url}\``)
    lines.push(
      '',
      'This is the #266 decision: precaching the corpus makes first install',
      'download several MB and makes every deploy re-ship vocab the client',
      'already has. The vocab belongs to the runtime cache. Check `globIgnores`',
      'and `globPatterns` in the workbox block of `vite.config.js`.',
    )
  } else {
    lines.push('### 🗂️ Precache partition', '')
    lines.push(
      `App shell precached in ${entries.length} entries; no \`vocab/**\` among them, ` +
        'as intended (#266).',
    )
  }
  if (versionOffenders.length) {
    lines.push('', '### 🏷️ `version.json` — precached', '')
    lines.push(
      'The deployed-version document is in the precache manifest, so every update',
      'check would be answered by the build doing the asking and could never see a',
      'newer deploy. Restore the `version.json` entry in `globIgnores`.',
    )
  }
  if (runtimeRoutes.length) {
    lines.push('', '### 🗂️ Vocab runtime cache — should not exist', '')
    lines.push('The service worker has been given a vocab cache of its own again (#670):', '')
    for (const what of runtimeRoutes) lines.push(`- ${what}`)
    lines.push(
      '',
      'It was removed because it was always empty on the path a learner takes, ' +
        'while shadowing `manifest.json` and hiding a deploy for a launch. ' +
        'See docs/vocab-caching.md.',
    )
  } else {
    lines.push('', 'No vocab runtime cache, as intended (#670).')
  }
  return lines.join('\n')
}

export function main() {
  const swPath = resolve('dist/sw.js')
  let source
  try {
    source = readFileSync(swPath, 'utf8')
  } catch {
    console.error(`No service worker at ${swPath} — run \`npm run build\` first.`)
    process.exitCode = 1
    return
  }

  const entries = precacheEntries(source)
  if (entries.length === 0) {
    // An empty manifest means the shape changed and this guard has stopped
    // guarding anything. That is a failure, not a pass.
    console.error(
      `Found no precache entries in ${swPath}. The manifest format has probably ` +
        'changed — update precacheEntries() in this script rather than deleting the check.',
    )
    process.exitCode = 1
    return
  }

  const offenders = vocabEntries(entries)
  const versionOffenders = versionEntries(entries)
  const runtimeRoutes = vocabRuntimeRoutes(source)
  const markdown = renderSummary(entries, offenders, runtimeRoutes, versionOffenders)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
  }
  console.log(markdown)

  if (offenders.length || versionOffenders.length || runtimeRoutes.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
