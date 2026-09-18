// Build independently versioned, downloadable literary data from reviewed
// editorial JSON. Run before Vite so public/books/ is ready to copy to dist/.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const sourceDir = resolve(root, 'content/books')
const outputDir = resolve(root, 'public/books/packs')
const catalogFile = resolve(root, 'public/books/catalog.json')
const SHELVES = ['Children’s', 'Beginner', 'Intermediate', 'Advanced', 'Political']

export function buildPack(source) {
  if (!/^[a-z0-9-]+$/.test(source?.id ?? '') || !SHELVES.includes(source.shelf) ||
    !source.title || !source.author || !source.summary ||
    !['prose', 'verse'].includes(source.form ?? 'prose') ||
    !Number.isInteger(source.packVersion) || source.packVersion < 1 ||
    !Number.isInteger(source.translationVersion) || source.translationVersion < 1 ||
    !source.source?.editionId || !/^https:\/\//.test(source.source.url ?? '') ||
    !source.rights?.original || !source.rights?.translation ||
    !source.translationReview?.method || !Array.isArray(source.sentences) || !source.sentences.length) {
    throw new Error(`Incomplete editorial book: ${source?.id ?? '(unnamed)'}`)
  }
  const ids = new Set()
  const sentences = source.sentences.map((s) => {
    if (!s.id?.startsWith(`${source.id}:`) || ids.has(s.id) ||
      typeof s.paragraph !== 'string' || !s.paragraph ||
      !s.ru?.trim() || !s.en?.trim() || s.review !== 'checked') {
      throw new Error(`Unreviewed, untranslated or duplicate sentence: ${s.id ?? '(unnamed)'}`)
    }
    ids.add(s.id)
    return { id: s.id, paragraph: s.paragraph, ru: s.ru.trim(), en: s.en.trim() }
  })
  return {
    schemaVersion: 1,
    id: source.id,
    title: source.title,
    author: source.author,
    shelf: source.shelf,
    form: source.form ?? 'prose',
    packVersion: source.packVersion,
    translationVersion: source.translationVersion,
    source: source.source,
    rights: source.rights,
    sentences,
  }
}

/** Corpus edits must advertise a new data version; translations can change alone. */
export function assertVersionBump(previous, next) {
  if (!previous || previous.id !== next.id) return
  const text = (pack) => pack.sentences.map(({ id, paragraph, ru }) => ({ id, paragraph, ru }))
  const changedText = JSON.stringify(text(previous)) !== JSON.stringify(text(next)) ||
    ['title', 'author', 'shelf', 'form'].some((key) => previous[key] !== next[key]) ||
    JSON.stringify(previous.source) !== JSON.stringify(next.source) ||
    JSON.stringify(previous.rights) !== JSON.stringify(next.rights)
  const changedEnglish = JSON.stringify(previous.sentences.map((s) => s.en)) !==
    JSON.stringify(next.sentences.map((s) => s.en))
  if (changedText && next.packVersion <= previous.packVersion) throw new Error(`${next.id}: raise packVersion after a text/metadata change`)
  if (changedEnglish && next.translationVersion <= previous.translationVersion) throw new Error(`${next.id}: raise translationVersion after an English correction`)
  if (next.packVersion < previous.packVersion || next.translationVersion < previous.translationVersion) throw new Error(`${next.id}: data versions cannot decrease`)
}

export function main() {
  mkdirSync(outputDir, { recursive: true })
  const entries = []
  for (const filename of readdirSync(sourceDir).filter((name) => name.endsWith('.json')).sort()) {
    const source = JSON.parse(readFileSync(resolve(sourceDir, filename), 'utf8'))
    const pack = buildPack(source)
    const output = resolve(outputDir, `${pack.id}.json`)
    const previous = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null
    assertVersionBump(previous, pack)
    const bytes = Buffer.from(`${JSON.stringify(pack, null, 2)}\n`)
    writeFileSync(output, bytes)
    entries.push({ id: pack.id, title: pack.title, author: pack.author, shelf: pack.shelf,
      summary: source.summary, packVersion: pack.packVersion,
      translationVersion: pack.translationVersion, source: pack.source, rights: pack.rights,
      sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  writeFileSync(catalogFile, `${JSON.stringify({ schemaVersion: 1, books: entries }, null, 2)}\n`)
  return entries.length
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(root, 'scripts/build-book-packs.mjs')) {
  console.log(`Built ${main()} literature pack(s)`)
}
