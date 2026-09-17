import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { Blob as NodeBlob } from 'node:buffer'
import { createHash, webcrypto } from 'node:crypto'
import * as idb from '../lib/idb.js'
import { library, loadBook, loadCatalog, downloadBook, removeBook } from './library.js'

const pack = {
  schemaVersion: 1, id: 'fable', packVersion: 2, translationVersion: 3,
  source: { editionId: 'source-1', url: 'https://example.org/source' },
  rights: { original: 'public domain', translation: 'original translation' },
  sentences: [{ id: 'fable:p1:1', paragraph: 'p1', ru: 'Зима пришла.', en: 'Winter came.' }],
}
const bytes = new TextEncoder().encode(JSON.stringify(pack))
const entry = {
  id: 'fable', title: 'Fable', author: 'Author', shelf: 'Children’s',
  packVersion: 2, translationVersion: 3,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('crypto', webcrypto)
  library.books = []
  library.installed = {}
  library.status = 'idle'
  library.error = null
})
afterEach(() => vi.unstubAllGlobals())

describe('optional literature packs', () => {
  it('can reopen downloaded text and translations offline, then remove the pack', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer })))
    await downloadBook(entry)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect((await loadBook('fable')).sentences[0].en).toBe('Winter came.')
    await removeBook('fable')
    expect(await loadBook('fable')).toBeNull()
  })

  it('rejects corrupt updates without discarding the installed book', async () => {
    await idb.putBook({ id: 'fable', packVersion: 1, translationVersion: 1,
      blob: new NodeBlob([JSON.stringify({ ...pack, packVersion: 1, translationVersion: 1 })]) })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer })))
    await expect(downloadBook({ ...entry, sha256: '0'.repeat(64) })).rejects.toThrow('integrity')
    expect((await idb.getBook('fable')).packVersion).toBe(1)
  })

  it('lists cached catalog titles when the network is unavailable', async () => {
    await idb.setMeta('reader:catalog', { schemaVersion: 1, books: [entry] })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await loadCatalog()
    expect(library.books.map((book) => book.id)).toEqual(['fable'])
    expect(library.status).toBe('ready')
  })
})
