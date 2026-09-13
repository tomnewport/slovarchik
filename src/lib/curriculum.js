// Curriculum parts: the unit of progress a learner actually works through (#674).
//
// A CEFR level is too big to be a goal — B1 alone is over two thousand words,
// years of study behind one unmoving bar. A *part* is a chunk of about 500:
// "A2 Part I", "B1 Part III". They are this app's own invention and carry no
// external meaning; the CEFR level only names them.
//
// A part is a bundle of topic *collections* within one level, so it stays
// legible — "A2 Part I" is recognisably food, people and communication, not an
// arbitrary slice of the dictionary. Collections are already what `batches.js`
// anchors batch names on, so the two agree by construction.
//
// The packing itself is committed data (`public/vocab/parts.yml`), not computed
// here. Bin-packing is not stable under insertion: one new word can reshuffle
// several collections between parts, and a goal that rearranges itself every
// time the corpus grows is no goal at all. So a maintainer owns the packing, a
// script proposes changes to it, and this module only *reads* it.
//
// Pure and framework-free: no Vue, no I/O. The parts definition is passed in.

import { CEFR_ORDER, cefrRank } from './batches.js'

/** Target words per part; the size a part is "filled" at. */
export const PART_TARGET = 500
/** A part may not hold fewer than this — unless its whole level does. */
export const PART_MIN = 250
/** A part may not hold more than this. */
export const PART_MAX = 750
/** A collection split across parts may not leave a fragment smaller than this. */
export const MIN_FRAGMENT = 40

/** The pseudo-collection for words carrying none — pronouns, prepositions,
 *  conjunctions, interjections, numerals. They cannot anchor a part (there is
 *  no topic to bundle) but they are real vocabulary, so they are counted, and
 *  `batches.js` trickles them into every batch anyway via `GLUE_POS`. */
export const GLUE_COLLECTION = '(glue)'

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

/** The collection a word belongs to for curriculum purposes: its first listed
 *  one, or the glue pseudo-collection when it has none. First-listed rather
 *  than "best" so the answer is stable and authored, not inferred. */
export function collectionOf(word) {
  return word?.collections?.[0] ?? GLUE_COLLECTION
}

/** "A2 Part II" — the name a learner sees. */
export function partName(level, ordinal) {
  return `${level} Part ${ROMAN[ordinal - 1] ?? ordinal}`
}

/** `B1-3` — the stable id. Stable matters: achievement ids are persisted in
 *  `seenAchievements`, so a part's identity must outlive a repack. */
export function partId(level, ordinal) {
  return `${level}-${ordinal}`
}

/**
 * Words of one level grouped by collection, each list in a stable order.
 *
 * The order is by word key, which is what makes a *split* collection
 * well-defined: the part that takes 200 of `daily life` takes the first 200 of
 * this list, and the next part takes the rest. Sorting by key rather than by
 * corpus order means editing a YAML file cannot silently move a word between
 * parts.
 */
function byCollection(words, level) {
  const out = new Map()
  for (const w of words) {
    if (w.cefr !== level) continue
    const c = collectionOf(w)
    if (!out.has(c)) out.set(c, [])
    out.get(c).push(w)
  }
  for (const list of out.values()) list.sort((a, b) => String(a.key).localeCompare(String(b.key), 'ru'))
  return out
}

/**
 * Assign every learnable word to a part, following a committed parts definition.
 *
 * Each part names the collections it holds. A collection appearing in several
 * parts is consumed in part order: a part with a `take` count for it gets that
 * many, and the part that names it with no count gets whatever remains — which
 * is what lets the corpus grow into the last part holding a collection instead
 * of leaving new words homeless.
 *
 * @param {PlainObject[]} words learnable, normalised word records (`key`, `cefr`,
 *   `collections`)
 * @param {{parts: Array<{id: string, level: string, ordinal: number,
 *   collections: string[], take?: Record<string, number>}>}} definition
 *   the parsed `parts.yml`
 * @returns {{parts: Array<PlainObject>, keyToPart: Map<string, string>,
 *   unassigned: PlainObject[]}} parts in curriculum order, each with its `words`;
 *   `unassigned` holds any word no part claimed (a gate failure, not a crash)
 */
export function assignParts(words, definition) {
  const defs = [...(definition?.parts ?? [])].sort(
    (a, b) => cefrRank(a.level) - cefrRank(b.level) || (a.ordinal ?? 0) - (b.ordinal ?? 0),
  )
  // Per level, how much of each collection has been handed out so far. Nested
  // rather than keyed on a joined "level+collection" string: a composite key
  // needs a separator no collection name can contain, and there isn't an
  // obviously safe one.
  /** @type {Map<string, Map<string, number>>} */
  const consumed = new Map()
  const consumedAt = (level) => {
    if (!consumed.has(level)) consumed.set(level, new Map())
    return consumed.get(level)
  }
  const pools = new Map()
  const poolFor = (level) => {
    if (!pools.has(level)) pools.set(level, byCollection(words, level))
    return pools.get(level)
  }

  const keyToPart = new Map()
  const claimed = new Set()
  const parts = defs.map((def) => {
    const pool = poolFor(def.level)
    const picked = []
    for (const collection of def.collections ?? []) {
      const all = pool.get(collection) ?? []
      const seen = consumedAt(def.level)
      const from = seen.get(collection) ?? 0
      const take = def.take?.[collection]
      const slice = take == null ? all.slice(from) : all.slice(from, from + take)
      seen.set(collection, from + slice.length)
      picked.push(...slice)
    }
    for (const w of picked) {
      keyToPart.set(w.key, def.id)
      claimed.add(w.key)
    }
    return {
      id: def.id,
      level: def.level,
      ordinal: def.ordinal,
      name: partName(def.level, def.ordinal),
      collections: def.collections ?? [],
      words: picked,
      size: picked.length,
    }
  })

  return { parts, keyToPart, unassigned: words.filter((w) => !claimed.has(w.key)) }
}

/**
 * The lowest part not yet filled to {@link PART_TARGET} — where new vocabulary
 * should go. Null when every part is at or over target.
 *
 * This is an authoring signal, not a learner-facing one: it answers "which
 * words should the corpus gain next", and because part membership follows
 * collection it resolves to a concrete instruction — not "add A2 words" but
 * "add these many, in these collections".
 */
export function lowestUnfilledPart(parts) {
  return (parts ?? []).find((p) => p.size < PART_TARGET) ?? null
}

/**
 * Which bound, if any, a part breaches. The floor is waived for a part whose
 * whole CEFR level is smaller than it — C1 has 25 words in the corpus and
 * cannot reach 250 however it is cut.
 * @returns {'over'|'under'|null}
 */
export function partBreach(part, levelTotal) {
  if (part.size > PART_MAX) return 'over'
  if (part.size < PART_MIN && (levelTotal ?? part.size) >= PART_MIN) return 'under'
  return null
}

/**
 * Per-part progress counts, shaped like the CEFR stats they replace on the
 * Progress screen: total / met / learned / mastered, nesting by construction.
 * @param {Array<{id: string, words: PlainObject[]}>} parts
 * @param {(key: string) => string} stateOf
 * @param {(key: string) => boolean} [hasMet]
 * @returns {Record<string, {total: number, met: number, learned: number, mastered: number}>}
 */
export function buildPartStats(parts, stateOf, hasMet = () => false) {
  /** @type {Record<string, {total: number, met: number, learned: number, mastered: number}>} */
  const stats = {}
  for (const part of parts ?? []) {
    const s = { total: 0, met: 0, learned: 0, mastered: 0 }
    for (const w of part.words) {
      s.total++
      const state = stateOf(w.key)
      if (state !== 'unknown' || hasMet(w.key)) s.met++
      if (state === 'learned' || state === 'mastered') s.learned++
      if (state === 'mastered') s.mastered++
    }
    stats[part.id] = s
  }
  return stats
}

/** Every level that has at least one part, in curriculum order. */
export function levelsWithParts(parts) {
  const seen = new Set((parts ?? []).map((p) => p.level))
  return CEFR_ORDER.filter((l) => seen.has(l))
}
