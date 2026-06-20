// Reactive vocabulary store.
//
// Strategy: load whatever is cached in IndexedDB first (instant, offline), then
// — if online — fetch the manifest and download any files whose `updated`
// timestamp is newer than the cached copy, storing them back in IndexedDB.
import { computed, reactive } from 'vue'
import yaml from 'js-yaml'

import { buildWords, shapeVocab, shapeNouns, shapePhrases } from '../lib/vocabBuild.js'
import { canBuildContext } from '../lib/phraseBattery.js'
import * as idb from '../lib/idb.js'

/** File (and manifest `pos`) holding the phrase-completion carrier batteries. */
const BATTERIES_FILE = 'phrase-batteries.yml'

const BASE = import.meta.env.BASE_URL || '/'
const manifestUrl = () => `${BASE}vocab/manifest.json`
const fileUrl = (file) => `${BASE}vocab/${file}`

// status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'
export const state = reactive({
  status: 'idle',
  words: [],
  /** Parsed phrase-batteries.yml (carrier phrases for the context drill), or null. */
  batteries: null,
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
 * the phrase-completion mastery requirement applies. A word qualifies only if a
 * carrier phrase can actually be built for it from the loaded batteries; without
 * the batteries file no word does (the requirement stays dormant).
 */
function stampContextDrill(words, batteries) {
  if (!batteries) {
    for (const w of words) w.hasContextDrill = false
    return
  }
  const byKey = new Map(words.map((w) => [w.key, w]))
  for (const w of words) w.hasContextDrill = canBuildContext(w, { batteries, wordByKey: byKey })
}

function rebuild(records) {
  const words = buildWords(
    records.filter((r) => r.file !== BATTERIES_FILE).map((r) => ({ pos: r.pos, text: r.content })),
  )
  const batRec = records.find((r) => r.file === BATTERIES_FILE)
  let batteries = null
  if (batRec) {
    try {
      batteries = yaml.load(batRec.content) ?? null
    } catch {
      batteries = null
    }
  }
  stampContextDrill(words, batteries)
  state.words = words
  state.batteries = batteries
}

/** Populate the store from the IndexedDB cache. Returns the cached records. */
export async function loadFromCache() {
  const records = await idb.getAllFiles()
  if (records.length) rebuild(records)
  const version = await idb.getMeta('vocabVersion')
  if (version != null) state.vocabVersion = version
  return records
}

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
    if (existing && existing.updated === entry.updated) continue // up to date
    const fileRes = await fetch(fileUrl(entry.file), { cache: 'no-cache' })
    if (!fileRes.ok) continue // skip a single bad file rather than fail the lot
    const content = await fileRes.text()
    await idb.putFile({ file: entry.file, pos: entry.pos, updated: entry.updated, content })
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
