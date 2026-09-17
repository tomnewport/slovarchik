// Word rows for the Progress screen. Keep search, status and sorting independent
// of Vue so the same rules apply to known words and dictionary search results.
import { rowGloss, disambiguatedGloss } from './homeDashboard.js'
import { lastAttemptAt } from './progression.js'
import { reviewState } from './reviewState.js'
import { parseKey } from './vocabBuild.js'

const MONTH_MS = 30 * 86400000
const STATUS_ORDER = { problem: 0, due: 1, new: 2, solid: 3 }
const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

/** One problem list, with slipped words first and no duplicate at-risk rows. */
export function problemKeys(lost, atRisk) {
  return [...new Set([...lost, ...atRisk])]
}

export function wordStatus(rec, state, isProblem, now) {
  if (isProblem) return { kind: 'problem', icon: '⚠️', label: 'Problem word' }
  if (reviewState(rec, { now, state }).dueCount > 0) {
    return { kind: 'due', icon: '⏰', label: 'Needs testing' }
  }
  if (rec?.learnedAt == null || now - rec.learnedAt < MONTH_MS) {
    return { kind: 'new', icon: '🌱', label: 'New word' }
  }
  return { kind: 'solid', icon: '💚', label: 'Solid' }
}

function wrongAttempts(rec) {
  if (rec?.agg?.dims && Object.keys(rec.agg.dims).length) {
    return Object.values(rec.agg.dims).reduce((sum, d) => sum + (d.attempts ?? 0) - (d.correct ?? 0), 0)
  }
  return (rec?.events ?? []).filter((e) => e.correct === false).length
}

/** Build a row from a full vocabulary entry, or a recorded key absent from it. */
export function progressWordRow(key, word, rec, state, isProblem, now) {
  const parsed = parseKey(key)
  const en = word?.meaning || word?.en || parsed.en
  const lastAt = Math.max(rec?.agg?.lastSeenAt ?? 0, lastAttemptAt(rec?.events ?? []) ?? 0)
  return {
    key,
    ru: word?.headword || word?.ru || parsed.ru,
    en: rowGloss(en, word),
    fullEn: disambiguatedGloss(en, word),
    cefr: word?.cefr ?? null,
    learnable: word?.learnable !== false,
    state,
    status: wordStatus(rec, state, isProblem, now),
    lastAt,
    incorrect: wrongAttempts(rec),
  }
}

const collatorEn = new Intl.Collator('en', { sensitivity: 'base' })
const collatorRu = new Intl.Collator('ru', { sensitivity: 'base' })

export function sortProgressWords(rows, order) {
  return [...rows].sort((a, b) => {
    let difference
    switch (order) {
      case 'recent': difference = b.lastAt - a.lastAt; break
      case 'oldest': difference = a.lastAt - b.lastAt; break
      case 'most-incorrect': difference = b.incorrect - a.incorrect; break
      case 'least-incorrect': difference = a.incorrect - b.incorrect; break
      case 'cefr': difference = (CEFR_ORDER.indexOf(a.cefr) + 1 || 99) - (CEFR_ORDER.indexOf(b.cefr) + 1 || 99); break
      case 'english': difference = collatorEn.compare(a.fullEn, b.fullEn); break
      case 'russian': difference = collatorRu.compare(a.ru, b.ru); break
      default: difference = STATUS_ORDER[a.status.kind] - STATUS_ORDER[b.status.kind]
    }
    return difference || collatorRu.compare(a.ru, b.ru) || collatorEn.compare(a.key, b.key)
  })
}

/** Search the installed dictionary, including gloss-only entries. Ignore stress marks. */
function normalized(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function searchProgressWords(words, query, limit = 100) {
  const terms = normalized(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (!terms.length) return []
  const matches = []
  for (const word of words) {
    const searchable = normalized([
      word.headword, word.ru, word.meaning, word.meaningFull, word.en,
      ...(word.english ?? []), ...(word.meaningsAlt ?? []), word.key,
    ].join(' '))
    if (terms.every((term) => searchable.includes(term))) matches.push(word.key)
    if (matches.length >= limit) break
  }
  return matches
}
