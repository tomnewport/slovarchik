// Generates public/vocab/manifest.json AND the per-file JSON the client fetches,
// both from the authoring vocab YAML files.
//
// YAML stays the source of truth (it's what humans edit), but the browser never
// parses it: parsing ~4.5 MB of YAML on the main thread was meaningful load-time
// cost on low-end phones (issue #324). Instead this build step converts every
// `<name>.yml` → `<name>.json`, the manifest points at the JSON, and the runtime
// only ever runs the native (fast, C++) `JSON.parse` via `response.json()`.
// `js-yaml` therefore lives in devDependencies and never ships in the bundle.
// Like the manifest, the emitted `.json` files are derived artifacts and are not
// committed (see .gitignore) — regenerated on every build and `predev`.
//
// The client (src/stores/vocab.js) invalidates its IndexedDB cache per file by
// comparing a version token from the manifest. Historically that token was a
// hand-edited `updated` timestamp — and forgetting to bump it shipped vocab
// changes that clients never re-synced (see issue #323, commit #298). The token
// is now a content `hash` derived from the source file's bytes, so it changes
// exactly when (and only when) the content changes.
//
// The manifest is a *derived* artifact and is no longer committed: it is
// regenerated from the working tree on every build (and on `predev`). Deriving
// it — rather than committing it — is what lets people edit different vocab
// files on parallel branches without fighting over the manifest (its single
// aggregate array was a constant merge-conflict magnet). Both fields are
// reproducible from the repo alone:
//   • `hash`    — a content hash of the file's raw bytes.
//   • `updated` — the file's last-changed date, read from git history
//                 (`git log -1 --format=%cI`). Shown in DataView. Falls back to
//                 the current time for a file with no commit history yet (brand
//                 new / not committed, or a clone too shallow to see it).
//
// Because both fields come from committed state, building the same commit twice
// yields a byte-identical manifest. NOTE: git history means CI must check out
// with `fetch-depth: 0`; a shallow clone can't see when a file last changed and
// would fall back to the build time.
//
// Usage:
//   node scripts/gen-manifest.mjs           # regenerate manifest.json in place
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import yaml from 'js-yaml'

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

/** The JSON filename the client fetches for a given `.yml` source file. */
export const jsonName = (file) => file.replace(/\.ya?ml$/, '.json')

/** Short content hash of a file's raw bytes. */
export function hashFile(dir, file) {
  return createHash('sha256').update(readFileSync(resolve(dir, file))).digest('hex').slice(0, 16)
}

/**
 * Convert every registered `<name>.yml` into `<name>.json` on disk (the parsed
 * document, compact-stringified). Deterministic — js-yaml preserves the file's
 * key order and JSON.stringify preserves insertion order — so rebuilding the
 * same commit yields byte-identical JSON.
 */
export function emitVocabJson(dir) {
  for (const { file } of FILES) {
    const doc = yaml.load(readFileSync(resolve(dir, file), 'utf8')) ?? null
    writeFileSync(resolve(dir, jsonName(file)), JSON.stringify(doc))
  }
}

/** ISO timestamp trimmed to second precision and normalised to UTC `Z`. */
export const nowStamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

/**
 * The commit date of the last change to `file`, as a UTC `Z` timestamp — or
 * null when git can't tell us (file not committed yet, not a git checkout, or a
 * clone too shallow to reach the file's last change). Uses the committer date
 * (`%cI`) so it reflects when the change actually landed on the branch.
 */
export function gitUpdated(dir, file) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!out) return null
    return new Date(out).toISOString().replace(/\.\d+Z$/, 'Z')
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
 * Build the manifest object. Each entry points at the emitted `<name>.json`
 * (what the client fetches), while its cache-invalidation fields stay tied to
 * the YAML source: `hash` from the source bytes and `updated` from
 * `dateFor(sourceFile)` (git history in production; injected in tests for
 * determinism). Hashing the source is enough — the JSON is a deterministic
 * derivative, so the source hash changes exactly when the served JSON would.
 */
export function buildManifest(dir, dateFor) {
  const files = FILES.map(({ pos, file }) => ({
    pos,
    file: jsonName(file),
    updated: dateFor(file),
    hash: hashFile(dir, file),
  }))
  return { version: MANIFEST_VERSION, files }
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = resolve(here, '../public/vocab')

  assertFilesInSync(dir)
  emitVocabJson(dir)
  const manifest = buildManifest(dir, (file) => gitUpdated(dir, file) ?? nowStamp())
  writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(
    `Wrote ${manifest.files.length} JSON files + manifest.json to public/vocab/`,
  )
}

// Run as a CLI only when invoked directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
