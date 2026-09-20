// Which words in the shipped literature the reader's tap dictionary cannot
// explain (#782).
//
// The reader's one help mechanism for a single word is the tap popup, and it
// resolves through the ordinary dictionary index — a book pack never carries a
// second dictionary. So a word with no entry is a word the reader silently
// refuses to explain, and the learner has no way to tell that from a word the
// app has simply got wrong.
//
// This module is the measurement behind the gate: given the shipped books and
// the same lookup the reader itself performs, it names every surface form that
// comes back empty, how often it occurs and where to read it in context. Pure
// and lookup-agnostic so the gate (scripts/check-reader-glosses.mjs) and its
// tests can feed it whatever dictionary they like.
import { readerTokens } from './readerDictionary.js'

/**
 * @typedef {object} UnglossedWord
 * @property {string} form        the surface form, lowercased, as it is printed
 * @property {number} count       how many token occurrences it accounts for
 * @property {string[]} books     ids of the books it appears in
 * @property {string} sentenceId  a sentence to read it in
 * @property {string} ru          that sentence's Russian
 */

/**
 * Every tappable word in these books that the lookup cannot explain.
 *
 * @param {{id: string, sentences: {id: string, ru: string}[]}[]} books
 * @param {(surface: string) => unknown[]} lookup  the reader's own word lookup
 * @returns {UnglossedWord[]} busiest form first, then alphabetical
 */
export function unglossedReaderWords(books, lookup) {
  const found = new Map()
  for (const book of books ?? []) {
    for (const sentence of book.sentences ?? []) {
      for (const token of readerTokens(sentence.ru)) {
        if (!token.word || lookup(token.text).length) continue
        const form = token.text.toLowerCase()
        const seen = found.get(form)
        if (seen) {
          seen.count += 1
          if (!seen.books.includes(book.id)) seen.books.push(book.id)
        } else {
          found.set(form, { form, count: 1, books: [book.id], sentenceId: sentence.id, ru: sentence.ru })
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.form.localeCompare(b.form, 'ru'))
}

/**
 * How much of a book the reader can explain, as occurrences rather than types:
 * one unglossed word in a sentence is one word the learner is left alone with.
 *
 * @param {{id: string, sentences: {id: string, ru: string}[]}[]} books
 * @param {(surface: string) => unknown[]} lookup
 * @returns {{book: string, tokens: number, unglossed: number}[]}
 */
export function readerGlossCoverage(books, lookup) {
  return (books ?? []).map((book) => {
    let tokens = 0
    let unglossed = 0
    for (const sentence of book.sentences ?? []) {
      for (const token of readerTokens(sentence.ru)) {
        if (!token.word) continue
        tokens += 1
        if (!lookup(token.text).length) unglossed += 1
      }
    }
    return { book: book.id, tokens, unglossed }
  })
}
