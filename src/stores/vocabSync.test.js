// Concurrency of the manifest walk in `syncFromNetwork` (#660).
//
// The old loop awaited each file in turn, so a 12-file manifest stacked 13
// round trips before the app had a single word. Nothing in the walk is
// order-dependent, so these tests pin the two properties that matter: the
// requests go out together, and one bad file still doesn't cost the others.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import * as idb from '../lib/idb.js'
import { state, syncFromNetwork } from './vocab.js'

const FILES = [
  { pos: 'adverb', file: 'adverbs.json', hash: 'a1' },
  { pos: 'preposition', file: 'prepositions.json', hash: 'p1' },
  { pos: 'conjunction', file: 'conjunctions.json', hash: 'c1' },
  { pos: 'interjection', file: 'interjections.json', hash: 'i1' },
]

const manifest = () => ({ version: 3, files: FILES.map((f) => ({ ...f })) })
const docFor = (file) => ({
  words: { [`слово-${file}=word`]: { cefr_level: 'A1', en_gb: { standard: `w ${file}` } } },
})

const nameOf = (url) => String(url).split('/').pop()

/**
 * A fetch mock that holds every vocab-file response open until released, so a
 * serialised implementation deadlocks on the first file and a concurrent one
 * has all four in flight. `inFlight` is the high-water mark of open requests.
 */
function gatedFetch(mf = manifest()) {
  const gates = []
  let open = 0
  let inFlight = 0
  const fetchMock = vi.fn(async (url) => {
    const name = nameOf(url)
    if (name === 'manifest.json') return { ok: true, json: async () => mf }
    open += 1
    inFlight = Math.max(inFlight, open)
    await new Promise((resolve) => gates.push(resolve))
    open -= 1
    return { ok: true, json: async () => docFor(name) }
  })
  return {
    fetchMock,
    releaseAll: () => gates.splice(0).forEach((r) => r()),
    pending: () => gates.length,
    peak: () => inFlight,
  }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  state.words = []
  state.status = 'idle'
  state.error = null
  state.lastSyncedAt = null
})

describe('syncFromNetwork downloads the stale files concurrently', () => {
  it('issues every stale request before any of them resolves', async () => {
    const gate = gatedFetch()
    globalThis.fetch = gate.fetchMock

    const sync = syncFromNetwork()
    // Let the manifest fetch and the filter settle, without releasing a file.
    await vi.waitFor(() => expect(gate.pending()).toBe(FILES.length))

    // All four are open at once — the serialised loop could only ever have one.
    expect(gate.peak()).toBe(FILES.length)
    const requested = gate.fetchMock.mock.calls.map(([u]) => nameOf(u))
    for (const f of FILES) expect(requested).toContain(f.file)

    gate.releaseAll()
    expect(await sync).toBe(true)
    expect((await idb.getAllFiles()).map((r) => r.file).sort()).toEqual(
      FILES.map((f) => f.file).sort(),
    )
  })

  it('skips a single bad file and still caches the rest', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const name = nameOf(url)
      if (name === 'manifest.json') return { ok: true, json: async () => manifest() }
      if (name === 'prepositions.json') return { ok: false, status: 404 }
      return { ok: true, json: async () => docFor(name) }
    })

    expect(await syncFromNetwork()).toBe(true)

    const cached = (await idb.getAllFiles()).map((r) => r.file).sort()
    expect(cached).toEqual(['adverbs.json', 'conjunctions.json', 'interjections.json'])
    expect(state.words.length).toBe(3)
  })

  it('propagates a thrown fetch, but only after its siblings have cached', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const name = nameOf(url)
      if (name === 'manifest.json') return { ok: true, json: async () => manifest() }
      if (name === 'conjunctions.json') throw new TypeError('network down')
      return { ok: true, json: async () => docFor(name) }
    })

    await expect(syncFromNetwork()).rejects.toThrow('network down')

    // The three that succeeded are cached and in the store, rather than being
    // abandoned along with the one that failed.
    const cached = (await idb.getAllFiles()).map((r) => r.file).sort()
    expect(cached).toEqual(['adverbs.json', 'interjections.json', 'prepositions.json'])
    expect(state.words.length).toBe(3)
    // A failed sync still leaves the "last synced" stamp alone, as before.
    expect(state.lastSyncedAt).toBe(null)
  })

  it('does not re-request a file the cache already holds', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const name = nameOf(url)
      if (name === 'manifest.json') return { ok: true, json: async () => manifest() }
      return { ok: true, json: async () => docFor(name) }
    })
    await syncFromNetwork()

    const second = vi.fn(async (url) => {
      const name = nameOf(url)
      if (name === 'manifest.json') return { ok: true, json: async () => manifest() }
      return { ok: true, json: async () => docFor(name) }
    })
    globalThis.fetch = second

    expect(await syncFromNetwork()).toBe(false)
    expect(second.mock.calls.map(([u]) => nameOf(u))).toEqual(['manifest.json'])
  })

  it('prunes every unlisted record together', async () => {
    for (const file of ['nouns.yml', 'verbs.yml', 'adjectives.yml']) {
      await idb.putFile({ file, pos: 'noun', updated: '2026-05-28T00:00:00Z', content: '# stale' })
    }
    globalThis.fetch = vi.fn(async (url) => {
      const name = nameOf(url)
      if (name === 'manifest.json') return { ok: true, json: async () => manifest() }
      return { ok: true, json: async () => docFor(name) }
    })

    expect(await syncFromNetwork()).toBe(true)

    const files = (await idb.getAllFiles()).map((r) => r.file)
    expect(files.filter((f) => f.endsWith('.yml'))).toEqual([])
    expect(files.sort()).toEqual(FILES.map((f) => f.file).sort())
  })

  it('prunes even when nothing needed downloading', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const name = nameOf(url)
      if (name === 'manifest.json') return { ok: true, json: async () => manifest() }
      return { ok: true, json: async () => docFor(name) }
    })
    await syncFromNetwork()
    await idb.putFile({ file: 'gone.json', pos: 'noun', updated: 'x', doc: { words: {} } })

    // Every manifest file is cache-valid, so the only change is the deletion.
    expect(await syncFromNetwork()).toBe(true)
    expect((await idb.getAllFiles()).map((r) => r.file)).not.toContain('gone.json')
  })
})
