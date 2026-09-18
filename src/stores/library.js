import { reactive } from 'vue'
import * as idb from '../lib/idb.js'
import { coalesce } from '../lib/coalesce.js'
import { sha256, validateCatalog, validatePack } from '../lib/bookPack.js'

const BASE = import.meta.env.BASE_URL || '/'
const catalogUrl = `${BASE}books/catalog.json`

export const library = reactive({
  status: 'idle',
  books: [],
  installed: {},
  busyId: null,
  error: null,
})

async function doLoadCatalog() {
  library.status = 'loading'
  library.error = null
  const [installed, cached] = await Promise.all([idb.getAllBooks(), idb.getMeta('reader:catalog')])
  library.installed = Object.fromEntries(installed.map(({ id, packVersion, translationVersion }) =>
    [id, { packVersion, translationVersion }]))
  library.books = []
  let validCached = false
  if (cached) {
    try {
      library.books = validateCatalog(cached)
      validCached = true
    } catch { /* A damaged local copy must not prevent a fresh catalog fetch. */ }
  }
  try {
    const response = await fetch(catalogUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Catalog download failed (${response.status})`)
    const catalog = await response.json()
    library.books = validateCatalog(catalog)
    await idb.setMeta('reader:catalog', catalog)
    library.status = 'ready'
  } catch (error) {
    library.status = validCached ? 'ready' : 'unavailable'
    if (!validCached) library.error = error.message
  }
  return library.books
}

export const loadCatalog = coalesce(doLoadCatalog)

/** Read only the one requested Blob; listing the library never parses novels. */
export async function loadBook(id) {
  const record = await idb.getBook(id)
  if (!record) return null
  const pack = JSON.parse(await record.blob.text())
  return validatePack(pack, { id, packVersion: record.packVersion, translationVersion: record.translationVersion })
}

/** A failed fetch/hash/write leaves any previously installed version intact. */
export async function downloadBook(entry) {
  library.busyId = entry.id
  library.error = null
  try {
    const response = await fetch(`${BASE}books/packs/${entry.id}.json`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Book download failed (${response.status})`)
    const bytes = await response.arrayBuffer()
    if (await sha256(bytes) !== entry.sha256) throw new Error('Book download failed its integrity check')
    const json = new TextDecoder().decode(bytes)
    validatePack(JSON.parse(json), entry)
    await idb.putBook({ id: entry.id, packVersion: entry.packVersion,
      translationVersion: entry.translationVersion, blob: new Blob([json], { type: 'application/json' }) })
    library.installed[entry.id] = { packVersion: entry.packVersion, translationVersion: entry.translationVersion }
  } catch (error) {
    library.error = error.message
    throw error
  } finally {
    library.busyId = null
  }
}

export async function removeBook(id) {
  library.busyId = id
  library.error = null
  try {
    await idb.deleteBook(id)
    delete library.installed[id]
  } catch (error) {
    library.error = error.message
    throw error
  } finally {
    library.busyId = null
  }
}
