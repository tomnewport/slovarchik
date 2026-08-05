// Stress proof-reading helpers (issue #457).
//
// Two data-quality checks that structural/shape tests miss because they only
// look at *which* letters a form has, not *where the stress sits*:
//
//   1. Latin accented-vowel / homoglyph contamination — an `á`, `é`, `ó`… (or
//      any Latin letter) pasted into a Cyrillic string. These render like a
//      stressed Russian vowel but are the wrong codepoint, so stress-aware
//      matching silently fails on them.
//
//   2. Wrong-syllable stress in usage phrases — the meaning-changing homograph
//      class (`сто́ит` "costs" vs `стои́т` "stands", `гóрода` gen-sg vs `городá`
//      nom-pl). We can't proof-read every phrase against an external dictionary
//      here, but every phrase token carrying an `inflect:` annotation names its
//      lemma *and* its exact paradigm slot, so the app already knows the one
//      correct stressed form for it: the word's own stored declension /
//      conjugation cell. Any annotated token whose stress disagrees with that
//      stored form is either a mis-stressed phrase or a mis-stressed paradigm —
//      both are bugs of exactly the kind #457 is about.
//
// Kept framework-free so both `scripts/check-stress.mjs` and the unit test can
// drive it.
import { shapeContextPhrases } from './vocabBuild.js'
import { ANALYTIC_FUTURE_FORMS, buildFromPhrase } from './phraseContext.js'
import { normalize } from './text.js'
import { normTokenStress } from './phraseHint.js'

// Basic Latin + Latin-1 Supplement + Latin Extended-A/B (covers á é í ó ú ý and
// the ASCII homoglyphs a/o/e/c/p…). Anything in these blocks is out of place in
// a Cyrillic word.
const LATIN = /[A-Za-zÀ-ɏ]/

/** Recursively gather every string leaf under a value, with a dotted path. */
function* strings(value, path) {
  if (typeof value === 'string') yield [path, value]
  else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* strings(value[i], `${path}[${i}]`)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) yield* strings(v, path ? `${path}.${k}` : k)
  }
}

/**
 * Every Russian-bearing string on a word: its headword, all inflected forms
 * (nouns/adjectives/pronouns/verbs) and every usage-example sentence.
 * @param {object} w a normalised word record (from buildWords)
 */
function* russianStrings(w) {
  if (w.headword) yield [`${w.key}:headword`, w.headword]
  yield* strings(w.forms, `${w.key}:forms`)
  yield* strings(w.short, `${w.key}:short`)
  if (w.extra) {
    yield* strings(w.extra.declension, `${w.key}:declension`)
    yield* strings(w.extra.conjugation, `${w.key}:conjugation`)
    yield* strings(w.extra.forms, `${w.key}:forms`)
  }
  for (const u of w.usage || []) if (u?.ru) yield [`${w.key}:usage.ru`, u.ru]
}

/**
 * Latin letters (including precomposed accented vowels) found inside Russian
 * text across the whole word list.
 * @param {object[]} words
 * @returns {{label: string, text: string}[]}
 */
export function latinInRussianText(words) {
  const hits = []
  for (const w of words) {
    for (const [label, text] of russianStrings(w)) {
      if (LATIN.test(text)) hits.push({ label, text })
    }
  }
  return hits
}

/**
 * The word's stored (accented) form for an annotated phrase slot, or null if
 * the slot doesn't resolve. Mirrors the resolution the in-context inflect drill
 * uses. (Kept in sync with the copy in phrasesData.test.js.)
 */
export function storedForm(word, t) {
  if (t.degree === 'short') {
    return word.pos === 'adjective' ? (word.short?.[t.gender] ?? null) : null
  }
  if (t.case) {
    const animAcc = t.animate && t.case === 'acc' && (t.gender === 'm' || t.gender === 'pl')
    if (word.pos === 'adjective') {
      const col = animAcc ? `${t.gender}_gen` : `${t.gender}_${t.case}`
      return word.extra?.declension?.[col] ?? null
    }
    if (word.pos === 'pronoun') {
      const ex = word.extra ?? {}
      if (t.gender) return ex.declension?.[animAcc ? `${t.gender}_gen` : `${t.gender}_${t.case}`] ?? null
      const bare = ex.forms?.[t.case] ?? null
      return t.prep && bare ? `н${bare}` : bare
    }
    return word.forms?.[t.number]?.[t.case] ?? null // noun
  }
  if (t.person) {
    const conj = word.extra?.conjugation
    if (!conj) return null
    if (t.person.startsWith('past')) return conj[t.person] ?? null
    if (t.person === 'imp_sg') return conj.imperative?.sg ?? null
    if (t.person === 'imp_pl') return conj.imperative?.pl ?? null
    if (t.tense === 'future' && word.aspect === 'impf') return ANALYTIC_FUTURE_FORMS[t.person] ?? null
    return conj[t.tense]?.[t.person] ?? null
  }
  return null
}

/**
 * Read a word's stored form for a stress-golden slot key. Understands
 * `headword`, dotted conjugation slots (`present.3sg`), bare conjugation slots
 * (`past_m`), and flat declension slots (`sg_gen`), returning null when the slot
 * is absent.
 */
function readStressCell(word, slot) {
  if (slot === 'headword') return word.headword ?? null
  if (slot.includes('.')) {
    const [block, person] = slot.split('.')
    return word.extra?.conjugation?.[block]?.[person] ?? null
  }
  const conj = word.extra?.conjugation
  if (conj && typeof conj[slot] === 'string') return conj[slot]
  return word.extra?.declension?.[slot] ?? null
}

/**
 * Stored forms whose *stress placement* disagrees with a curated golden table
 * (stressGolden.js `STRESS_GOLDEN`). Unlike annotatedStressDivergences — which
 * can only fire when a phrase token contradicts its own paradigm cell — this is
 * an independent reference: it catches a headword or a whole paradigm that has
 * uniformly drifted onto the wrong syllable (the выгля́деть-for-вы́глядеть class,
 * or a homograph flipped into its twin, замо́к↔за́мок / сто́ит↔стои́т). Comparison
 * is stress-sensitive (via normTokenStress) but folds case and ё, so only the
 * accent position is judged here; the letters are morphOracle's job.
 *
 * @param {object[]} words   normalised word list (from buildWords)
 * @param {Record<string, Record<string, string>>} golden key → slot → correct stressed form
 * @returns {{key: string, slot: string, expected: string, actual: string|null}[]}
 */
export function stressGoldenMismatches(words, golden) {
  const byKey = new Map(words.map((w) => [w.key, w]))
  const out = []
  for (const [key, cells] of Object.entries(golden ?? {})) {
    const word = byKey.get(key)
    if (!word) continue // a renamed/removed entry is a data-shape test's problem, not ours
    for (const [slot, expected] of Object.entries(cells)) {
      const actual = readStressCell(word, slot)
      const ok = actual != null && normTokenStress(actual) === normTokenStress(expected)
      if (!ok) out.push({ key, slot, expected, actual })
    }
  }
  return out
}

/**
 * Annotated usage tokens whose stress disagrees with the word's own stored
 * paradigm form for the annotated slot. Only tokens whose *core* (stress
 * stripped) already matches the stored form are considered, so a genuine
 * wrong-slot annotation surfaces in phrasesData.test.js as before and only the
 * stress-placement disagreement lands here.
 *
 * @param {object[]} words   normalised word list (from buildWords)
 * @param {object} rules     grammar-rules map (grammar-rules.yml `.rules`)
 * @returns {{id: string, key: string, token: string, stored: string, ru: string}[]}
 */
export function annotatedStressDivergences(words, rules) {
  const byKey = new Map(words.map((w) => [w.key, w]))
  const out = []
  for (const p of shapeContextPhrases(words)) {
    const w = byKey.get(p.target.key)
    if (!w || w.learnable === false) continue
    const ex = buildFromPhrase(p, w, { rules })
    if (!ex) continue
    const stored = storedForm(w, p.target)
    if (!stored) continue
    // Same core (case/number/person right) but different stress placement.
    if (normalize(ex.answerAccented) !== normalize(stored)) continue
    if (normTokenStress(ex.answerAccented) !== normTokenStress(stored)) {
      out.push({ id: p.id, key: p.target.key, token: ex.answerAccented, stored, ru: p.ru })
    }
  }
  return out
}
