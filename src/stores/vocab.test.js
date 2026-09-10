import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import * as idb from '../lib/idb.js'
import { state, phrases, loadFromCache, syncFromNetwork, initVocab } from './vocab.js'
import { buildWords, corpusToken, phraseNotesFrom, shapePhrases } from '../lib/vocabBuild.js'

// The client fetches build-generated JSON; mirror that here by parsing the
// authoring YAML into the document object the server would serve.
const nounsDoc = yaml.load(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../public/vocab/nouns.yml'),
    'utf8',
  ),
)

const manifest = {
  version: 1,
  files: [{ pos: 'noun', file: 'nouns.json', updated: '2026-05-28T00:00:00Z' }],
}

function mockFetch() {
  return vi.fn(async (url) => {
    if (String(url).endsWith('manifest.json')) {
      return { ok: true, json: async () => manifest }
    }
    if (String(url).endsWith('nouns.json')) {
      return { ok: true, json: async () => nounsDoc }
    }
    return { ok: false, status: 404 }
  })
}

beforeEach(async () => {
  // Fresh IndexedDB and store state for each test.
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  state.words = []
  state.status = 'idle'
  state.phraseNotes = null
})

describe('vocab store sync', () => {
  it('downloads files listed in the manifest and caches them', async () => {
    globalThis.fetch = mockFetch()

    const changed = await syncFromNetwork()

    expect(changed).toBe(true)
    expect(state.words.length).toBeGreaterThan(0)
    const cached = await idb.getAllFiles()
    expect(cached.map((r) => r.file)).toContain('nouns.json')
  })

  it('does not re-download a file whose timestamp is unchanged', async () => {
    const fetch1 = mockFetch()
    globalThis.fetch = fetch1
    await syncFromNetwork()
    const downloadsFirst = fetch1.mock.calls.filter(([u]) => String(u).endsWith('nouns.json')).length
    expect(downloadsFirst).toBe(1)

    const fetch2 = mockFetch()
    globalThis.fetch = fetch2
    const changed = await syncFromNetwork()
    expect(changed).toBe(false)
    const downloadsSecond = fetch2.mock.calls.filter(([u]) => String(u).endsWith('nouns.json')).length
    expect(downloadsSecond).toBe(0) // manifest checked, file skipped
  })

  it('re-downloads when the manifest timestamp is newer', async () => {
    globalThis.fetch = mockFetch()
    await syncFromNetwork()

    manifest.files[0].updated = '2026-06-01T00:00:00Z'
    const fetch2 = mockFetch()
    globalThis.fetch = fetch2
    const changed = await syncFromNetwork()
    expect(changed).toBe(true)
    manifest.files[0].updated = '2026-05-28T00:00:00Z' // restore
  })

  it('invalidates on the content hash, not the timestamp', async () => {
    const hashed = {
      version: 1,
      files: [{ pos: 'noun', file: 'nouns.json', updated: '2026-05-28T00:00:00Z', hash: 'aaaa' }],
    }
    const build = () =>
      vi.fn(async (url) => {
        if (String(url).endsWith('manifest.json')) return { ok: true, json: async () => hashed }
        if (String(url).endsWith('nouns.json')) return { ok: true, json: async () => nounsDoc }
        return { ok: false, status: 404 }
      })

    globalThis.fetch = build()
    await syncFromNetwork()

    // Timestamp changes but the hash is the same → no re-download.
    hashed.files[0].updated = '2026-09-09T00:00:00Z'
    const noop = build()
    globalThis.fetch = noop
    expect(await syncFromNetwork()).toBe(false)
    expect(noop.mock.calls.filter(([u]) => String(u).endsWith('nouns.json')).length).toBe(0)

    // Hash changes → re-download even if the timestamp is unchanged.
    hashed.files[0].hash = 'bbbb'
    const refetch = build()
    globalThis.fetch = refetch
    expect(await syncFromNetwork()).toBe(true)
    expect(refetch.mock.calls.filter(([u]) => String(u).endsWith('nouns.json')).length).toBe(1)
  })

  it('loads previously cached files without any network', async () => {
    await idb.putFile({
      file: 'nouns.json',
      pos: 'noun',
      updated: '2026-05-28T00:00:00Z',
      doc: nounsDoc,
    })
    globalThis.fetch = vi.fn(() => {
      throw new Error('should not be called')
    })

    const records = await loadFromCache()
    expect(records.length).toBe(1)
    expect(state.words.length).toBeGreaterThan(0)
  })

  it('prunes stale pre-JSON (.yml text) records on the next sync', async () => {
    // A record left behind by the old cache format: raw YAML text, no `doc`.
    await idb.putFile({
      file: 'nouns.yml',
      pos: 'noun',
      updated: '2026-05-28T00:00:00Z',
      content: '# stale',
    })
    globalThis.fetch = mockFetch()

    await syncFromNetwork()

    const files = (await idb.getAllFiles()).map((r) => r.file)
    expect(files).toContain('nouns.json') // fetched in the new format
    expect(files).not.toContain('nouns.yml') // stale record removed
    expect(state.words.length).toBeGreaterThan(0)
  })
})

// A tiny two-word document exercising the optional `facts:` / `confusable_with:`
// fields (#585). Written as the JSON the client actually fetches, so this is a
// real round trip: document → IndexedDB → buildWords → store.
const factsDoc = {
  words: {
    'звонить=to call': {
      cefr_level: 'A2',
      accented: 'звони́ть',
      aspect: 'impf',
      en_gb: { standard: 'to call (on the telephone)' },
      facts: [
        {
          kind: 'build',
          text: 'From звон — a ringing sound.',
          parts: [
            { ru: 'звон', en: 'a ring, a chime' },
            { ru: '-и́ть', en: 'verb ending' },
          ],
        },
      ],
      confusable_with: [{ key: 'звенеть=to ring', why: 'Nearly the same sound.' }],
    },
    'звенеть=to ring': {
      cefr_level: 'B2',
      accented: 'звене́ть',
      aspect: 'impf',
      en_gb: { standard: 'to ring (of a bell)' },
    },
  },
}

describe('word facts survive the cache round trip', () => {
  it('carries facts and links both ends of a confusable pair', async () => {
    await idb.putFile({
      file: 'verbs.json',
      pos: 'verb',
      updated: '2026-08-15T00:00:00Z',
      doc: factsDoc,
    })
    globalThis.fetch = vi.fn(() => {
      throw new Error('should not be called')
    })

    await loadFromCache()

    const call = state.words.find((w) => w.key === 'звонить=to call')
    expect(call.facts[0].parts.map((p) => p.ru)).toEqual(['звон', '-и́ть'])
    expect(call.confusables.map((c) => c.key)).toEqual(['звенеть=to ring'])

    const ring = state.words.find((w) => w.key === 'звенеть=to ring')
    expect(ring.confusables[0]).toMatchObject({
      key: 'звонить=to call',
      ru: 'звони́ть',
      why: 'Nearly the same sound.',
    })
  })

  it('leaves a word that authors neither field with empty lists', async () => {
    await idb.putFile({
      file: 'nouns.json',
      pos: 'noun',
      updated: '2026-05-28T00:00:00Z',
      doc: nounsDoc,
    })
    globalThis.fetch = vi.fn(() => {
      throw new Error('should not be called')
    })

    await loadFromCache()

    // Corpus words carry authored facts and confusable links now (#590, #630);
    // the point here is the *other* words — one that authors nothing gets empty
    // lists, not undefined. A confusable link is symmetrised by linkFacts, so a
    // word can hold one without having authored it: both ends come out.
    const authored = new Set()
    for (const [key, w] of Object.entries(nounsDoc.words)) {
      if (w.facts) authored.add(key)
      for (const c of w.confusable_with ?? []) {
        authored.add(key)
        if (c?.key) authored.add(c.key)
      }
    }
    const plain = state.words.filter((w) => !authored.has(w.key))
    expect(plain.length).toBeGreaterThan(0)
    for (const w of plain) {
      expect(w.facts, `${w.key}: facts`).toEqual([])
      expect(w.confusables, `${w.key}: confusables`).toEqual([])
    }
  })
})

// The offline path, which nothing exercised before #665. This is the app's
// headline claim — "works offline" — and `initVocab` is where it is decided:
// it loads the IndexedDB cache first, only reaches for the network when the
// browser says it is online, and treats a failed refresh as a warning rather
// than a failure whenever cached words are already in hand.
describe('initVocab offline', () => {
  /** Pretend the browser is offline for the duration of one test. */
  const goOffline = () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

  // `navigator.onLine` is a prototype getter, so a spy on it outlives the test
  // that installed it and would quietly put every later test offline.
  beforeEach(() => {
    state.error = null
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Seed IndexedDB as a previous online visit would have left it. */
  async function seedCache() {
    await idb.putFile({
      file: 'nouns.json',
      pos: 'noun',
      updated: manifest.files[0].updated,
      doc: nounsDoc,
    })
  }

  it('reaches ready from the cache alone, without touching the network', async () => {
    await seedCache()
    goOffline()
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy

    expect(await initVocab()).toBe('ready')
    expect(state.words.length).toBeGreaterThan(0)
    // The point of the offline branch: no request is even attempted.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports empty, not error, when offline with nothing cached', async () => {
    goOffline()
    globalThis.fetch = vi.fn()

    // Nothing to show, but nothing went wrong either — the distinction is what
    // lets the UI say "no words yet" instead of raising a failure.
    expect(await initVocab()).toBe('empty')
  })

  it('stays ready when the refresh fails but cached words are in hand', async () => {
    await seedCache()
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    // Online as far as the browser is concerned, so the refresh is attempted
    // and throws — a captive portal, a dropped connection, a 500. Cached data
    // is still perfectly usable, so this must not degrade to `error`.
    expect(await initVocab()).toBe('ready')
    expect(state.words.length).toBeGreaterThan(0)
    expect(state.error).toBeInstanceOf(TypeError)
  })

  it('reports error when the refresh fails and there is nothing cached', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    expect(await initVocab()).toBe('error')
    expect(state.words).toHaveLength(0)
  })

  it('refreshes from the network when online', async () => {
    const fetchSpy = mockFetch()
    globalThis.fetch = fetchSpy

    expect(await initVocab()).toBe('ready')
    expect(fetchSpy).toHaveBeenCalled()
    expect(state.words.length).toBeGreaterThan(0)
  })
})

describe('build-time phrase annotations (#657)', () => {
  // The notes are keyed by position in the phrase list, so they are only
  // meaningful against the word files they were derived from. `corpusToken`
  // decides that; these pin what it decides.
  const nounEntry = { file: 'nouns.json', pos: 'noun', updated: '2026-05-28T00:00:00Z', hash: 'aaaa' }
  const notesFor = (corpus) => {
    const words = buildWords([{ pos: 'noun', doc: nounsDoc }])
    return { corpus, notes: phraseNotesFrom(shapePhrases(words)) }
  }
  const cache = async (notesDoc) => {
    await idb.putFile({ ...nounEntry, doc: nounsDoc })
    await idb.putFile({
      file: 'phrase-notes.json',
      pos: 'phrase-notes',
      updated: nounEntry.updated,
      hash: 'nnnn',
      doc: notesDoc,
    })
    await loadFromCache()
  }

  it('uses the notes when they were built from exactly this corpus', async () => {
    await cache(notesFor(corpusToken([nounEntry])))
    expect(state.phraseNotes).not.toBeNull()
    // …and the phrases it produces are the ones deriving them would have.
    const derived = shapePhrases(state.words)
    expect(phrases.value).toEqual(derived)
  })

  it('ignores notes built from a different corpus and derives instead', async () => {
    await cache(notesFor(corpusToken([{ ...nounEntry, hash: 'stale' }])))
    expect(state.phraseNotes).toBeNull()
    expect(phrases.value).toEqual(shapePhrases(state.words))
  })

  it('derives when no notes file is cached at all', async () => {
    await idb.putFile({ ...nounEntry, doc: nounsDoc })
    await loadFromCache()
    expect(state.phraseNotes).toBeNull()
    expect(phrases.value.length).toBeGreaterThan(0)
  })

  it('keeps the notes file out of the word list', async () => {
    await cache(notesFor(corpusToken([nounEntry])))
    expect(state.words.some((w) => w.key == null)).toBe(false)
    expect(state.words.length).toBeGreaterThan(0)
  })
})
