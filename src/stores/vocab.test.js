import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import * as idb from '../lib/idb.js'
import { state, loadFromCache, syncFromNetwork } from './vocab.js'

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

    for (const w of state.words) {
      expect(w.facts, `${w.key}: facts`).toEqual([])
      expect(w.confusables, `${w.key}: confusables`).toEqual([])
    }
  })
})
