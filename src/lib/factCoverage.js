// Where word facts are missing, and where writing one would pay off most
// (#584, #590).
//
// Facts are optional by design, so this is a *worklist*, never a CI gate: a
// threshold would turn an enrichment into an obligation on every new word. What
// it does is stop the authoring being guesswork, because the payoff is nowhere
// near even across the corpus.
//
// The highest-yield case is a prefixed word whose bare stem is itself a
// curriculum entry — переводи́ть over води́ть, входи́ть over ходи́ть. The fact
// almost writes itself, its `see:` link lands on a word the learner already
// has, and the prefix it teaches is productive: one root family can carry a
// dozen words. Ranking by that reach beats ranking by word length, which just
// returns every long word in the dictionary.
//
// Pure and framework-free; `scripts/coverage-facts.mjs` is the thin CLI over it.
import { stripStress } from './text.js'

/** Productive prefixes, longest first so «пере-» wins over «пе-». */
export const PRODUCTIVE_PREFIXES = [
  'пере', 'пред', 'подо', 'разо', 'обо', 'ото', 'вос', 'воз', 'рас', 'раз',
  'при', 'про', 'под', 'пре', 'без', 'бес', 'изо', 'вы', 'за', 'из', 'ис',
  'на', 'над', 'об', 'от', 'по', 'со', 'до', 'в', 'с', 'у', 'о',
]

/** Productive derivational suffixes worth a `root` fact. */
export const PRODUCTIVE_SUFFIXES = ['тель', 'ость', 'ство', 'ение', 'ание', 'ник', 'ский']

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

/** Bare, case-folded headword — the identity words are matched on. */
function bare(word) {
  return stripStress(word?.headword || word?.ru || '').toLowerCase()
}

/** Drop a reflexive ending so находи́ться can still find ходи́ть. */
function unreflex(form) {
  return form.replace(/(ся|сь)$/, '')
}

/**
 * Words whose breakdown is worth authoring, richest root family first.
 *
 * A candidate is a word that starts with a productive prefix and whose
 * remaining stem *is itself an entry* — so the `see:` link points at a real
 * word, and the morphemes can be checked rather than guessed. Each carries the
 * size of its root family, because that is what makes the fact worth writing:
 * a fact on ход- is repaid across входи́ть, выходи́ть, доходи́ть and a dozen more.
 *
 * @param {object[]} words normalised word records (from buildWords)
 * @returns {Array<{key, ru, cefr, prefix, root: {key, ru}, family: number}>}
 */
export function breakdownCandidates(words) {
  const learnable = (words ?? []).filter((w) => w.learnable !== false)
  const byBare = new Map()
  for (const w of learnable) {
    const k = bare(w)
    if (k && !byBare.has(k)) byBare.set(k, w)
  }

  const found = []
  for (const w of learnable) {
    if (w.facts?.some((f) => f.kind === 'build' || f.kind === 'root')) continue
    const form = bare(w)
    for (const prefix of PRODUCTIVE_PREFIXES) {
      if (!form.startsWith(prefix)) continue
      const rest = form.slice(prefix.length)
      if (rest.length < 3) continue
      const root = byBare.get(rest) ?? byBare.get(unreflex(rest))
      if (!root || root === w) continue
      found.push({
        key: w.key,
        ru: w.headword || w.ru,
        cefr: w.cefr ?? null,
        prefix,
        root: { key: root.key, ru: root.headword || root.ru },
      })
      break // longest matching prefix wins
    }
  }

  // Family size is the payoff: how many candidates share this root.
  const perRoot = new Map()
  for (const c of found) perRoot.set(c.root.key, (perRoot.get(c.root.key) ?? 0) + 1)
  return found
    .map((c) => ({ ...c, family: perRoot.get(c.root.key) }))
    .sort(
      (a, b) =>
        b.family - a.family ||
        a.root.key.localeCompare(b.root.key, 'ru') ||
        cefrRank(a.cefr) - cefrRank(b.cefr) ||
        a.ru.localeCompare(b.ru, 'ru'),
    )
}

function cefrRank(level) {
  const i = CEFR_ORDER.indexOf(level)
  return i === -1 ? CEFR_ORDER.length : i
}

/**
 * Words carrying a productive derivational suffix and no root fact yet, with
 * the entry their stem seems to come from when one can be found. Fuzzier than
 * the prefix pass — this is a shortlist for a human, not a claim.
 * @returns {Array<{key, ru, cefr, suffix, from: ?{key, ru}}>}
 */
export function derivationCandidates(words) {
  const learnable = (words ?? []).filter((w) => w.learnable !== false)
  const out = []
  for (const w of learnable) {
    if (w.facts?.some((f) => f.kind === 'root' || f.kind === 'build')) continue
    const form = bare(w)
    const suffix = PRODUCTIVE_SUFFIXES.find((s) => form.endsWith(s) && form.length - s.length >= 3)
    if (!suffix) continue
    const stem = form.slice(0, -suffix.length)
    const from = learnable.find((o) => o !== w && bare(o).startsWith(stem) && bare(o).length >= 4)
    out.push({
      key: w.key,
      ru: w.headword || w.ru,
      cefr: w.cefr ?? null,
      suffix,
      from: from ? { key: from.key, ru: from.headword || from.ru } : null,
    })
  }
  return out.sort((a, b) => cefrRank(a.cefr) - cefrRank(b.cefr) || a.ru.localeCompare(b.ru, 'ru'))
}

const VOWELS = new Set('аеёиоуыэюя')

/**
 * Cost of substituting one letter for another. A vowel for a vowel is cheap on
 * purpose: unstressed Russian vowels reduce (о and а, е and и converge), so a
 * pair differing only in vowels can be near-homophones however many letters
 * separate them on paper. звони́ть and звене́ть are two substitutions apart, and
 * are exactly the kind of pair this shortlist exists to surface — while a pair
 * differing in a *consonant* is simply a different word.
 */
function substitutionCost(x, y) {
  if (x === y) return 0
  return VOWELS.has(x) && VOWELS.has(y) ? 0.5 : 1
}

/** Weighted edit distance, bailing out once it exceeds `cap`. */
function distance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + substitutionCost(a[i - 1], b[j - 1]),
      )
      if (row[j] < best) best = row[j]
    }
    if (best > cap) return cap + 1
    prev = row
  }
  return prev[b.length]
}

/** Is this pair already linked without anyone authoring anything? */
function alreadyLinked(a, b) {
  const bb = bare(b)
  return (
    a.aspectPair?.key === b.key ||
    a.motionPair?.key === b.key ||
    b.aspectPair?.key === a.key ||
    b.motionPair?.key === a.key ||
    a.participleOf?.key === b.key ||
    b.participleOf?.key === a.key ||
    (a.heteronyms ?? []).some((h) => stripStress(h.ru).toLowerCase() === bb) ||
    (a.ambiguousEn ?? []).some((x) => stripStress(x.ru).toLowerCase() === bb) ||
    (a.confusables ?? []).some((c) => c.key === b.key)
  )
}

/**
 * Sound-alike shortlist for `confusable_with:` — pairs close enough in spelling
 * to be mistaken for each other, and not already linked by aspect, motion,
 * heteronymy or a shared gloss (those are derived, and authoring them is a CI
 * failure — see wordFacts.factIssues).
 *
 * The distance is **normalised by length**, because a raw edit distance of 1 is
 * meaningless on short words: it makes «а» a near-neighbour of every other
 * function word in the dictionary. A minimum length does the rest.
 *
 * @param {object[]} words
 * @param {object} [opts]
 * @param {number} [opts.maxRatio] distance ÷ longer length (default 0.25)
 * @param {number} [opts.minLength] shortest word worth comparing (default 4)
 * @param {number} [opts.maxCefrGap] levels apart before a pair stops being a
 *   realistic confusion — you mix up words you are learning together (default 1)
 * @returns {Array<{a, b, distance, ratio}>} closest first
 */
export function confusableCandidates(
  words,
  { maxRatio = 0.25, minLength = 4, maxCefrGap = 1 } = {},
) {
  const learnable = (words ?? [])
    .filter((w) => w.learnable !== false && bare(w).length >= minLength)
    .map((w) => ({ w, form: bare(w) }))
    .sort((x, y) => x.form.length - y.form.length)

  const out = []
  for (let i = 0; i < learnable.length; i++) {
    const { w: a, form: fa } = learnable[i]
    const cap = Math.max(1, fa.length * maxRatio)
    for (let j = i + 1; j < learnable.length; j++) {
      const { w: b, form: fb } = learnable[j]
      // Sorted by length: once the gap exceeds the cap nothing further can match.
      if (fb.length - fa.length > cap) break
      if (Math.abs(cefrRank(a.cefr) - cefrRank(b.cefr)) > maxCefrGap) continue
      if (alreadyLinked(a, b) || alreadyLinked(b, a)) continue
      const d = distance(fa, fb, cap)
      const ratio = d / Math.max(fa.length, fb.length)
      if (d === 0 || d > cap || ratio > maxRatio) continue
      out.push({
        a: { key: a.key, ru: a.headword || a.ru, en: a.meaning, cefr: a.cefr },
        b: { key: b.key, ru: b.headword || b.ru, en: b.meaning, cefr: b.cefr },
        distance: d,
        ratio: Number(ratio.toFixed(3)),
      })
    }
  }
  return out.sort((x, y) => x.ratio - y.ratio || x.a.ru.localeCompare(y.a.ru, 'ru'))
}

/**
 * How much of the corpus carries authored facts, split by part of speech and by
 * CEFR level, so the gaps are visible.
 * @returns {{total: {words, withFacts, facts, confusables}, byPos: object[], byCefr: object[]}}
 */
export function factCoverage(words) {
  const learnable = (words ?? []).filter((w) => w.learnable !== false)
  const tally = () => ({ words: 0, withFacts: 0, facts: 0, confusables: 0 })
  const total = tally()
  const byPos = new Map()
  const byCefr = new Map()

  for (const w of learnable) {
    const facts = w.facts?.length ?? 0
    const confusables = w.confusables?.length ?? 0
    for (const bucket of [
      total,
      byPos.get(w.pos) ?? byPos.set(w.pos, tally()).get(w.pos),
      byCefr.get(w.cefr) ?? byCefr.set(w.cefr, tally()).get(w.cefr),
    ]) {
      bucket.words++
      if (facts) bucket.withFacts++
      bucket.facts += facts
      bucket.confusables += confusables
    }
  }

  const rows = (map, label, sort) =>
    [...map.entries()].map(([k, v]) => ({ [label]: k, ...v })).sort(sort)
  return {
    total,
    byPos: rows(byPos, 'pos', (a, b) => b.words - a.words),
    byCefr: rows(byCefr, 'cefr', (a, b) => cefrRank(a.cefr) - cefrRank(b.cefr)),
  }
}
