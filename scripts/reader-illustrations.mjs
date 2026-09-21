#!/usr/bin/env node
/**
 * reader-illustrations.mjs — what the reader would draw in each shipped book.
 *
 * The shipped books have three or four hand-picked story moments (or every beat
 * in a very short fable). A stem lexicon previews pictures while a new book is
 * being prepared; tests require curated choices before it ships. This prints
 * every picture each book would get beside the sentence it punctuates, so a
 * wrong or mistimed one is obvious.
 *
 * A review surface, not a gate: the unit tests hold the authored count, while
 * this is where a human judges the editorial choices.
 *
 * Usage:
 *   node scripts/reader-illustrations.mjs          # every shipped book
 *   node scripts/reader-illustrations.mjs --all    # every sentence, picture or not
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { illustrate } from '../src/lib/readerIllustrations.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packs = resolve(ROOT, 'public/books/packs')
const showAll = process.argv.includes('--all')

for (const file of readdirSync(packs).filter((name) => name.endsWith('.json')).sort()) {
  const pack = JSON.parse(readFileSync(resolve(packs, file), 'utf8'))
  const picked = illustrate(pack.sentences)
  const per = picked.size ? (pack.sentences.length / picked.size).toFixed(1) : '—'
  console.log(`\n## ${pack.id} — ${picked.size} pictures over ${pack.sentences.length} sentences (one every ${per})`)
  for (const sentence of pack.sentences) {
    const emoji = picked.get(sentence.id)
    if (!emoji && !showAll) continue
    const text = sentence.ru.replace(/\s+/g, ' ')
    console.log(`  ${emoji ?? '  '}  ${text.length > 96 ? `${text.slice(0, 95)}…` : text}`)
  }
}
