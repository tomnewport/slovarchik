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

export function renderSummary(entries, offenders) {
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
  const markdown = renderSummary(entries, offenders)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
  }
  console.log(markdown)

  if (offenders.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
