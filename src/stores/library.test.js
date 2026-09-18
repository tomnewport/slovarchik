import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { Blob as NodeBlob } from 'node:buffer'
import { createHash, webcrypto } from 'node:crypto'
import * as idb from '../lib/idb.js'
import { failWrites } from '../test/idbFailure.js'
import { validateCatalog } from '../lib/bookPack.js'
import { library, loadBook, loadCatalog, downloadBook, removeBook } from './library.js'

const pack = {
  schemaVersion: 1, id: 'fable', form: 'prose', packVersion: 2, translationVersion: 3,
  source: { editionId: 'source-1', url: 'https://example.org/source' },
  rights: { original: 'public domain', translation: 'original translation' },
  sentences: [{ id: 'fable:p1:1', paragraph: 'p1', ru: 'Зима пришла.', en: 'Winter came.' }],
}
const bytes = new TextEncoder().encode(JSON.stringify(pack))
const entry = {
  id: 'fable', title: 'Fable', author: 'Author', shelf: 'Children’s',
  source: pack.source, rights: pack.rights,
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

  it('replaces a corrupt cached catalog with the network copy', async () => {
    await idb.setMeta('reader:catalog', { schemaVersion: 0, books: [entry] })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ schemaVersion: 1, books: [entry] }) })))
    await loadCatalog()
    expect(library.books.map((book) => book.id)).toEqual(['fable'])
    expect(library.status).toBe('ready')
    expect(await idb.getMeta('reader:catalog')).toEqual({ schemaVersion: 1, books: [entry] })
  })

  it('shows unavailable when both the cached catalog and network fail', async () => {
    await idb.setMeta('reader:catalog', { schemaVersion: 0, books: [entry] })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await loadCatalog()
    expect(library.books).toEqual([])
    expect(library.status).toBe('unavailable')
    expect(library.error).toBe('offline')
  })

  it('rejects an unsafe source link in a cached catalog', () => {
    expect(() => validateCatalog({ schemaVersion: 1, books: [
      { ...entry, source: { ...entry.source, url: 'javascript:alert(1)' } },
    ] })).toThrow('Invalid book catalog entry')
  })

  it('explains when a download cannot be verified without a secure context', async () => {
    vi.stubGlobal('crypto', {})
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer })))
    await expect(downloadBook(entry)).rejects.toThrow('secure connection')
    expect(library.error).toMatch(/secure connection/)
  })

  it('keeps an installed book visible and reports a failed removal', async () => {
    await idb.putBook({ id: 'fable', packVersion: 2, translationVersion: 3, blob: new NodeBlob([JSON.stringify(pack)]) })
    library.installed.fable = { packVersion: 2, translationVersion: 3 }
    const restore = await failWrites({ stores: ['book-packs'] })
    try {
      await expect(removeBook('fable')).rejects.toThrow()
      expect(library.installed.fable).toBeDefined()
      expect(library.error).toBeTruthy()
      expect(library.busyId).toBeNull()
    } finally { restore() }
  })
})
