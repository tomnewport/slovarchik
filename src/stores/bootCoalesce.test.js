// The four boot loaders under concurrency (#659).
//
// `main.js` fires `initVocab`, `loadProgress` and `loadSettings` without
// awaiting them, and every deep-linkable view repeats the call from its own
// `onMounted`. The reproduction in the issue is a deep link straight into a
// drill: both callers run the whole boot, so every fetch and every IndexedDB
// write happens twice. Each test here is that reproduction — two concurrent
// calls — asserting the work happens once.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

// Spy on the storage boundary so the tests can count transactions, not just
// fetches: the duplicated IndexedDB writes are half of what the issue reports.
vi.mock('../lib/idb.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getAllProgress: vi.fn(actual.getAllProgress),
    getAllReports: vi.fn(actual.getAllReports),
    getAllFiles: vi.fn(actual.getAllFiles),
    getMeta: vi.fn(actual.getMeta),
    putFile: vi.fn(actual.putFile),
  }
})

import * as idb from '../lib/idb.js'
import { state as vocabState, initVocab, syncFromNetwork } from './vocab.js'
import { state as progressState, loadProgress } from './progress.js'
import { settings, loadSettings } from './settings.js'
import { state as reportsState, loadReports } from './reports.js'

/** Three tiny files, so a duplicated boot is visible as 3 requests vs 6. */
const FILES = [
  { pos: 'adverb', file: 'adverbs.json', hash: 'a1' },
  { pos: 'preposition', file: 'prepositions.json', hash: 'p1' },
  { pos: 'conjunction', file: 'conjunctions.json', hash: 'c1' },
]

const manifest = { version: 7, files: FILES }

const docFor = (file) => ({
  words: {
    [`слово-${file}=word`]: { cefr_level: 'A1', en_gb: { standard: `word (${file})` } },
  },
})

/**
 * A fetch mock that resolves on a later microtask turn, so a second caller has
 * a real chance to start its own request before the first one finishes — the
 * race the coalescing has to win.
 */
function mockFetch() {
  return vi.fn(async (url) => {
    await Promise.resolve()
    const name = String(url).split('/').pop()
    if (name === 'manifest.json') return { ok: true, json: async () => manifest }
    if (FILES.some((f) => f.file === name)) {
      return { ok: true, json: async () => docFor(name) }
    }
    return { ok: false, status: 404 }
  })
}

const countOf = (fetchMock, name) =>
  fetchMock.mock.calls.filter(([u]) => String(u).endsWith(name)).length

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  vi.clearAllMocks()

  vocabState.words = []
  vocabState.status = 'idle'
  vocabState.error = null
  vocabState.vocabVersion = null

  progressState.loaded = false
  progressState.records = {}

  settings.loaded = false

  reportsState.loaded = false
  reportsState.pending = []
})

describe('initVocab coalescing', () => {
  it('issues exactly one request per file for two concurrent boots', async () => {
    const fetchMock = mockFetch()
    globalThis.fetch = fetchMock

    const [a, b] = await Promise.all([initVocab(), initVocab()])

    expect(a).toBe('ready')
    expect(b).toBe('ready')
    expect(countOf(fetchMock, 'manifest.json')).toBe(1)
    for (const f of FILES) expect(countOf(fetchMock, f.file)).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1 + FILES.length)
  })

  it('writes each cached file to IndexedDB once for two concurrent boots', async () => {
    globalThis.fetch = mockFetch()

    await Promise.all([initVocab(), initVocab()])

    expect(idb.putFile).toHaveBeenCalledTimes(FILES.length)
    const cached = await idb.getAllFiles()
    expect(cached.map((r) => r.file).sort()).toEqual(FILES.map((f) => f.file).sort())
  })

  it('joins a manual syncFromNetwork to the sync already running under a boot', async () => {
    const fetchMock = mockFetch()
    globalThis.fetch = fetchMock

    // The Data screen's "check for updates" button (DataView.vue) firing while
    // the boot it raced is still in flight.
    const [status] = await Promise.all([initVocab(), syncFromNetwork()])

    expect(status).toBe('ready')
    expect(countOf(fetchMock, 'manifest.json')).toBe(1)
    for (const f of FILES) expect(countOf(fetchMock, f.file)).toBe(1)
  })

  it('leaves a single boot behaving exactly as before', async () => {
    const fetchMock = mockFetch()
    globalThis.fetch = fetchMock

    expect(await initVocab()).toBe('ready')
    expect(vocabState.words.length).toBe(FILES.length)
    expect(vocabState.vocabVersion).toBe(7)
    expect(fetchMock).toHaveBeenCalledTimes(1 + FILES.length)
  })

  it('is de-duplication, not a latch: a later call still syncs', async () => {
    globalThis.fetch = mockFetch()
    await initVocab()

    const second = mockFetch()
    globalThis.fetch = second
    expect(await initVocab()).toBe('ready')

    // Manifest re-checked; the files themselves are cache-valid, so skipped.
    expect(countOf(second, 'manifest.json')).toBe(1)
    expect(countOf(second, 'adverbs.json')).toBe(0)
  })

  it('reports the same failure to both callers and stays retryable', async () => {
    globalThis.fetch = vi.fn(async () => {
      await Promise.resolve()
      return { ok: false, status: 503 }
    })

    const [a, b] = await Promise.all([initVocab(), initVocab()])
    expect(a).toBe('error')
    expect(b).toBe('error')
    expect(vocabState.error).toBeInstanceOf(Error)

    globalThis.fetch = mockFetch()
    expect(await initVocab()).toBe('ready')
  })
})

describe('loadProgress coalescing', () => {
  it('reads the records and runs the migration pass once', async () => {
    await idb.putProgress({ word: 'дом=house', events: [], known: true })

    const [a, b] = await Promise.all([loadProgress(), loadProgress()])

    expect(idb.getAllProgress).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(progressState.loaded).toBe(true)
    expect(Object.keys(progressState.records)).toEqual(['дом=house'])
  })

  it('leaves a single load behaving exactly as before', async () => {
    await idb.putProgress({ word: 'дом=house', events: [], known: true })

    await loadProgress()

    expect(idb.getAllProgress).toHaveBeenCalledTimes(1)
    expect(progressState.records['дом=house'].known).toBe(true)
    expect(progressState.firstUseAt).toBeTypeOf('number')
  })
})

describe('loadSettings coalescing', () => {
  it('reads each stored preference key once for two concurrent calls', async () => {
    await idb.setMeta('feedbackSounds', { successSound: 'off' })
    vi.clearAllMocks()

    await Promise.all([loadSettings(), loadSettings()])

    const keys = idb.getMeta.mock.calls.map(([k]) => k)
    expect(keys.filter((k) => k === 'feedbackSounds')).toHaveLength(1)
    expect(keys.filter((k) => k === 'wordFacts')).toHaveLength(1)
    expect(settings.successSound).toBe('off')
    expect(settings.loaded).toBe(true)
  })
})

describe('loadReports coalescing', () => {
  it('reads the queue once for two concurrent calls', async () => {
    await Promise.all([loadReports(), loadReports()])

    expect(idb.getAllReports).toHaveBeenCalledTimes(1)
    expect(reportsState.loaded).toBe(true)
  })
})
