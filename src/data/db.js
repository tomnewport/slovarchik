// Loads every YAML file under ./vocab/ at startup and builds an in-memory,
// queryable vocabulary database. Files are bundled as raw strings (so it works
// offline with no fetch) and parsed once on import.
import yaml from 'js-yaml'

import { CASES, NUMBERS } from '../lib/declension.js'
import { stripStress } from '../lib/text.js'

// e.g. './vocab/nouns.yml' -> raw file contents.
const raw = import.meta.glob('./vocab/*.yml', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// Map a filename to its part of speech (singular).
const POS_BY_FILE = {
  nouns: 'noun',
  pronouns: 'pronoun',
  verbs: 'verb',
  adjectives: 'adjective',
  adverbs: 'adverb',
  prepositions: 'preposition',
}

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

  const numbers = pos === 'noun' ? word.number ?? ['sg', 'pl'] : []
  const forms = pos === 'noun' ? nestForms(word.declension, numbers) : {}
  const headword = headwordOf(pos, word, forms, ru)

  // Accepted English answers for the vocab drill: the key gloss plus the short
  // form of the standard and alternate meanings.
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
    // Noun-specific (empty for other POS):
    gender: word.gender ?? null,
    animacy: word.animacy ?? null,
    animate: word.animacy === 'a',
    numbers,
    forms,
    // Everything else (conjugation, governs, type, …) stays available.
    extra: word,
  }
}

function loadAll() {
  const out = []
  for (const [path, text] of Object.entries(raw)) {
    const file = path.split('/').pop().replace(/\.ya?ml$/, '')
    const pos = POS_BY_FILE[file]
    if (!pos) continue
    const doc = yaml.load(text) ?? {}
    for (const [key, word] of Object.entries(doc.words ?? {})) {
      out.push(normalizeWord(pos, key, word ?? {}))
    }
  }
  // Sort alphabetically by Russian headword, ignoring stress marks.
  return out.sort((a, b) => stripStress(a.ru).localeCompare(stripStress(b.ru), 'ru'))
}

/** Every word, sorted alphabetically. */
export const words = loadAll()

/** Words grouped by part of speech. */
export const byPos = words.reduce((acc, w) => {
  ;(acc[w.pos] ??= []).push(w)
  return acc
}, {})

const byKey = new Map(words.map((w) => [w.key, w]))

/** Look up a single word by its natural key. */
export function getByKey(key) {
  return byKey.get(key)
}

/** All parts of speech present, in a stable order. */
export const partsOfSpeech = ['noun', 'pronoun', 'verb', 'adjective', 'adverb', 'preposition']
