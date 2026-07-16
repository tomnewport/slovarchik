import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as idb from '../lib/idb.js'
import { state, loadFromCache, syncFromNetwork } from './vocab.js'

const nounsYml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../public/vocab/nouns.yml'),
  'utf8',
)

const manifest = {
  version: 1,
  files: [{ pos: 'noun', file: 'nouns.yml', updated: '2026-05-28T00:00:00Z' }],
}

function mockFetch() {
  return vi.fn(async (url) => {
    if (String(url).endsWith('manifest.json')) {
      return { ok: true, json: async () => manifest }
    }
    if (String(url).endsWith('nouns.yml')) {
      return { ok: true, text: async () => nounsYml }
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
    expect(cached.map((r) => r.file)).toContain('nouns.yml')
  })

  it('does not re-download a file whose timestamp is unchanged', async () => {
    const fetch1 = mockFetch()
    globalThis.fetch = fetch1
    await syncFromNetwork()
    const downloadsFirst = fetch1.mock.calls.filter(([u]) => String(u).endsWith('.yml')).length
    expect(downloadsFirst).toBe(1)

    const fetch2 = mockFetch()
    globalThis.fetch = fetch2
    const changed = await syncFromNetwork()
    expect(changed).toBe(false)
    const downloadsSecond = fetch2.mock.calls.filter(([u]) => String(u).endsWith('.yml')).length
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
      files: [{ pos: 'noun', file: 'nouns.yml', updated: '2026-05-28T00:00:00Z', hash: 'aaaa' }],
    }
    const build = () =>
      vi.fn(async (url) => {
        if (String(url).endsWith('manifest.json')) return { ok: true, json: async () => hashed }
        if (String(url).endsWith('nouns.yml')) return { ok: true, text: async () => nounsYml }
        return { ok: false, status: 404 }
      })

    globalThis.fetch = build()
    await syncFromNetwork()

    // Timestamp changes but the hash is the same → no re-download.
    hashed.files[0].updated = '2026-09-09T00:00:00Z'
    const noop = build()
    globalThis.fetch = noop
    expect(await syncFromNetwork()).toBe(false)
    expect(noop.mock.calls.filter(([u]) => String(u).endsWith('.yml')).length).toBe(0)

    // Hash changes → re-download even if the timestamp is unchanged.
    hashed.files[0].hash = 'bbbb'
    const refetch = build()
    globalThis.fetch = refetch
    expect(await syncFromNetwork()).toBe(true)
    expect(refetch.mock.calls.filter(([u]) => String(u).endsWith('.yml')).length).toBe(1)
  })

  it('loads previously cached files without any network', async () => {
    await idb.putFile({
      file: 'nouns.yml',
      pos: 'noun',
      updated: '2026-05-28T00:00:00Z',
      content: nounsYml,
    })
    globalThis.fetch = vi.fn(() => {
      throw new Error('should not be called')
    })

    const records = await loadFromCache()
    expect(records.length).toBe(1)
    expect(state.words.length).toBeGreaterThan(0)
  })
})
