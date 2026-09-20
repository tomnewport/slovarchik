#!/usr/bin/env node
/**
 * check-reader-glosses.mjs — every tappable word in the shipped books resolves.
 *
 * The literature reader gives a learner exactly two kinds of help: reveal the
 * sentence, or tap one word. The tap goes through the ordinary dictionary index
 * (`lib/readerDictionary.js`), because a book pack deliberately carries no
 * lexicon of its own — so a word with no entry is a word the reader refuses to
 * explain, and nothing about an empty popup tells the learner that the word is
 * fine and the dictionary is thin (#782).
 *
 * This gate closes that: adding a book whose words are not in the dictionary
 * fails the build, in the same way that adding a phrase whose words are not in
 * the dictionary fails `glossCoverage.test.js`. It also checks the other half of
 * the bargain — that nothing added for a book's sake enters the curriculum.
 *
 * It reads the **editorial** sources in content/books/ through the pack
 * builder's own validation rather than the generated packs, so a new book is
 * measured the moment it is written rather than when someone remembers to run
 * `npm run gen:books`.
 *
 * The fix for a failure is never to delete the word: add a stress-marked
 * `learn: false` entry to public/vocab/reader-glosses.yml (or reader-nouns /
 * reader-names, where a paradigm earns its keep), which makes the word readable
 * without putting it in anyone's drills. docs/reader-glosses.md says how, and
 * which of these words deserve real curriculum entries instead.
 *
 * Usage:
 *   node scripts/check-reader-glosses.mjs          # the gate
 *   node scripts/check-reader-glosses.mjs --list   # the worklist, with context
 *   node scripts/check-reader-glosses.mjs --json   # machine-readable
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as yaml from 'js-yaml'

import { buildPack } from './build-book-packs.mjs'
import { buildWords, POS_BY_FILE } from '../src/lib/vocabBuild.js'
import { buildFormIndex } from '../src/lib/phraseHint.js'
import { lookupReaderWord } from '../src/lib/readerDictionary.js'
import { readerGlossCoverage, unglossedReaderWords } from '../src/lib/readerGlossCoverage.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The dictionary as the reader sees it: every entry, gloss-only ones included. */
export function readerLookup(vocabDir = resolve(ROOT, 'public/vocab')) {
  const files = readdirSync(vocabDir)
    .filter((name) => name.endsWith('.yml'))
    .map((name) => ({
      pos: POS_BY_FILE[name.replace(/\.ya?ml$/, '')],
      doc: yaml.load(readFileSync(resolve(vocabDir, name), 'utf8')),
    }))
    .filter((record) => record.pos)
  const words = buildWords(files)
  const index = buildFormIndex(words)
  const byKey = new Map(words.map((word) => [word.key, word]))
  return (surface) => lookupReaderWord(surface, index, byKey)
}

/**
 * Reader-only entries that would reach the drills.
 *
 * The reader is allowed to ship Chekhov's civil-service ranks and Lenin's
 * «каутскиа́нство» precisely because `learn: false` keeps them out of the vocab,
 * inflection and phrase drills and out of the batch/progress engine. One
 * forgotten flag and a learner is being asked to spell «столонача́льником», so
 * the gate checks the flag rather than trusting it.
 *
 * @param {{file: string, words: PlainObject}[]} docs  the reader-only vocab files
 * @returns {string[]} `file: key` for each entry missing `learn: false`
 */
export function curriculumLeaks(docs) {
  return (docs ?? []).flatMap(({ file, words }) =>
    Object.entries(words ?? {})
      .filter(([, word]) => word?.learn !== false)
      .map(([key]) => `${file}: ${key}`))
}

/** The reader-only vocab files, parsed. */
export function readerVocabDocs(vocabDir = resolve(ROOT, 'public/vocab')) {
  return readdirSync(vocabDir)
    .filter((name) => name.startsWith('reader-') && name.endsWith('.yml'))
    .sort()
    .map((name) => ({ file: name, words: yaml.load(readFileSync(resolve(vocabDir, name), 'utf8'))?.words }))
}

/** Every reviewed book, validated the way the pack builder validates it. */
export function readerBooks(sourceDir = resolve(ROOT, 'content/books')) {
  return readdirSync(sourceDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => buildPack(JSON.parse(readFileSync(resolve(sourceDir, name), 'utf8'))))
}

function report() {
  const books = readerBooks()
  const lookup = readerLookup()
  return { missing: unglossedReaderWords(books, lookup), coverage: readerGlossCoverage(books, lookup) }
}

function main() {
  const args = new Set(process.argv.slice(2))
  const { missing, coverage } = report()
  const tokens = coverage.reduce((sum, book) => sum + book.tokens, 0)
  const unglossed = coverage.reduce((sum, book) => sum + book.unglossed, 0)

  if (args.has('--json')) {
    console.log(JSON.stringify({ tokens, unglossed, missing, coverage }, null, 2))
    return 0
  }

  if (args.has('--list')) {
    for (const word of missing) {
      console.log(`${String(word.count).padStart(3)}  ${word.form}  [${word.books.join(', ')}]`)
      console.log(`     ${word.sentenceId}: ${word.ru.replace(/\s+/g, ' ')}`)
    }
  }

  for (const book of coverage) {
    const explained = book.tokens ? (100 * (book.tokens - book.unglossed)) / book.tokens : 100
    console.log(`${book.unglossed ? '✗' : '✓'} ${book.book.padEnd(28)} ${explained.toFixed(1)}% of ${book.tokens} words explained`)
  }

  const leaks = curriculumLeaks(readerVocabDocs())
  if (leaks.length) {
    console.log(`\n${leaks.length} reader-only entr(ies) without \`learn: false\` — they would enter the drills:`)
    for (const leak of leaks) console.log(`  ${leak}`)
  }

  if (!missing.length && !leaks.length) {
    console.log(`\nEvery one of the ${tokens} tappable words in the shipped books has a dictionary entry.`)
    return 0
  }
  if (!missing.length) return 1
  console.log(`\n${missing.length} word(s) with no dictionary entry, ${unglossed} occurrence(s) in all.`)
  if (!args.has('--list')) console.log('Run `npm run reader:glosses` to see them in context.')
  console.log('Add a stress-marked `learn: false` entry for each — see docs/reader-glosses.md.')
  return 1
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(ROOT, 'scripts/check-reader-glosses.mjs')) {
  process.exit(main())
}
