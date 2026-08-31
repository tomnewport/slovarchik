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
// The suffix pass works the same way in spirit: it names a source only when the
// derivation reconstructs, because a wrong `see:` link teaches a relationship
// that does not exist, which is worse than no link at all (#614).
//
// The sound-alike pass is a list to be worked *down*, so rejections are as
// durable as authored links: `review/confusables-reviewed.jsonl` records them
// with a reason and this module subtracts them (#613).
//
// Pure and framework-free; `scripts/coverage-facts.mjs` is the thin CLI over it,
// and reads the ledger — nothing here touches the filesystem.
import { stripStress } from './text.js'
import { relatedWords } from './wordFacts.js'

/** Productive prefixes, longest first so «пере-» wins over «пе-». */
export const PRODUCTIVE_PREFIXES = [
  'пере', 'пред', 'подо', 'разо', 'обо', 'ото', 'вос', 'воз', 'рас', 'раз',
  'при', 'про', 'под', 'пре', 'без', 'бес', 'изо', 'вы', 'за', 'из', 'ис',
  'на', 'над', 'об', 'от', 'по', 'со', 'до', 'в', 'с', 'у', 'о',
]

/** Productive derivational suffixes worth a `root` fact. */
export const PRODUCTIVE_SUFFIXES = ['тель', 'ость', 'ство', 'ение', 'ание', 'ник', 'ский']

/**
 * What each suffix is put on. A suffix does not attach to just anything: -ание
 * and -тель build on verbs, -ость on adjectives, -ский and -ник on nouns and
 * adjectives. Checking it is most of what separates зада́ние ← зада́ть from
 * зада́ние ← зад, which reconstruct equally well on the letters alone.
 */
const SUFFIX_SOURCE_POS = {
  тель: ['verb'],
  ание: ['verb'],
  ение: ['verb'],
  ость: ['adjective'],
  ство: ['noun', 'adjective'],
  ник: ['noun', 'adjective', 'numeral'],
  ский: ['noun', 'adjective', 'numeral'],
}

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

/** Bare, case-folded headword — the identity words are matched on. */
function bare(word) {
  return stripStress(word?.headword || word?.ru || '').toLowerCase()
}

/**
 * A CEFR filter for the worklists (#627), so a level can be worked through on
 * its own rather than read out of a corpus-wide ranking.
 *
 * Filtering happens on the *output*, never the input: the ranking that makes
 * these lists worth reading is computed over the whole corpus — a root family
 * counts its members wherever they sit, and a sound-alike is a sound-alike
 * whatever level its partner is — so narrowing the input would quietly change
 * the numbers rather than the view of them.
 *
 * An absent or empty list means every level, so a caller can pass the option
 * through unconditionally.
 * @param {string[]} [levels]
 * @returns {?(cefr: ?string) => boolean}
 */
function levelFilter(levels) {
  if (!levels?.length) return null
  const want = new Set(levels.map((l) => String(l).toUpperCase()))
  return (cefr) => want.has(String(cefr ?? '').toUpperCase())
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
 * @param {object} [opts]
 * @param {string[]} [opts.levels] keep only candidates at these CEFR levels.
 *   The *candidate's* level, not the root's: the fact is authored on the
 *   prefixed word, so that is the word the level is about. Family sizes stay
 *   corpus-wide — a root's reach does not shrink because you are reading one
 *   level of it.
 * @returns {Array<{key, ru, cefr, prefix, root: {key, ru}, family: number}>}
 */
export function breakdownCandidates(words, { levels } = {}) {
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

  // Family size is the payoff: how many candidates share this root. Counted
  // over everything found, before any level filter — see levelFilter.
  const perRoot = new Map()
  for (const c of found) perRoot.set(c.root.key, (perRoot.get(c.root.key) ?? 0) + 1)
  const keep = levelFilter(levels)
  return found
    .map((c) => ({ ...c, family: perRoot.get(c.root.key) }))
    .filter((c) => !keep || keep(c.cefr))
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
 * Endings stripped from a candidate source to reach the stem it derives from,
 * longest first. Every stripping that leaves a usable stem is indexed, not just
 * the longest: расти́ has to yield both «рас» and «раст», because расте́ние is
 * built on the second.
 */
const SOURCE_ENDINGS = [
  'ться', 'ся', 'ти', 'ть', 'чь', 'ый', 'ий', 'ой', 'ая', 'ое', 'ые',
  'ец', 'а', 'я', 'о', 'е', 'ь', 'й', 'ы', 'и',
]

/**
 * Consonant mutations Russian derivation runs through, as [plain, mutated].
 * друг → дру́жеский, рука́ → ручно́й: the stem the suffix lands on is not always
 * the stem the source shows you.
 */
const MUTATIONS = [
  ['ск', 'щ'], ['ст', 'щ'], ['к', 'ч'], ['г', 'ж'], ['х', 'ш'], ['ц', 'ч'],
  ['д', 'жд'], ['д', 'ж'], ['т', 'щ'], ['т', 'ч'], ['з', 'ж'], ['с', 'ш'],
  ['б', 'бл'], ['п', 'пл'], ['в', 'вл'], ['м', 'мл'],
]

const VOWELS = new Set('аеёиоуыэюя')

const MIN_STEM = 3

/**
 * Every stem a source word could plausibly hand to a suffix — each ending
 * stripped, and each result again without its final vowel, because the theme
 * vowel goes too: зада́ть gives «зада» and then «зад», which is what зада́ние is
 * built on.
 */
function sourceStems(form) {
  const stems = []
  const add = (stem) => {
    if (stem.length >= MIN_STEM && !stems.includes(stem)) stems.push(stem)
  }
  add(form)
  for (const end of SOURCE_ENDINGS) {
    if (!form.endsWith(end)) continue
    const stem = form.slice(0, -end.length)
    add(stem)
    if (VOWELS.has(stem[stem.length - 1])) add(stem.slice(0, -1))
  }
  return stems
}

/** stem → the words that could have handed it over. */
function stemIndex(words) {
  const index = new Map()
  for (const w of words) {
    for (const stem of sourceStems(bare(w))) {
      const at = index.get(stem)
      if (at) at.push(w)
      else index.set(stem, [w])
    }
  }
  return index
}

/**
 * Sources that reconstruct `stem`, each with how it got there. A mutation is
 * reported as such so a reviewer can see which claims lean on one.
 */
function sourcesFor(stem, index) {
  const found = []
  for (const w of index.get(stem) ?? []) found.push({ word: w, via: 'exact' })
  for (const [plain, mutated] of MUTATIONS) {
    if (!stem.endsWith(mutated)) continue
    const unmutated = stem.slice(0, -mutated.length) + plain
    for (const w of index.get(unmutated) ?? []) found.push({ word: w, via: 'mutation' })
  }
  return found
}

/**
 * Words carrying a productive derivational suffix and no root fact yet, with
 * the entry they are built on **when that can be verified** (#614).
 *
 * Verified means reconstructible: some stripping of the source's own ending,
 * allowing a known consonant mutation, is exactly the stem the suffix sits on.
 * Anything less is reported as `from: null`. The column is one an author acts
 * on — a wrong `see:` link teaches a relationship that does not exist, which is
 * worse than no link at all — so it is quiet and right rather than full and
 * wrong. Same constraint that makes the prefix pass trustworthy: the source has
 * to be a real word standing in a real relation, not the nearest string.
 *
 * A source is also required to be *shorter* than the word it supposedly built.
 * Derivation adds material; внима́ние does not come from внима́тельно.
 *
 * @param {object[]} words
 * @param {object} [opts]
 * @param {string[]} [opts.levels] keep only candidates at these CEFR levels —
 *   the derived word's own level, for the same reason as the prefix pass.
 * @returns {Array<{key, ru, cefr, suffix, from: ?{key, ru, via}}>}
 */
export function derivationCandidates(words, { levels } = {}) {
  const learnable = (words ?? []).filter((w) => w.learnable !== false)
  const index = stemIndex(learnable)
  const out = []
  for (const w of learnable) {
    if (w.facts?.some((f) => f.kind === 'root' || f.kind === 'build')) continue
    const form = bare(w)
    const suffix = PRODUCTIVE_SUFFIXES.find((s) => form.endsWith(s) && form.length - s.length >= 3)
    if (!suffix) continue
    const stem = form.slice(0, -suffix.length)
    const from = bestSource(sourcesFor(stem, index), w, form, suffix)
    out.push({
      key: w.key,
      ru: w.headword || w.ru,
      cefr: w.cefr ?? null,
      suffix,
      from: from ? { key: from.word.key, ru: from.word.headword || from.word.ru, via: from.via } : null,
    })
  }
  const keep = levelFilter(levels)
  return out
    .filter((c) => !keep || keep(c.cefr))
    .sort((a, b) => cefrRank(a.cefr) - cefrRank(b.cefr) || a.ru.localeCompare(b.ru, 'ru'))
}

/**
 * The likeliest of several reconstructions: an exact stem over one that needed a
 * mutation, then the shortest source, on the reasoning that the least derived
 * word in a family is the one the learner should be sent to.
 */
function bestSource(found, self, form, suffix) {
  const wanted = SUFFIX_SOURCE_POS[suffix] ?? []
  let best = null
  for (const cand of found) {
    if (cand.word === self) continue
    if (!wanted.includes(cand.word.pos)) continue
    // Compare without the reflexive: дви́гаться is longer than движе́ние only
    // because of the -ся, and движе́ние is plainly built on it.
    const srcForm = bare(cand.word)
    if (unreflex(srcForm).length >= form.length) continue
    if (!best || better(cand, best, srcForm)) best = { ...cand, form: srcForm }
  }
  return best
}

function better(cand, best, srcForm) {
  if (cand.via !== best.via) return cand.via === 'exact'
  if (srcForm.length !== best.form.length) return srcForm.length < best.form.length
  const rank = cefrRank(cand.word.cefr) - cefrRank(best.word.cefr)
  if (rank !== 0) return rank < 0
  return cand.word.key.localeCompare(best.word.key, 'ru') < 0
}

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

// Two rows of the DP table, reused across calls. The scan runs this millions of
// times, and allocating a fresh row per character was costing more than the
// arithmetic in it.
let prevRow = new Float64Array(64)
let curRow = new Float64Array(64)

/** Weighted edit distance, bailing out once it exceeds `cap`. */
function distance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  if (prevRow.length < b.length + 1) {
    prevRow = new Float64Array(b.length + 1)
    curRow = new Float64Array(b.length + 1)
  }
  let prev = prevRow
  let cur = curRow
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let best = i
    const ai = a[i - 1]
    for (let j = 1; j <= b.length; j++) {
      const sub = prev[j - 1] + substitutionCost(ai, b[j - 1])
      const del = prev[j] + 1
      const ins = cur[j - 1] + 1
      const v = sub < del ? (sub < ins ? sub : ins) : del < ins ? del : ins
      cur[j] = v
      if (v < best) best = v
    }
    if (best > cap) return cap + 1
    const swap = prev
    prev = cur
    cur = swap
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
 * Canonical identity of an unordered pair, so a rejection recorded one way
 * round is honoured the other.
 */
function pairKey(a, b) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

/**
 * Ledger entries naming a word the corpus no longer has (#613). A rejection
 * outlives the review that made it, so a renamed or deleted key would otherwise
 * sit there quietly inflating the count of what has been dealt with.
 * @param {object[]} words
 * @param {Array<{a: string, b: string}>} reviewed
 * @returns {Array<{a, b, missing: string[]}>}
 */
export function staleReviewed(words, reviewed) {
  const keys = new Set((words ?? []).filter((w) => w.learnable !== false).map((w) => w.key))
  return (reviewed ?? [])
    .map((r) => ({ ...r, missing: [r.a, r.b].filter((k) => !keys.has(k)) }))
    .filter((r) => r.missing.length)
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
 * @param {Array<{a: string, b: string}>} [opts.reviewed] pairs already looked at
 *   and set aside (#613), so the list can be worked *down* rather than re-read
 *   from the top every session. Order-insensitive.
 * @param {string[]} [opts.levels] keep a pair when **either** word is at one of
 *   these levels. A pair straddling two levels is exactly the trap worth
 *   authoring — the learner meeting the A2 word still has the A1 one — so
 *   requiring both would hide the most useful half of the list.
 * @returns {Array<{a, b, distance, ratio}>} closest first
 */
export function confusableCandidates(
  words,
  { maxRatio = 0.25, minLength = 4, maxCefrGap = 1, reviewed = [], levels } = {},
) {
  const keep = levelFilter(levels)
  const setAside = new Set((reviewed ?? []).map((r) => pairKey(r.a, r.b)))
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
      if (keep && !keep(a.cefr) && !keep(b.cefr)) continue
      // Distance first, and only then the link check. The scan considers
      // millions of pairs and rejects almost all of them; `alreadyLinked`
      // normalises several arrays per call, so running it on every pair rather
      // than on the handful that survive costs seconds.
      const d = distance(fa, fb, cap)
      const ratio = d / Math.max(fa.length, fb.length)
      if (d === 0 || d > cap || ratio > maxRatio) continue
      if (alreadyLinked(a, b) || alreadyLinked(b, a)) continue
      if (setAside.has(pairKey(a.key, b.key))) continue
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
 * What the corpus has to say about itself, split by part of speech and by CEFR
 * level, so the gaps are visible.
 *
 * Three buckets, not one, because "words with authored facts" is not what a
 * learner experiences (#627). A word whose panel is filled by a *derived*
 * relation — its aspect partner, its motion partner, the verb behind a
 * participle — needs nothing authored and is not a gap. Counting only authored
 * facts put A1 top of the table at 15.9% while nearly half of it showed a
 * blank panel, which is how the whole level came to be overlooked.
 *
 *  - `withFacts` — carries `facts:`;
 *  - `derived`   — no facts, but `relatedWords` has something to show;
 *  - `empty`     — neither. The number to drive to zero.
 *
 * @param {object[]} words
 * @returns {{total: {words, withFacts, derived, empty, facts, confusables},
 *   byPos: object[], byCefr: object[]}}
 */
export function factCoverage(words) {
  const list = words ?? []
  // relatedWords resolves its links through a keyed map, and wants the whole
  // corpus in it: a gloss-only stub is not a learnable word but is a perfectly
  // good thing to link to.
  const byKey = new Map(list.filter((w) => w?.key).map((w) => [w.key, w]))
  const learnable = list.filter((w) => w.learnable !== false)
  const tally = () => ({ words: 0, withFacts: 0, derived: 0, empty: 0, facts: 0, confusables: 0 })
  const total = tally()
  const byPos = new Map()
  const byCefr = new Map()

  for (const w of learnable) {
    const facts = w.facts?.length ?? 0
    const confusables = w.confusables?.length ?? 0
    const derived = facts ? false : relatedWords(w, byKey).length > 0
    for (const bucket of [
      total,
      byPos.get(w.pos) ?? byPos.set(w.pos, tally()).get(w.pos),
      byCefr.get(w.cefr) ?? byCefr.set(w.cefr, tally()).get(w.cefr),
    ]) {
      bucket.words++
      if (facts) bucket.withFacts++
      else if (derived) bucket.derived++
      else bucket.empty++
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
