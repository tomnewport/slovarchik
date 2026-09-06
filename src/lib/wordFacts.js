// Word facts and related words — everything the app can say *about* a word, as
// opposed to testing the learner on it (#584, #585).
//
// Two sources feed one view:
//  - **derived** relations, already sitting on the shaped record because
//    vocabBuild linked them: the aspect pair, the motion pair, the verb a
//    lexicalised participle came from, the adjective behind an adverb, stress
//    heteronyms, and the other words sharing the same base gloss;
//  - **authored** `facts:` / `confusable_with:` (see public/vocab/CONTRIBUTING.md),
//    which fill only what derivation cannot see — shared roots, etymology,
//    mnemonics, and sound-alikes that aren't grammatically linked.
//
// Deriving before authoring is what keeps the authoring burden proportional:
// the panels are useful on day one, before a single fact is written. This module
// is pure and framework-free — the panels, the intro card and the correction
// messages all call the same three functions so they can't drift apart.
import { FACT_KINDS } from './vocabBuild.js'
import { stripStress } from './text.js'

export { FACT_KINDS }

/** Display order for a word's facts — most concrete first. */
const KIND_ORDER = new Map(FACT_KINDS.map((k, i) => [k, i]))

/**
 * The relation kinds `relatedWords` can report, in display order. `aspect`,
 * `motion`, `participle`, `manner` (an adverb and the adjective behind it),
 * `numeral` (a number and what it is built on) and `same-meaning` are derived;
 * `root`, `region`, `see-also` (all three from a fact's `see:`) and
 * `confusable` are authored.
 *
 * A `see:` link means different things depending on the fact it hangs off. On a
 * `build` or `root` fact it is a shared root — води́ть behind переводи́ть. On a
 * `note` it is only "this word is part of the same picture": под links над and
 * пе́ред because they are one spatial system, not because they share a
 * morpheme. Calling both "same root" would put a false claim under half the
 * closed-class facts (#631), so they are separate relations.
 *
 * A `region` row carries `where` — the place its fact named — so a row can say
 * *which* place says it without the caller re-reading the prose.
 *
 * A `numeral` row also carries `via` (`ordinal` | `teen` | `tens` | `hundreds`)
 * and `role` (`base` | `derived`, describing the *other* word), because "the
 * ordinal of nine" and "nine, on ten" are different things to say.
 */
export const RELATIONS = [
  'aspect',
  'motion',
  'participle',
  'manner',
  'numeral',
  'heteronym',
  'same-meaning',
  'root',
  'region',
  'see-also',
  'confusable',
]

/**
 * Which relation a fact's `see:` links report, by the fact's kind. A `see:`
 * means something different under each: a shared morpheme under `build`/`root`,
 * the same thing said elsewhere under `region`, and a bare pointer otherwise
 * (#631).
 */
const SEE_RELATION = { build: 'root', root: 'root', region: 'region' }

/**
 * How a numeral row reads, keyed `via:role` — the row describes the *other*
 * word, so each relation needs saying from both ends. Kept here beside the
 * relation rather than in the panel, so the intro card and the correction
 * messages say it the same way (#584).
 */
export const NUMERAL_LABEL = {
  'ordinal:base': 'the number it counts',
  'ordinal:derived': 'its ordinal',
  'teen:base': 'the unit it is built on',
  'teen:derived': 'the same unit, on ten',
  'tens:base': 'the unit it is built on',
  'tens:derived': 'the same unit, ten times',
  'hundreds:base': 'the unit it is built on',
  'hundreds:derived': 'the same unit, a hundred times',
}

/** The word's own accented headword, whatever shape of record we were given. */
function selfRu(record) {
  return record?.headword || record?.ru || ''
}

/** The word's own short gloss (full record or `shapeVocab` projection). */
function selfEn(record) {
  if (record?.meaning) return record.meaning
  const en = record?.en
  return (Array.isArray(en) ? en[0] : en) || ''
}

/** The word's own distinguishing note — the `en_gb` parenthetical. */
function selfNote(record) {
  return String(record?.meaningNote ?? record?.note ?? '').trim()
}

// Headword → record indexes, cached per word-map so a panel re-render doesn't
// re-scan the dictionary. Heteronyms and `ambiguousEn` carry a headword but no
// natural key (they are computed from spelling/gloss collisions), so resolving
// one back to its entry is what lets a panel link to it.
const ruIndexCache = new WeakMap()

function ruIndex(byKey) {
  if (!byKey || typeof byKey.values !== 'function') return null
  let index = ruIndexCache.get(byKey)
  if (!index) {
    index = new Map()
    for (const w of byKey.values()) {
      const ru = selfRu(w)
      if (ru && !index.has(ru)) index.set(ru, w)
    }
    ruIndexCache.set(byKey, index)
  }
  return index
}

/**
 * A word's authored facts, ordered `build` → `root` → `origin` → `memory` →
 * `note` and stable within a kind (authoring order). Each fact keeps its
 * resolved `see` links, so a renderer needs nothing but this list.
 *
 * @param {object} record a word record (buildWords) or shaped vocab word
 * @returns {Array<{kind: string, text: string, parts: object[], see: object[]}>}
 */
export function wordFacts(record) {
  const facts = record?.facts ?? []
  return facts
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (KIND_ORDER.get(a.f.kind) ?? 99) - (KIND_ORDER.get(b.f.kind) ?? 99) || a.i - b.i)
    .map(({ f }) => f)
}

/**
 * The morpheme breakdown of a `build` fact, ready to render as chips — plus the
 * joined-up word the chips spell out, which is what a screen reader should hear
 * instead of a run of disconnected fragments.
 *
 * @param {object} fact a fact from {@link wordFacts}
 * @returns {{parts: Array<{ru: string, en: string}>, joined: string, label: string}}
 */
export function factParts(fact) {
  const parts = fact?.parts ?? []
  // Authored parts carry joining hyphens showing where the morpheme attaches
  // (`пере-`, `-и́ть`); the joined form is the word itself, so they come off.
  const joined = parts.map((p) => String(p.ru ?? '').replace(/^[-‧]+|[-‧]+$/g, '')).join('')
  const label = parts.length
    ? `${joined}: ${parts.map((p) => (p.en ? `${p.ru} — ${p.en}` : p.ru)).join('; ')}`
    : ''
  return { parts, joined, label }
}

/**
 * Every other word this one is related to, derived and authored merged into one
 * de-duplicated list in {@link RELATIONS} order. A word reachable by two
 * relations is reported once, under the first (an aspect pair sharing its gloss
 * is an `aspect` link, not a `same-meaning` one).
 *
 * @param {object} record a word record (buildWords) or shaped vocab word
 * @param {Map<string, object>} [byKey] key → record, used to resolve the
 *   relations that carry only a headword (heteronyms, same-meaning) back to a
 *   full entry. Optional: without it those entries simply have `key: null`.
 * @returns {Array<{key: ?string, ru: string, en: string, note: string, why: string, relation: string}>}
 */
export function relatedWords(record, byKey) {
  if (!record) return []
  const index = ruIndex(byKey)
  const mine = selfRu(record)
  const out = []
  const seen = new Set()

  const push = (relation, entry) => {
    const found = entry.key ? byKey?.get(entry.key) : index?.get(entry.ru)
    const key = entry.key ?? found?.key ?? null
    const ru = entry.ru || selfRu(found)
    if (!ru || ru === mine || key === record.key) return
    if (seen.has(ru) || (key && seen.has(key))) return
    seen.add(ru)
    if (key) seen.add(key)
    out.push({
      key,
      ru,
      en: entry.en || selfEn(found) || '',
      note: entry.note || found?.meaningNote || '',
      why: entry.why || '',
      relation,
      // Numeral rows carry how the two are related and which end this is.
      // Attached only where they mean something, so every other relation keeps
      // the shape its callers already read.
      ...(entry.via ? { via: entry.via, role: entry.role } : {}),
      // A region row carries the place, for the same reason.
      ...(entry.where ? { where: entry.where } : {}),
    })
  }

  const pair = (p) => ({ key: p.key ?? null, ru: p.ru, en: p.gloss ?? p.en ?? '' })

  if (record.aspectPair) push('aspect', pair(record.aspectPair))
  if (record.motionPair) push('motion', pair(record.motionPair))
  if (record.participleOf) push('participle', pair(record.participleOf))
  if (record.mannerPair) push('manner', pair(record.mannerPair))
  for (const k of record.numeralKin ?? [])
    push('numeral', { key: k.key, ru: k.ru, en: k.gloss ?? '', via: k.via, role: k.role })
  for (const h of record.heteronyms ?? []) push('heteronym', { ru: h.ru, en: h.gloss ?? '' })
  // Same-gloss siblings share this word's meaning by definition — the note is
  // the only thing that tells them apart, so it is what travels.
  for (const a of record.ambiguousEn ?? [])
    push('same-meaning', { ru: a.ru, en: selfEn(record), note: a.note ?? '' })
  for (const f of wordFacts(record)) {
    const relation = SEE_RELATION[f.kind] ?? 'see-also'
    for (const s of f.see ?? [])
      push(relation, relation === 'region' ? { ...s, where: f.where } : s)
  }
  for (const c of record.confusables ?? []) push('confusable', c)

  return out
}

/**
 * The best available explanation of how this word differs from a related one —
 * for a correction message ("that's the *other* one") or a panel row.
 *
 * A pair like звони́ть / звене́ть is the case that needs it: near-identical
 * spelling, and glosses ("to call" / "to ring") close enough that showing them
 * side by side barely separates the two. The explanation is usually already in
 * the corpus, so this looks for it in order:
 *  1. an authored `why` on the `confusable_with:` link — prose written for
 *     exactly this pair;
 *  2. the two words' distinguishing notes, the `en_gb.standard` parentheticals
 *     that #527 already requires to tell same-gloss words apart — rendered as a
 *     contrast, "звони́ть — to phone someone; звене́ть — of a bell". This is what
 *     makes derived relations explainable at all: a link the build derives has
 *     nowhere to put a `why`, but both ends still carry their notes;
 *  3. nothing — the caller falls back to the glosses (and, for an aspect pair,
 *     to saying the aspect in words).
 *
 * @param {object} record the word in hand (full record or shaped vocab word)
 * @param {object} related one entry from {@link relatedWords}
 * @returns {{text: string, source: 'why' | 'contrast' | 'note' | ''}}
 */
export function confusionNote(record, related) {
  const why = String(related?.why ?? '').trim()
  if (why) return { text: why, source: 'why' }
  const sides = [
    { ru: selfRu(record), note: selfNote(record) },
    { ru: related?.ru ?? '', note: String(related?.note ?? '').trim() },
  ].filter((side) => side.ru && side.note)
  if (!sides.length) return { text: '', source: '' }
  return {
    text: sides.map((side) => `${side.ru} — ${side.note}`).join('; '),
    source: sides.length === 2 ? 'contrast' : 'note',
  }
}

/**
 * Is `key` a word this one names as its own regional variant — the same thing
 * said somewhere else (поре́брик beside бордю́р), or the same word used
 * differently there (бу́лка beside хлеб)?
 *
 * The corpus teaches the dictionary standard, so a variant is never an accepted
 * answer; what this buys is the difference between "wrong" and "that is the
 * Petersburg word" (#588, #636). Returns the place, so the message can name it.
 *
 * @param {object} record the word being asked for
 * @param {string} key natural key of the word the learner actually wrote
 * @returns {string} the place, or '' when the two aren't linked that way
 */
export function regionalVariant(record, key) {
  if (!key) return ''
  for (const f of wordFacts(record)) {
    if (f.kind !== 'region') continue
    if ((f.see ?? []).some((s) => s.key === key)) return f.where || ''
  }
  return ''
}

/**
 * Has this word anything to show — an authored fact, or a relation worth naming?
 * The panel renders nothing when it hasn't, and a caller that has to decide
 * something *around* the panel (whether to hold an auto-advance so it can be
 * read, say) needs the same answer without rendering it first.
 *
 * @param {object} record a word record (buildWords) or shaped vocab word
 * @param {Map<string, object>} [byKey]
 * @returns {boolean}
 */
export function hasWordFacts(record, byKey) {
  return wordFacts(record).length > 0 || relatedWords(record, byKey).length > 0
}

/** Strip stress and joining hyphens so a morpheme can be matched in a headword. */
function bareMorpheme(value) {
  return stripStress(String(value ?? ''))
    .replace(/[-‧]/g, '')
    .toLowerCase()
}

/** Is `needle` reachable in `haystack` reading left to right, in order? */
function isSubsequence(parts, word) {
  let at = 0
  for (const p of parts) {
    if (!p) continue
    const i = word.indexOf(p, at)
    if (i === -1) return false
    at = i + p.length
  }
  return true
}

/**
 * Can a learner tell these two words apart from what the corpus already says?
 * A distinguishing note on either side does it (that is what a note is for);
 * failing that, the two short glosses have to actually differ — one gloss
 * containing the other ("to call" / "to call back") separates nothing.
 */
function distinguishable(a, b) {
  if (!b) return true // a dangling key is reported on its own
  if (selfNote(a) || selfNote(b)) return true
  const one = String(a.meaning || a.en || '')
    .trim()
    .toLowerCase()
  const two = String(b.meaning || b.en || '')
    .trim()
    .toLowerCase()
  if (!one || !two) return true
  return !one.includes(two) && !two.includes(one)
}

/** The keys of every word this one is already linked to by derivation. */
function derivedLinks(word, words) {
  const keys = new Set()
  if (word.aspectPair?.key) keys.add(word.aspectPair.key)
  if (word.motionPair?.key) keys.add(word.motionPair.key)
  if (word.participleOf?.key) keys.add(word.participleOf.key)
  // Both ends carry mannerPair, so пло́хо / плохо́й is caught from either side —
  // the pair the shortlist used to offer as a trap to keep apart.
  if (word.mannerPair?.key) keys.add(word.mannerPair.key)
  for (const k of word.numeralKin ?? []) keys.add(k.key)
  const spellings = new Set([
    ...(word.heteronyms ?? []).map((h) => h.ru),
    ...(word.ambiguousEn ?? []).map((a) => a.ru),
  ])
  for (const other of words) {
    if (other === word) continue
    if (spellings.has(other.headword || other.ru)) keys.add(other.key)
    // A verb doesn't know which adjectives were lexicalised from it, so the
    // back-link is checked from the other end too.
    if (other.participleOf?.key === word.key) keys.add(other.key)
  }
  return keys
}

/**
 * Corpus guard for the authored `facts:` / `confusable_with:` fields: every
 * problem an author can create that the build silently tolerates. Returns one
 * entry per problem, so a test can assert the list is empty and a script can
 * print it.
 *
 * Shape problems are read from the raw authored word (`extra`) rather than the
 * normalised record, because normalisation drops a malformed fact — which is the
 * right runtime behaviour and exactly the wrong thing for CI to be blind to.
 *
 * @param {object[]} words normalised word records (from buildWords)
 * @returns {Array<{key: string, field: string, message: string}>}
 */
export function factIssues(words) {
  const list = words ?? []
  const byKey = new Map(list.map((w) => [w.key, w]))
  const issues = []
  const report = (key, field, message) => issues.push({ key, field, message })

  for (const word of list) {
    const raw = word.extra ?? {}

    // ── facts: shape ────────────────────────────────────────────────────────
    if (raw.facts != null && !Array.isArray(raw.facts)) {
      report(word.key, 'facts', 'facts must be a list')
    }
    for (const [i, f] of (Array.isArray(raw.facts) ? raw.facts : []).entries()) {
      const at = `facts[${i}]`
      const kind = String(f?.kind ?? '').trim()
      if (!FACT_KINDS.includes(kind)) {
        report(word.key, at, `kind "${kind}" is not one of ${FACT_KINDS.join(', ')}`)
      }
      if (!String(f?.text ?? '').trim()) report(word.key, at, 'text is required')
      if (f?.parts != null && kind !== 'build') {
        report(word.key, at, `parts is build-only, not "${kind}"`)
      }
      if (f?.where != null && kind !== 'region') {
        report(word.key, at, `where is region-only, not "${kind}"`)
      }
      // A regional claim that cannot name a place is a `note`. The place is
      // also what a correction message says out loud, so it is required rather
      // than nice to have.
      if (kind === 'region' && !String(f?.where ?? '').trim()) {
        report(word.key, at, 'a region fact needs a where (the place it is about)')
      }
      for (const [j, p] of (Array.isArray(f?.parts) ? f.parts : []).entries()) {
        if (!String(p?.ru ?? '').trim()) report(word.key, `${at}.parts[${j}]`, 'ru is required')
        if (!String(p?.en ?? '').trim()) report(word.key, `${at}.parts[${j}]`, 'en is required')
      }
    }

    // ── facts: the morpheme breakdown really spells this word ───────────────
    const headword = word.headword || word.ru
    const bareHeadword = bareMorpheme(headword)
    for (const [i, f] of word.facts.entries()) {
      if (!f.parts.length) continue
      // Consonant alternations are legitimate (писа́ть → пишу́), so the test is a
      // subsequence rather than an exact join: it catches a breakdown pasted
      // onto the wrong word without failing on real morphophonology.
      const parts = f.parts.map((p) => bareMorpheme(p.ru))
      if (!isSubsequence(parts, bareHeadword)) {
        report(
          word.key,
          `facts[${i}].parts`,
          `"${f.parts.map((p) => p.ru).join('')}" does not spell out ${headword}`,
        )
        continue
      }
      // When the morphemes do join back into the whole word, they should join
      // into the *stressed* word: `factParts` hands that joined form to a screen
      // reader, and an unstressed one has it saying a word nobody says. Only
      // checked for an exact join — an alternation legitimately can't reproduce
      // the headword either way.
      const joined = f.parts.map((p) => String(p.ru ?? '').replace(/[-‧]/g, '')).join('')
      if (joined !== headword && stripStress(joined) === stripStress(headword)) {
        report(
          word.key,
          `facts[${i}].parts`,
          `the parts spell "${joined}" — mark the stress on the part that carries it, so the joined-up form is "${headword}"`,
        )
      }
    }

    // ── facts: see links ────────────────────────────────────────────────────
    for (const [i, f] of word.facts.entries()) {
      const seen = new Set()
      for (const k of f.seeKeys) {
        const at = `facts[${i}].see`
        if (k === word.key) report(word.key, at, 'a word cannot see itself')
        else if (seen.has(k)) report(word.key, at, `"${k}" is listed twice`)
        else if (!byKey.has(k)) report(word.key, at, `"${k}" is not a word`)
        seen.add(k)
      }
    }

    // ── facts: a regional pairing is claimed from both ends ─────────────────
    // A one-sided link leaves the learner who meets the *other* word told
    // nothing: they tap бу́лка, and the entry that knows why it is interesting
    // is the one they aren't looking at. Both ends carry their own sentence
    // anyway — from хлеб and from бу́лка the difference reads differently — so
    // the guard costs the author nothing they weren't already writing.
    for (const [i, f] of word.facts.entries()) {
      if (f.kind !== 'region') continue
      for (const k of f.seeKeys) {
        const other = byKey.get(k)
        if (!other) continue // a dangling key is reported above
        const mirrored = other.facts.some(
          (g) => g.kind === 'region' && g.seeKeys.includes(word.key),
        )
        if (!mirrored) {
          report(word.key, `facts[${i}].see`, `"${k}" has no region fact linking back`)
        }
      }
    }

    // ── confusable_with ─────────────────────────────────────────────────────
    if (raw.confusable_with != null && !Array.isArray(raw.confusable_with)) {
      report(word.key, 'confusable_with', 'confusable_with must be a list')
    }
    const derived = derivedLinks(word, list)
    const seen = new Set()
    for (const c of Array.isArray(raw.confusable_with) ? raw.confusable_with : []) {
      const k = String(c?.key ?? '').trim()
      const at = 'confusable_with'
      if (!k) {
        report(word.key, at, 'each entry needs a key')
        continue
      }
      if (k === word.key) report(word.key, at, 'a word cannot be confusable with itself')
      else if (seen.has(k)) report(word.key, at, `"${k}" is listed twice`)
      else if (!byKey.has(k)) report(word.key, at, `"${k}" is not a word`)
      else if (derived.has(k)) {
        report(word.key, at, `"${k}" is already linked automatically — don't author it`)
      } else if (!String(c?.why ?? '').trim() && !distinguishable(word, byKey.get(k))) {
        // With no `why`, the correction message falls back to the two glosses
        // and notes. Where those are the same on both sides there is nothing
        // left to say, and a learner is told their answer was wrong by being
        // shown the meaning they were already thinking of.
        report(word.key, at, `nothing tells "${k}" apart from this word — write a why`)
      }
      seen.add(k)
    }

    // ── symmetry (a regression guard on linkFacts, not on the author) ───────
    for (const c of word.confusables) {
      const other = byKey.get(c.key)
      if (other && !other.confusables.some((b) => b.key === word.key)) {
        report(word.key, 'confusables', `"${c.key}" does not link back`)
      }
    }
  }
  return issues
}
