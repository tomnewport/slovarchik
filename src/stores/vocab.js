// Reactive vocabulary store.
//
// Strategy: load whatever is cached in IndexedDB first (instant, offline), then
// — if online — fetch the manifest and download any files whose content `hash`
// differs from the cached copy (falling back to the `updated` timestamp for
// older manifests), storing them back in IndexedDB.
import { computed, reactive } from 'vue'
import yaml from 'js-yaml'

import { buildWords, shapeVocab, shapeNouns, shapePhrases, shapeContextPhrases } from '../lib/vocabBuild.js'
import { canBuildContext, indexPhrases } from '../lib/phraseContext.js'
import * as idb from '../lib/idb.js'

/** File (and manifest `pos`) holding the grammar-rule explanations, not words. */
const RULES_FILE = 'grammar-rules.yml'
const NON_WORD_FILES = new Set([RULES_FILE])

const BASE = import.meta.env.BASE_URL || '/'
const manifestUrl = () => `${BASE}vocab/manifest.json`
const fileUrl = (file) => `${BASE}vocab/${file}`

// status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'
export const state = reactive({
  status: 'idle',
  words: [],
  /** key → annotated context phrases (from usage `inflect:` blocks), indexed. */
  contextPhrases: new Map(),
  /** Parsed grammar-rules.yml `rules` map (rule id → explanation), or {}. */
  rules: {},
  lastSyncedAt: null,
  vocabVersion: null,
  error: null,
})

export const vocab = computed(() => shapeVocab(state.words))
export const nouns = computed(() => shapeNouns(state.words))
export const phrases = computed(() => shapePhrases(state.words))
export const isReady = computed(() => state.words.length > 0)

/**
 * Stamp `hasContextDrill` on every word so the progression model knows whether
 * the phrase-completion mastery requirement applies. A word qualifies only if at
 * least one annotated usage example teaches it; without any `inflect:`
 * annotations no word does (the requirement stays dormant).
 */
function stampContextDrill(words, phrasesByKey) {
  for (const w of words) w.hasContextDrill = canBuildContext(w, { phrasesByKey })
}

/** Parse a cached YAML record's top-level key, tolerating a missing/bad file. */
function parseRecord(records, file, key) {
  const rec = records.find((r) => r.file === file)
  if (!rec) return null
  try {
    return yaml.load(rec.content)?.[key] ?? null
  } catch {
    return null
  }
}

function rebuild(records) {
  const words = buildWords(
    records
      .filter((r) => !NON_WORD_FILES.has(r.file))
      .map((r) => ({ pos: r.pos, text: r.content })),
  )
  const phrasesByKey = indexPhrases(shapeContextPhrases(words))
  const rules = parseRecord(records, RULES_FILE, 'rules') ?? {}
  stampContextDrill(words, phrasesByKey)
  state.words = words
  state.contextPhrases = phrasesByKey
  state.rules = rules
}

/** Populate the store from the IndexedDB cache. Returns the cached records. */
export async function loadFromCache() {
  const records = await idb.getAllFiles()
  if (records.length) rebuild(records)
  const version = await idb.getMeta('vocabVersion')
  if (version != null) state.vocabVersion = version
  return records
}

/** Per-file cache-invalidation token: content hash if present, else timestamp. */
const cacheToken = (entry) => entry.hash ?? entry.updated

/**
 * Fetch the manifest and download any new/updated files into IndexedDB.
 * Returns true if anything changed.
 */
export async function syncFromNetwork() {
  const res = await fetch(manifestUrl(), { cache: 'no-cache' })
  if (!res.ok) throw new Error(`manifest ${res.status}`)
  const manifest = await res.json()

  const cached = await idb.getAllFiles()
  const cachedBy = new Map(cached.map((r) => [r.file, r]))

  let changed = false
  for (const entry of manifest.files ?? []) {
    const existing = cachedBy.get(entry.file)
    // Invalidate on the content hash when the manifest provides one, falling
    // back to the `updated` timestamp for older manifests/caches. The hash
    // changes exactly when the bytes do, so a touched-but-unchanged file no
    // longer forces a re-download, and a changed file can never be missed.
    if (existing && cacheToken(existing) === cacheToken(entry)) continue // up to date
    const fileRes = await fetch(fileUrl(entry.file), { cache: 'no-cache' })
    if (!fileRes.ok) continue // skip a single bad file rather than fail the lot
    const content = await fileRes.text()
    await idb.putFile({
      file: entry.file,
      pos: entry.pos,
      updated: entry.updated,
      hash: entry.hash,
      content,
    })
    changed = true
  }

  if (changed || state.words.length === 0) {
    rebuild(await idb.getAllFiles())
  }
  state.lastSyncedAt = Date.now()
  state.vocabVersion = manifest.version ?? null
  if (state.vocabVersion != null) await idb.setMeta('vocabVersion', state.vocabVersion)
  return changed
}

/** Load cached data, then refresh from the network if we're online. */
export async function initVocab() {
  state.status = 'loading'
  try {
    await loadFromCache()
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      await syncFromNetwork()
    }
    state.status = state.words.length ? 'ready' : 'empty'
  } catch (err) {
    state.error = err
    // Cached data still usable even if the refresh failed.
    state.status = state.words.length ? 'ready' : 'error'
  }
  return state.status
}
