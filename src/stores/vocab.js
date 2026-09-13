// Reactive vocabulary store.
//
// Strategy: load whatever is cached in IndexedDB first (instant, offline), then
// — if online — fetch the manifest and download any files whose content `hash`
// differs from the cached copy (falling back to the `updated` timestamp for
// older manifests), storing them back in IndexedDB.
//
// The vocab files are served as build-generated JSON (converted from the
// authoring YAML at build time — see scripts/gen-manifest.mjs and issue #324),
// so the browser only ever runs `JSON.parse` (via `response.json()`), never a
// YAML parser. We cache the *parsed* document object in IndexedDB, so cached
// (offline) launches skip re-parsing entirely and just structured-clone it back.
import { computed, reactive } from 'vue'

import {
  buildWords,
  corpusToken,
  shapeVocab,
  shapeNouns,
  shapePhrases,
  shapeContextPhrases,
  learnableWords,
} from '../lib/vocabBuild.js'
import { canBuildContext, indexPhrases } from '../lib/phraseContext.js'
import { buildFormIndex } from '../lib/phraseHint.js'
import { assignParts } from '../lib/curriculum.js'
import * as idb from '../lib/idb.js'
import { coalesce } from '../lib/coalesce.js'

/** Manifest `pos` for the file holding grammar-rule explanations, not words. */
const RULES_POS = 'grammar-rules'
/**
 * Manifest `pos` for `phrase-notes.json` — the phrase annotations derived at
 * build time (#657). Like the rules, it is a manifest entry that is not a word
 * file and must be kept out of `buildWords`.
 */
const PHRASE_NOTES_POS = 'phrase-notes'
// The curriculum parts (#674): structure over the corpus rather than words in
// it, so it rides the same manifest but never reaches `buildWords`.
const PARTS_POS = 'parts'

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
  /** Parsed parts.yml — the curriculum parts definition (#674), or null. */
  partsDef: null,
  /**
   * Build-time phrase annotations (ordinal → `{n, h}`) when the cached corpus is
   * the one they were derived from, else null and `shapePhrases` derives them.
   */
  phraseNotes: null,
  lastSyncedAt: null,
  vocabVersion: null,
  error: null,
})

export const vocab = computed(() => shapeVocab(state.words))
export const nouns = computed(() => shapeNouns(state.words))
// Reading `formIndex.value` here would build the 39.5k-entry index (a tenth of a
// second and more) even on the build-time path that has no use for it, so the
// branch has to sit outside the argument list rather than inside `shapePhrases`.
export const phrases = computed(() =>
  state.phraseNotes
    ? shapePhrases(state.words, null, state.phraseNotes)
    : shapePhrases(state.words, formIndex.value),
)
export const isReady = computed(() => state.words.length > 0)
// key → word record. Cached here rather than rebuilt per component: several
// consumers want it, and it is a Map over the whole dictionary.
export const wordsByKey = computed(() => new Map(state.words.map((w) => [w.key, w])))
// Surface form → hint entry, over the whole dictionary (~39.5k forms; it was
// ~260 ms to build and #697 roughly halved that, still long enough to be felt on
// a phone). It lives here beside `wordsByKey` rather than in `stores/hints.js`
// because two unrelated consumers want the same index — the in-phrase hints and
// `shapePhrases`' prompt disambiguation — and the store owning the words is the
// only place both can reach without a cycle (#658). Building it twice cost
// ~250 ms on entry to every phrase-bearing drill. `warmFormIndex` below keeps
// even the once off the drill's path.
export const formIndex = computed(() => buildFormIndex(state.words))

/**
 * Whether an idle build of the form index is already scheduled. Reset when it
 * runs, so a later corpus change can schedule another.
 */
let warmingFormIndex = false

/**
 * Build the surface-form index in idle time rather than on the first phrase
 * (#697).
 *
 * The index is ~200 ms of CPU on a desktop and several times that on a phone,
 * and being a lazy computed it is built on the first `HintablePhrase` render —
 * which lands it between "start the drill" and the first phrase appearing, the
 * one moment the learner is actually waiting on a tap. Home is up long before
 * that (~70 ms) and is then read rather than raced through, so the work goes in
 * an idle callback: by the time a drill asks, `formIndex` is a warm computed and
 * the read costs nothing.
 *
 * Best-effort by construction. Tapping through before the callback runs builds
 * the index on demand exactly as it did before, and the scheduled read then
 * finds it cached; a launch that never reaches a phrase drill has spent idle
 * time and nothing else. `requestIdleCallback` gets a timeout so a page that
 * never goes idle still warms, and where it is missing (older Safari, jsdom) a
 * plain timeout stands in.
 */
export function warmFormIndex() {
  if (warmingFormIndex || !state.words.length) return
  warmingFormIndex = true
  const build = () => {
    warmingFormIndex = false
    if (state.words.length) void formIndex.value
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(build, { timeout: 2000 })
  else setTimeout(build, 0)
}

/**
 * Russian sentence → the shaped phrase it came from, so a caller holding only
 * the sentence can reach its alignment inputs (#706).
 *
 * Most of the app passes phrases around as plain strings — `hintTokensFor(ru)`,
 * an exercise descriptor's `ex.ru` — and word alignment needs more than the
 * string: the example's authored `align:` tie-breaks, its `inflect:` target and
 * the English that the last rung reads as evidence. Rather than thread a phrase
 * object through every drill, the string is looked back up here.
 *
 * Keyed on `ru` alone, so the 24 sentences the corpus renders with two different
 * English translations resolve to whichever came first in dictionary order.
 * Their alignment inputs would have to disagree for that to matter, which is
 * what `check:align` refuses to let happen.
 */
export const phrasesByRu = computed(() => {
  const map = new Map()
  for (const p of phrases.value) if (!map.has(p.ru)) map.set(p.ru, p)
  return map
})

/**
 * Everything `lib/phraseAlign.js` needs to align a sentence it was handed as a
 * bare string. Unknown sentences still get the dictionary and no annotations,
 * which is exactly what the structural rungs need — a phrase typed into a drill
 * that isn't in the bank still aligns, just without the authored tie-breaks.
 * @param {string} ru
 * @returns {object} opts for `alignPhraseTokens`
 */
export function alignOptsFor(ru) {
  const phrase = phrasesByRu.value.get(ru)
  return {
    byKey: wordsByKey.value,
    en: phrase ? `${phrase.en} ${phrase.enAlt.join(' ')}` : '',
    align: phrase?.align,
    inflectToken: phrase?.inflectToken ?? undefined,
    inflectKey: phrase?.source,
  }
}

/**
 * The curriculum parts (#674), each with the words it holds — the unit a
 * learner actually works through. Empty until `parts.yml` has loaded, which the
 * callers treat as "fall back to plain CEFR order" rather than as an error: the
 * app has to stay usable on a cache written before parts shipped.
 */
export const curriculumParts = computed(() =>
  state.partsDef ? assignParts(learnableWords(state.words), state.partsDef).parts : [],
)

/** Word key → the id of the part that teaches it. */
export const partOfWord = computed(() => {
  const map = new Map()
  for (const part of curriculumParts.value) for (const w of part.words) map.set(w.key, part.id)
  return map
})

/**
 * Stamp `hasContextDrill` on every word so the progression model knows whether
 * the phrase-completion mastery requirement applies. A word qualifies only if at
 * least one annotated usage example teaches it; without any `inflect:`
 * annotations no word does (the requirement stays dormant).
 */
function stampContextDrill(words, phrasesByKey) {
  for (const w of words) w.hasContextDrill = canBuildContext(w, { phrasesByKey })
}

function rebuild(records) {
  // Only records carrying a parsed `doc` are usable. A record without one is a
  // stale entry from the pre-JSON cache format (raw YAML text under `content`);
  // it is ignored here and pruned by the next successful network sync.
  const usable = records.filter((r) => r.doc)
  const sources = usable.filter(
    (r) => r.pos !== RULES_POS && r.pos !== PHRASE_NOTES_POS && r.pos !== PARTS_POS,
  )
  const words = buildWords(sources.map((r) => ({ pos: r.pos, doc: r.doc })))
  const phrasesByKey = indexPhrases(shapeContextPhrases(words))
  const rules = usable.find((r) => r.pos === RULES_POS)?.doc?.rules ?? {}
  const partsDef = usable.find((r) => r.pos === PARTS_POS)?.doc ?? null
  stampContextDrill(words, phrasesByKey)
  state.words = words
  state.contextPhrases = phrasesByKey
  state.rules = rules
  state.partsDef = partsDef
  // The build-time annotations are keyed by position in the phrase list, which
  // only means anything against the exact word files they were derived from.
  // Files are cached and invalidated one at a time, so a half-updated cache is
  // reachable; when the tokens disagree — or the notes are simply absent, as on
  // a cache written before this shipped — `shapePhrases` derives them as it
  // always did rather than annotating the wrong sentences.
  const notes = usable.find((r) => r.pos === PHRASE_NOTES_POS)?.doc
  state.phraseNotes =
    notes?.corpus && notes.corpus === corpusToken(sources) ? (notes.notes ?? null) : null
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
 *
 * Exported through {@link coalesce}, so the Data screen's manual "check for
 * updates" (DataView.vue) joins a sync already running under `initVocab`
 * instead of issuing a second set of downloads (#659).
 */
async function doSyncFromNetwork() {
  const res = await fetch(manifestUrl(), { cache: 'no-cache' })
  if (!res.ok) throw new Error(`manifest ${res.status}`)
  const manifest = await res.json()

  const cached = await idb.getAllFiles()
  const cachedBy = new Map(cached.map((r) => [r.file, r]))

  const entries = manifest.files ?? []
  const stale = entries.filter((entry) => {
    const existing = cachedBy.get(entry.file)
    // Invalidate on the content hash when the manifest provides one, falling
    // back to the `updated` timestamp for older manifests/caches. The hash
    // changes exactly when the bytes do, so a touched-but-unchanged file no
    // longer forces a re-download, and a changed file can never be missed. A
    // record with no parsed `doc` is a stale pre-JSON entry — treat it as absent
    // so it is refetched in the new format.
    return !(existing?.doc && cacheToken(existing) === cacheToken(entry))
  })

  // Download the stale files together rather than one after another (#660).
  // Nothing in the walk is order-dependent — each entry touches one manifest
  // row, one URL and one IndexedDB record keyed by filename, and the only
  // shared state is a monotonic OR — so awaiting them in turn just stacked 12
  // round trips behind the manifest's own. Concurrency is unbounded: holding
  // all twelve parsed documents at once measures 16.3 MB of peak heap against
  // 13.4 MB one-at-a-time, because the largest file dominates either way, so a
  // limiter would cost round trips to save 2.9 MB.
  //
  // `allSettled`, not `all`: `all` would abandon the other eleven downloads the
  // moment one rejected, and the loop this replaces skipped a bad file rather
  // than failing the lot. Each document goes to `idb.putFile` as it arrives
  // instead of being collected first, so nothing is held longer than its write.
  const downloads = await Promise.allSettled(
    stale.map(async (entry) => {
      const fileRes = await fetch(fileUrl(entry.file), { cache: 'no-cache' })
      if (!fileRes.ok) return false // skip a single bad file rather than fail the lot
      const doc = await fileRes.json()
      await idb.putFile({
        file: entry.file,
        pos: entry.pos,
        updated: entry.updated,
        hash: entry.hash,
        doc,
      })
      return true
    }),
  )

  // Drop any cached record the manifest no longer lists — chiefly the old
  // `*.yml` text records left behind by the pre-JSON cache format, which would
  // otherwise linger forever and (lacking a `doc`) contribute nothing.
  const wanted = new Set(entries.map((e) => e.file))
  const unwanted = cached.filter((rec) => !wanted.has(rec.file))
  const deletions = await Promise.allSettled(unwanted.map((rec) => idb.deleteFile(rec.file)))

  const changed =
    downloads.some((r) => r.status === 'fulfilled' && r.value) ||
    deletions.some((r) => r.status === 'fulfilled')

  if (changed || state.words.length === 0) {
    rebuild(await idb.getAllFiles())
  }

  // A rejection here is a thrown fetch or a failed IndexedDB write — not the
  // `!ok` response the loop always skipped. It still propagates, as before, for
  // `initVocab` to record in `state.error`, and still leaves `lastSyncedAt`
  // unstamped. What changes is that its siblings ran to completion first, so
  // the files that did arrive are cached and rebuilt into the store rather than
  // being abandoned along with the one that failed.
  const failure = [...downloads, ...deletions].find((r) => r.status === 'rejected')
  if (failure) throw failure.reason

  state.lastSyncedAt = Date.now()
  state.vocabVersion = manifest.version ?? null
  if (state.vocabVersion != null) await idb.setMeta('vocabVersion', state.vocabVersion)
  return changed
}

export const syncFromNetwork = coalesce(doSyncFromNetwork)

/**
 * Load cached data, then refresh from the network if we're online.
 *
 * Coalesced (#659): `main.js` starts this on boot and every deep-linkable view
 * starts it again in `onMounted`, so without this the whole 1.15 MB corpus is
 * downloaded and written to IndexedDB twice.
 */
async function doInitVocab() {
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
  // Whatever the corpus came from, warm the form index now rather than on the
  // first phrase (#697) — after the refresh, so a sync that replaces the words
  // can't strand a freshly built index.
  warmFormIndex()
  return state.status
}

export const initVocab = coalesce(doInitVocab)
