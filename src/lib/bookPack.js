// A book's text and prepared translations are one versioned, opt-in JSON pack.
// Lexical meaning stays in the separately cached Slovarchik dictionary.
export const SHELVES = ['Children’s', 'Beginner', 'Intermediate', 'Advanced', 'Political']

export function validateCatalog(data) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.books)) throw new Error('Unsupported book catalog')
  const ids = new Set()
  for (const entry of data.books) {
    if (!/^[a-z0-9-]+$/.test(entry.id ?? '') || ids.has(entry.id) ||
      !SHELVES.includes(entry.shelf) || !entry.title || !entry.author ||
      !/^https:\/\//.test(entry.source?.url ?? '') || !entry.rights?.original || !entry.rights?.translation ||
      !Number.isInteger(entry.packVersion) || !Number.isInteger(entry.translationVersion) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) throw new Error('Invalid book catalog entry')
    ids.add(entry.id)
  }
  return data.books
}

export function validatePack(pack, entry) {
  if (pack?.schemaVersion !== 1 || pack.id !== entry.id ||
    pack.packVersion !== entry.packVersion || pack.translationVersion !== entry.translationVersion ||
    !pack.source?.editionId || !pack.source?.url || !pack.rights?.original ||
    !pack.rights?.translation || !['prose', 'verse'].includes(pack.form) ||
    !Array.isArray(pack.sentences) || !pack.sentences.length) {
    throw new Error('Book pack does not match the catalog')
  }
  const ids = new Set()
  for (const sentence of pack.sentences) {
    if (!sentence.id?.startsWith(`${pack.id}:`) || ids.has(sentence.id) ||
      typeof sentence.paragraph !== 'string' || !sentence.paragraph ||
      typeof sentence.ru !== 'string' || !sentence.ru.trim() ||
      typeof sentence.en !== 'string' || !sentence.en.trim()) {
      throw new Error('Invalid or untranslated sentence in book pack')
    }
    ids.add(sentence.id)
  }
  return pack
}

export async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('Downloads require a secure connection (HTTPS or localhost).')
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
