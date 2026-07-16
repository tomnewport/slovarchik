// Generates public/vocab/manifest.json from the vocab YAML files.
//
// The client (src/stores/vocab.js) invalidates its IndexedDB cache per file by
// comparing a version token from the manifest. Historically that token was a
// hand-edited `updated` timestamp — and forgetting to bump it shipped vocab
// changes that clients never re-synced (see issue #323, commit #298). This
// script removes the manual step: it derives a content `hash` for every file,
// so the token changes exactly when (and only when) the bytes change.
//
// `updated` is kept as a human-facing "last changed" date (shown in DataView).
// It is maintained automatically: preserved while a file's hash is unchanged,
// and stamped with the current time when the hash changes.
//
// Usage:
//   node scripts/gen-manifest.mjs           # regenerate manifest.json in place
//   node scripts/gen-manifest.mjs --check   # verify it is current (CI); exit 1 on drift
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Canonical file → part-of-speech mapping. This is the source of truth for
// which YAML files ship and what `pos` they carry; a new vocab file must be
// registered here (the script fails loudly if disk and this list disagree).
export const FILES = [
  { pos: 'noun', file: 'nouns.yml' },
  { pos: 'noun', file: 'calendar.yml' },
  { pos: 'pronoun', file: 'pronouns.yml' },
  { pos: 'numeral', file: 'numerals.yml' },
  { pos: 'verb', file: 'verbs.yml' },
  { pos: 'adjective', file: 'adjectives.yml' },
  { pos: 'grammar-rules', file: 'grammar-rules.yml' },
  { pos: 'adverb', file: 'adverbs.yml' },
  { pos: 'preposition', file: 'prepositions.yml' },
  { pos: 'conjunction', file: 'conjunctions.yml' },
  { pos: 'interjection', file: 'interjections.yml' },
  { pos: 'glossary', file: 'glossary.yml' },
]

export const MANIFEST_VERSION = 1

/** Short content hash of a file's raw bytes. */
export function hashFile(dir, file) {
  return createHash('sha256').update(readFileSync(resolve(dir, file))).digest('hex').slice(0, 16)
}

/** Read the manifest in `dir`, or null if it is missing/unparseable. */
export function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
}

/** Throw if the YAML files on disk don't match the registered FILES list. */
export function assertFilesInSync(dir) {
  const registered = new Set(FILES.map((f) => f.file))
  const onDisk = new Set(readdirSync(dir).filter((f) => f.endsWith('.yml')))
  const missing = [...registered].filter((f) => !onDisk.has(f))
  const unregistered = [...onDisk].filter((f) => !registered.has(f))
  const problems = []
  if (missing.length) problems.push(`registered but not on disk: ${missing.join(', ')}`)
  if (unregistered.length)
    problems.push(`on disk but not registered in gen-manifest.mjs: ${unregistered.join(', ')}`)
  if (problems.length) throw new Error(`vocab file list out of sync — ${problems.join('; ')}`)
}

/**
 * Build the manifest object. `updated` is carried over from `previous` while the
 * hash is unchanged, and set to `now` when a file's content changes (or is new).
 * During the migration from timestamp-only manifests, a file whose previous
 * entry has no `hash` keeps its existing `updated` (we adopt current content as
 * the baseline rather than resetting every date).
 */
export function buildManifest(dir, previous, now) {
  const prevByFile = new Map((previous?.files ?? []).map((e) => [e.file, e]))
  const files = FILES.map(({ pos, file }) => {
    const hash = hashFile(dir, file)
    const prev = prevByFile.get(file)
    let updated
    if (!prev) {
      updated = now // brand-new file
    } else if (prev.hash === undefined || prev.hash === hash) {
      updated = prev.updated ?? now // unchanged, or first run adopting a baseline
    } else {
      updated = now // content changed
    }
    return { pos, file, updated, hash }
  })
  return { version: previous?.version ?? MANIFEST_VERSION, files }
}

/** Files whose committed hash no longer matches their bytes (empty = in sync). */
export function findDrift(dir, previous) {
  const prevByFile = new Map((previous?.files ?? []).map((e) => [e.file, e]))
  const drift = []
  for (const { file } of FILES) {
    const current = hashFile(dir, file)
    const committed = prevByFile.get(file)?.hash
    if (committed !== current) drift.push({ file, committed, current })
  }
  return drift
}

/** ISO timestamp trimmed to second precision, matching the committed format. */
export const nowStamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = resolve(here, '../public/vocab')
  const check = process.argv.includes('--check')

  assertFilesInSync(dir)
  const previous = readManifest(dir)

  if (check) {
    // Drift check: the invalidation token is the hash, so verify every file's
    // committed hash matches its current bytes. `updated` is intentionally
    // ignored — it is a display date, not a correctness invariant.
    const drift = findDrift(dir, previous)
    if (drift.length) {
      console.error(
        'manifest.json is out of date — run `npm run gen:manifest` and commit the result:\n' +
          drift.map((d) => `  ${d.file}: manifest ${d.committed ?? '(none)'} → actual ${d.current}`).join('\n'),
      )
      process.exit(1)
    }
    console.log('manifest.json is up to date.')
  } else {
    const manifest = buildManifest(dir, previous, nowStamp())
    writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`Wrote ${manifest.files.length} entries to public/vocab/manifest.json`)
  }
}

// Run as a CLI only when invoked directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
