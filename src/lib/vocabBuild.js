// Pure functions that turn raw YAML file contents into the normalised, queryable
// word records used across the app. No I/O here (no fetch, no IndexedDB) so it
// stays trivially testable; the store layer feeds it raw text.
import yaml from 'js-yaml'

import { CASES, NUMBERS } from './declension.js'
import { stripStress } from './text.js'

/** Map a vocab filename (without extension) to its part of speech. */
export const POS_BY_FILE = {
  nouns: 'noun',
  pronouns: 'pronoun',
  verbs: 'verb',
  adjectives: 'adjective',
  adverbs: 'adverb',
  prepositions: 'preposition',
}

/** Parts of speech in a stable display order. */
export const partsOfSpeech = ['noun', 'pronoun', 'verb', 'adjective', 'adverb', 'preposition']

/** Split the "<russian>=<english>" natural key. */
export function parseKey(key) {
  const i = key.indexOf('=')
  if (i === -1) return { ru: key.trim(), en: '' }
  return { ru: key.slice(0, i).trim(), en: key.slice(i + 1).trim() }
}

/** The short gloss before any parenthetical clarification. */
function shortGloss(text) {
  return String(text ?? '')
    .split('(')[0]
    .trim()
}

/** The clarification inside parentheses, if any. */
function glossNote(text) {
  const m = String(text ?? '').match(/\(([^)]*)\)/)
  return m ? m[1].trim() : ''
}

/** Convert a flat declension map (sg_nom, pl_gen, …) into nested forms. */
function nestForms(declension, numbers) {
  const forms = {}
  for (const num of numbers) {
    const slot = {}
    for (const c of CASES) {
      const key = `${num}_${c}`
      if (declension && declension[key] != null) slot[c] = declension[key]
    }
    if (Object.keys(slot).length) forms[num] = slot
  }
  return forms
}

/** Pick the accented dictionary form to display. */
function headwordOf(pos, word, forms, bareRu) {
  if (word.accented) return word.accented
  if (pos === 'noun') {
    const num = NUMBERS.find((n) => forms[n]?.nom)
    if (num) return forms[num].nom
  }
  if (word.forms?.m) return word.forms.m // adjectives
  if (word.forms?.nom) return word.forms.nom // pronouns
  return bareRu
}

function normalizeWord(pos, key, word) {
  const { ru, en } = parseKey(key)
  const std = word.en_gb?.standard ?? en
  const alts = word.en_gb?.alt ?? []

  const numbers = pos === 'noun' ? (word.number ?? ['sg', 'pl']) : []
  const forms = pos === 'noun' ? nestForms(word.declension, numbers) : {}
  const headword = headwordOf(pos, word, forms, ru)

  // Accepted English answers: the key gloss plus the short form of the standard
  // and alternate meanings.
  const english = [...new Set([en, shortGloss(std), ...alts.map(shortGloss)].filter(Boolean))]

  return {
    key,
    pos,
    ru, // bare Russian (no stress marks) — the key's identity
    en, // bare English from the key
    headword, // accented dictionary form for display
    cefr: word.cefr_level ?? null,
    meaning: shortGloss(std),
    meaningNote: glossNote(std),
    meaningFull: std,
    meaningsAlt: alts,
    english,
    usage: word.usage ?? [],
    collections: word.collections ?? [],
    gender: word.gender ?? null,
    animacy: word.animacy ?? null,
    animate: word.animacy === 'a',
    numbers,
    forms,
    extra: word,
  }
}

/**
 * Build the full, sorted word list from raw file contents.
 * @param {Array<{pos: string, text: string}>} files
 * @returns {object[]}
 */
export function buildWords(files) {
  const out = []
  for (const { pos, text } of files) {
    if (!pos) continue
    const doc = yaml.load(text) ?? {}
    for (const [key, word] of Object.entries(doc.words ?? {})) {
      out.push(normalizeWord(pos, key, word ?? {}))
    }
  }
  // Sort alphabetically by Russian headword, ignoring stress marks.
  return out.sort((a, b) => stripStress(a.ru).localeCompare(stripStress(b.ru), 'ru'))
}

/** Shape words for the vocabulary (translation) drill. */
export function shapeVocab(words) {
  return words.map((w) => ({
    id: w.key,
    ru: w.headword || w.ru,
    en: w.english,
    pos: w.pos,
    cefr: w.cefr,
    note: w.meaningNote,
  }))
}

/**
 * Shape usage examples into a phrase bank for the phrase drill. Every word may
 * carry example sentences as `{ ru, en_gb }` pairs; we flatten them all into a
 * single deduplicated list of translatable phrases.
 */
export function shapePhrases(words) {
  const seen = new Set()
  const out = []
  for (const w of words) {
    for (const ex of w.usage ?? []) {
      const ru = String(ex?.ru ?? '').trim()
      const en = String(ex?.en_gb ?? '').trim()
      if (!ru || !en) continue
      const id = `${ru}=${en}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ id, ru, en, source: w.key, cefr: w.cefr })
    }
  }
  return out
}

/** Shape declinable nouns for the declension drill. */
export function shapeNouns(words) {
  return words
    .filter((w) => w.pos === 'noun' && Object.keys(w.forms).length > 0)
    .map((w) => ({
      id: w.key,
      lemma: w.headword || w.ru,
      en: w.meaning,
      cefr: w.cefr,
      gender: w.gender,
      animacy: w.animacy,
      animate: w.animate,
      numbers: w.numbers,
      forms: w.forms,
    }))
}
