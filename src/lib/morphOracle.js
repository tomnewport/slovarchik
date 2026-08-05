// Morphology oracle (issue #446).
//
// Structural/shape tests prove a record has the right *fields* and that an
// annotated phrase token agrees with its own stored cell — but if both the
// table and the drill read the *same* bad source value, CI stays green. Nothing
// there independently establishes that a hand-authored stored cell is valid
// Russian. This module is that independent check: a small, curated linguistic
// oracle that flags paradigm cells which cannot be correct.
//
// It deliberately does NOT trust a third-party analyser as infallible. It is
// three cheap, high-signal, framework-free checks plus a hand-maintained table
// of golden/defective forms (see morphGolden.js):
//
//   1. impossibleOrthography — Cyrillic sequences that simply cannot occur in a
//      native paradigm ending: `й` followed by a hard vowel (`йа/йо/йу/йы/йэ`)
//      where the softened `я/ё/ю/и/е` is required (`случай → *слу́чайа` instead
//      of `слу́чая`). Guarded so a stem that already carries the sequence in the
//      base form — `район`, `фойе` — is never flagged; only sequences a cell
//      *introduces* over its lemma count.
//
//   2. personCellDuplicates — two distinct person cells in a verb's present or
//      future block that are spelled identically. In standard Russian all six
//      person endings differ, so a duplicate is a copy-paste of the wrong
//      person (`осветить 3sg==3pl`, `рассмеяться 2sg==2pl`). Genuinely
//      impersonal verbs (хотеться) are the one legitimate exception and are
//      allowlisted by key.
//
//   3. goldenMismatches / defectiveCellsPresent — cross-check specific stored
//      cells against a curated table of correct forms (irregular, mobile-stress,
//      special `-ий` locatives) and a list of cells that must NOT exist because
//      the paradigm is defective (`убедиться` has no 1sg future). Accepted
//      variants (`махаю/машу`) are expressed as a list of allowed forms, so
//      legitimate variation never fails.
//
// Comparison is stress-insensitive but ё-sensitive: stress placement is the
// stress checker's job (stressAudit.js), while a wrong letter — including a
// missing ё — is this oracle's job.
import { stripStress } from './text.js'

/** Bare comparison key: stress stripped, lower-cased, ё preserved. */
function bare(value) {
  return stripStress(String(value ?? '')).toLowerCase()
}

// `й` + a hard vowel. After `й` a native ending always softens the vowel
// (я/ё/ю/и/е), so these bigrams only ever appear inside a stem, never as a
// generated ending. `е` is intentionally excluded here (`фейерверк`, `конвейер`
// are real) — the base-form guard below removes stem hits for the rest anyway.
const IMPOSSIBLE_BIGRAM = /й[аоуыэ]/g

/** The lemma spellings a paradigm cell is built on (headword + bare key). */
function baseForms(word) {
  const out = []
  if (word.headword) out.push(bare(word.headword))
  if (word.ru) out.push(bare(word.ru))
  return out
}

/** Flat (slot → form) entries for a word's declension, or `[]`. */
function declensionCells(word) {
  const d = word.extra?.declension
  if (!d || typeof d !== 'object') return []
  return Object.entries(d).filter(([, v]) => typeof v === 'string')
}

/** Dotted (block.person → form) entries for a verb's conjugation, or `[]`. */
function conjugationCells(word) {
  const c = word.extra?.conjugation
  if (!c || typeof c !== 'object') return []
  const out = []
  for (const [block, val] of Object.entries(c)) {
    if (typeof val === 'string') out.push([block, val])
    else if (val && typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) {
        if (typeof v === 'string') out.push([`${block}.${k}`, v])
      }
    }
  }
  return out
}

/**
 * Read a cell by golden slot key. A dotted key is a nested conjugation block
 * (`future.1sg`). A flat key is either a top-level conjugation cell — the past
 * agreement forms live directly under `conjugation` as `past_m`/`past_f`/
 * `past_n`/`past_pl` — or a flat declension cell (`sg_pre`, `m_gen`). The two
 * flat key spaces don't overlap, so conjugation wins wherever it holds a string.
 */
export function readCell(word, slot) {
  if (slot.includes('.')) {
    const [block, person] = slot.split('.')
    return word.extra?.conjugation?.[block]?.[person] ?? null
  }
  const conj = word.extra?.conjugation?.[slot]
  if (typeof conj === 'string') return conj
  return word.extra?.declension?.[slot] ?? null
}

/**
 * Paradigm cells containing an impossible `й`+hard-vowel sequence that the cell
 * introduces over its lemma (so `район`/`фойе` stems are never flagged).
 * @param {object[]} words normalised word records (from buildWords)
 * @returns {{key: string, slot: string, form: string, sequences: string[]}[]}
 */
export function impossibleOrthography(words) {
  const out = []
  for (const word of words) {
    const bases = baseForms(word)
    for (const [slot, form] of [...declensionCells(word), ...conjugationCells(word)]) {
      const hits = bare(form).match(IMPOSSIBLE_BIGRAM)
      if (!hits) continue
      const introduced = hits.filter((bigram) => !bases.some((b) => b.includes(bigram)))
      if (introduced.length) {
        out.push({ key: word.key, slot, form, sequences: [...new Set(introduced)] })
      }
    }
  }
  return out
}

const PERSONS = ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl']

/**
 * Verb present/future blocks with two distinct persons spelled identically —
 * almost always a wrong-person copy-paste. Impersonal verbs whose key is in
 * `allow` (every cell holds the single impersonal form on purpose) are skipped.
 * @param {object[]} words
 * @param {{allow?: Set<string>|string[]}} [opts]
 * @returns {{key: string, block: string, persons: [string, string], form: string}[]}
 */
export function personCellDuplicates(words, { allow = new Set() } = {}) {
  const allowed = allow instanceof Set ? allow : new Set(allow)
  const out = []
  for (const word of words) {
    if (word.pos !== 'verb' || allowed.has(word.key)) continue
    const conj = word.extra?.conjugation
    if (!conj) continue
    for (const block of ['present', 'future']) {
      const set = conj[block]
      if (!set || typeof set !== 'object') continue
      const seen = new Map()
      for (const person of PERSONS) {
        const value = set[person]
        if (value == null) continue
        const key = bare(value)
        if (seen.has(key)) {
          out.push({ key: word.key, block, persons: [seen.get(key), person], form: value })
        } else {
          seen.set(key, person)
        }
      }
    }
  }
  return out
}

/**
 * Stored cells that disagree with the curated golden table. A golden value may
 * be a single accepted form or a list of accepted variants (`махаю`/`машу`);
 * the stored cell must match one of them (stress-insensitively, ё preserved).
 * A golden cell that isn't present in the data at all is reported as missing.
 * @param {object[]} words
 * @param {Record<string, Record<string, string|string[]>>} golden key → slot → accepted form(s)
 * @returns {{key: string, slot: string, expected: string[], actual: string|null}[]}
 */
export function goldenMismatches(words, golden) {
  const byKey = new Map(words.map((w) => [w.key, w]))
  const out = []
  for (const [key, cells] of Object.entries(golden ?? {})) {
    const word = byKey.get(key)
    if (!word) continue // a renamed/removed entry is a data-shape test's problem, not ours
    for (const [slot, accepted] of Object.entries(cells)) {
      const allowed = (Array.isArray(accepted) ? accepted : [accepted]).map(String)
      const actual = readCell(word, slot)
      const ok = actual != null && allowed.some((a) => bare(a) === bare(actual))
      if (!ok) out.push({ key, slot, expected: allowed, actual })
    }
  }
  return out
}

/**
 * Defective cells that exist but must not: a paradigm slot the language simply
 * doesn't fill (`убедиться` has no 1st-person-singular future). A non-empty
 * value in such a slot is a fabricated form.
 * @param {object[]} words
 * @param {Record<string, string[]>} defective key → list of forbidden slot keys
 * @returns {{key: string, slot: string, form: string}[]}
 */
export function defectiveCellsPresent(words, defective) {
  const byKey = new Map(words.map((w) => [w.key, w]))
  const out = []
  for (const [key, slots] of Object.entries(defective ?? {})) {
    const word = byKey.get(key)
    if (!word) continue
    for (const slot of slots) {
      const value = readCell(word, slot)
      if (value != null && String(value).trim() !== '') {
        out.push({ key, slot, form: value })
      }
    }
  }
  return out
}

/**
 * Run every oracle check and return one flat, human-readable list of findings.
 * Each finding is `{ check, key, slot, message }`. An empty list means the
 * corpus is clean by the oracle's lights.
 * @param {object[]} words
 * @param {object} oracle the curated config (see morphGolden.js `MORPH_ORACLE`)
 * @returns {{check: string, key: string, slot: string, message: string}[]}
 */
export function morphologyViolations(words, oracle = {}) {
  const { golden = {}, defective = {}, impersonalVerbs = [] } = oracle
  const out = []

  for (const h of impossibleOrthography(words)) {
    out.push({
      check: 'orthography',
      key: h.key,
      slot: h.slot,
      message: `impossible sequence ${h.sequences.map((s) => `«${s}»`).join(', ')} in «${h.form}»`,
    })
  }
  for (const d of personCellDuplicates(words, { allow: impersonalVerbs })) {
    out.push({
      check: 'person-duplicate',
      key: d.key,
      slot: `${d.block}.${d.persons.join('/')}`,
      message: `${d.block} ${d.persons[0]} and ${d.persons[1]} are both «${d.form}»`,
    })
  }
  for (const m of goldenMismatches(words, golden)) {
    out.push({
      check: 'golden',
      key: m.key,
      slot: m.slot,
      message: `expected ${m.expected.map((e) => `«${e}»`).join(' / ')}, found ${m.actual == null ? '(missing)' : `«${m.actual}»`}`,
    })
  }
  for (const d of defectiveCellsPresent(words, defective)) {
    out.push({
      check: 'defective',
      key: d.key,
      slot: d.slot,
      message: `defective slot filled with «${d.form}» (paradigm has no such form)`,
    })
  }
  return out
}
