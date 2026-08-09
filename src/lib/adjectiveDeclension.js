// Derive the full case × gender/number declension of an adjective-like word
// from its accented masculine nominative.
//
// Russian qualitative/relative adjectives decline regularly: given the
// dictionary form we can read off the stem, the stress class (stem-fixed vs
// ending-fixed) and the spelling class (hard / velar / sibilant / soft /
// possessive), and the 24 forms then follow by rule.
//
// This started life inside `scripts/gen-adjective-declension.mjs`, which splices
// a curated `declension:` block into adjectives.yml at authoring time. It moved
// here because participles need the same derivation *at runtime*: a participle
// agrees exactly like но́вый, so the corpus stores only its accented nominative
// (see docs/participles-and-gerunds.md, Decision 1) and the oblique grid is
// derived on demand — for the context drill's answer and for hinting «пла́чущего»
// back to пла́кать. The generator still owns the file I/O and its refusal guard;
// it imports the derivation from here so both sides can never disagree.

const ACUTE = '́' // combining acute accent
const VOWELS = 'аеёиоуыэюя'

const strip = (s) => String(s ?? '').normalize('NFC').replaceAll(ACUTE, '')
const countVowels = (s) => [...strip(s)].filter((c) => VOWELS.includes(c)).length

// Convention (matches the curated data): a monosyllable carries no stress mark,
// since the single vowel is unambiguously stressed — e.g. злой, not зло́й.
const conventionalStress = (form) => (countVowels(form) <= 1 ? strip(form) : form)

/** Cases in canonical order. */
export const ADJ_CASES = Object.freeze(['nom', 'gen', 'dat', 'acc', 'ins', 'pre'])
/** Agreement columns — gender in the singular, plus the shared plural. */
export const ADJ_COLS = Object.freeze(['m', 'n', 'f', 'pl'])

/** Mark the first vowel of an (unstressed) ending as stressed. */
function stress(ending) {
  for (const ch of ending) {
    if (VOWELS.includes(ch)) return ending.replace(ch, ch + ACUTE)
  }
  return ending
}

// Possessive adjectives in -ий (бо́жий, ли́сий, тре́тий) take a soft-sign (ь)
// stem in every form but the masc-nominative: бо́жий → бо́жье/бо́жья/бо́жьи. They
// are spelled like sibilant/soft adjectives (бо́жий looks like хоро́ший), so they
// can't be told apart from the m-nominative alone — the signal is the curated
// non-masc nominative ending in -ье / -ья / -ьи.
function isPossessive(forms) {
  if (!forms) return false
  const ends = (v, suf) => v != null && strip(v).endsWith(suf)
  return ends(forms.f, 'ья') || ends(forms.n, 'ье') || ends(forms.pl, 'ьи')
}

/** Spelling class from the stem's final consonant and the dictionary form. */
function classify(stemBare, mNomBare) {
  const last = stemBare.slice(-1)
  if ('жшчщ'.includes(last)) return 'sibilant'
  if ('кгх'.includes(last)) return 'velar'
  if (mNomBare.endsWith('ий')) return 'soft' // -ний etc. (closed class)
  return 'hard'
}

// Ending tables (letters only). `end` = true selects the ending-stressed
// variant where it differs (m_nom and, for sibilants, о vs е).
function endings(cls, end) {
  const hard = {
    m_nom: end ? 'ой' : 'ый', m_gen: 'ого', m_dat: 'ому', m_ins: 'ым', m_pre: 'ом',
    n_nom: 'ое', n_gen: 'ого', n_dat: 'ому', n_ins: 'ым', n_pre: 'ом',
    f_nom: 'ая', f_gen: 'ой', f_dat: 'ой', f_acc: 'ую', f_ins: 'ой', f_pre: 'ой',
    pl_nom: 'ые', pl_gen: 'ых', pl_dat: 'ым', pl_ins: 'ыми', pl_pre: 'ых',
  }
  const velar = {
    m_nom: end ? 'ой' : 'ий', m_gen: 'ого', m_dat: 'ому', m_ins: 'им', m_pre: 'ом',
    n_nom: 'ое', n_gen: 'ого', n_dat: 'ому', n_ins: 'им', n_pre: 'ом',
    f_nom: 'ая', f_gen: 'ой', f_dat: 'ой', f_acc: 'ую', f_ins: 'ой', f_pre: 'ой',
    pl_nom: 'ие', pl_gen: 'их', pl_dat: 'им', pl_ins: 'ими', pl_pre: 'их',
  }
  // Sibilants: ы→и always; о→е only when the ending is unstressed.
  const sibilant = end
    ? {
        m_nom: 'ой', m_gen: 'ого', m_dat: 'ому', m_ins: 'им', m_pre: 'ом',
        n_nom: 'ое', n_gen: 'ого', n_dat: 'ому', n_ins: 'им', n_pre: 'ом',
        f_nom: 'ая', f_gen: 'ой', f_dat: 'ой', f_acc: 'ую', f_ins: 'ой', f_pre: 'ой',
        pl_nom: 'ие', pl_gen: 'их', pl_dat: 'им', pl_ins: 'ими', pl_pre: 'их',
      }
    : {
        m_nom: 'ий', m_gen: 'его', m_dat: 'ему', m_ins: 'им', m_pre: 'ем',
        n_nom: 'ее', n_gen: 'его', n_dat: 'ему', n_ins: 'им', n_pre: 'ем',
        f_nom: 'ая', f_gen: 'ей', f_dat: 'ей', f_acc: 'ую', f_ins: 'ей', f_pre: 'ей',
        pl_nom: 'ие', pl_gen: 'их', pl_dat: 'им', pl_ins: 'ими', pl_pre: 'их',
      }
  const soft = {
    m_nom: 'ий', m_gen: 'его', m_dat: 'ему', m_ins: 'им', m_pre: 'ем',
    n_nom: 'ее', n_gen: 'его', n_dat: 'ему', n_ins: 'им', n_pre: 'ем',
    f_nom: 'яя', f_gen: 'ей', f_dat: 'ей', f_acc: 'юю', f_ins: 'ей', f_pre: 'ей',
    pl_nom: 'ие', pl_gen: 'их', pl_dat: 'им', pl_ins: 'ими', pl_pre: 'их',
  }
  // Possessive -ий: soft-sign stem in every form but the masc-nominative.
  const possessive = {
    m_nom: 'ий', m_gen: 'ьего', m_dat: 'ьему', m_ins: 'ьим', m_pre: 'ьем',
    n_nom: 'ье', n_gen: 'ьего', n_dat: 'ьему', n_ins: 'ьим', n_pre: 'ьем',
    f_nom: 'ья', f_gen: 'ьей', f_dat: 'ьей', f_acc: 'ью', f_ins: 'ьей', f_pre: 'ьей',
    pl_nom: 'ьи', pl_gen: 'ьих', pl_dat: 'ьим', pl_ins: 'ьими', pl_pre: 'ьих',
  }
  const table = { hard, velar, sibilant, soft, possessive }[cls]
  // Accusative (inanimate) mirrors the nominative for m / n / pl; the feminine
  // accusative is its own form. Animate masc/pl accusative equals the genitive.
  table.m_acc = table.m_nom
  table.n_acc = table.n_nom
  table.pl_acc = table.pl_nom
  return table
}

/**
 * Build the 24-form declension of an adjective-like word from its accented
 * masculine nominative. Keys are `<col>_<case>` (`m_gen`, `pl_ins`, …) — the
 * same flat shape adjectives.yml stores and `paradigm.adjLookup` reads.
 *
 * @param {string} mNomAccented the accented m-nominative (но́вый, прочи́танный)
 * @param {{m?: string, n?: string, f?: string, pl?: string}} [forms] the curated
 *   nominatives, passed so possessive -ий adjectives (indistinguishable from a
 *   sibilant by the m-nominative alone) can be recognised from their -ья/-ье/-ьи
 *   agreement forms. Participles are never possessive, so callers deriving a
 *   participle grid omit it.
 * @returns {Record<string, string>}
 */
export function declineAdjective(mNomAccented, forms) {
  const mNomBare = strip(mNomAccented)
  const endStressed = mNomBare.endsWith('ой')
  // Stem = dictionary form minus its 2-letter nominative ending. Stem-stressed
  // adjectives keep the stress mark in the stem; ending-stressed ones carry no
  // stem stress (the accent lives on the ending), so strip it.
  const stem = endStressed
    ? mNomBare.slice(0, -2)
    : String(mNomAccented).normalize('NFC').replace(/(ый|ий)$/, '')
  const cls = isPossessive(forms) ? 'possessive' : classify(strip(stem), mNomBare)
  const table = endings(cls, endStressed)

  const out = {}
  for (const col of ADJ_COLS) {
    for (const c of ADJ_CASES) {
      const e = table[`${col}_${c}`]
      out[`${col}_${c}`] = conventionalStress(stem + (endStressed ? stress(e) : e))
    }
  }
  return out
}

/**
 * Hand-verified reference paradigms, one per spelling/stress class. They are the
 * generator's first refusal guard and this module's test suite: a change to the
 * ending tables that breaks any of them is a change that would corrupt every
 * adjective in the corpus and every participle derived at runtime.
 */
export const GOLDEN_ADJECTIVES = Object.freeze({
  'но́вый': { m_nom: 'но́вый', m_gen: 'но́вого', m_dat: 'но́вому', m_acc: 'но́вый', m_ins: 'но́вым', m_pre: 'но́вом', n_nom: 'но́вое', n_acc: 'но́вое', f_nom: 'но́вая', f_gen: 'но́вой', f_acc: 'но́вую', pl_nom: 'но́вые', pl_gen: 'но́вых', pl_ins: 'но́выми' },
  'молодо́й': { m_nom: 'молодо́й', m_gen: 'молодо́го', m_ins: 'молоды́м', n_nom: 'молодо́е', f_nom: 'молода́я', f_gen: 'молодо́й', f_acc: 'молоду́ю', pl_nom: 'молоды́е', pl_gen: 'молоды́х', pl_ins: 'молоды́ми' },
  'ру́сский': { m_nom: 'ру́сский', m_gen: 'ру́сского', m_ins: 'ру́сским', n_nom: 'ру́сское', f_nom: 'ру́сская', f_gen: 'ру́сской', f_acc: 'ру́сскую', pl_nom: 'ру́сские', pl_gen: 'ру́сских', pl_ins: 'ру́сскими' },
  'хоро́ший': { m_nom: 'хоро́ший', m_gen: 'хоро́шего', m_dat: 'хоро́шему', m_ins: 'хоро́шим', m_pre: 'хоро́шем', n_nom: 'хоро́шее', f_nom: 'хоро́шая', f_gen: 'хоро́шей', f_acc: 'хоро́шую', pl_nom: 'хоро́шие', pl_gen: 'хоро́ших', pl_ins: 'хоро́шими' },
  'большо́й': { m_nom: 'большо́й', m_gen: 'большо́го', m_ins: 'больши́м', n_nom: 'большо́е', f_nom: 'больша́я', f_gen: 'большо́й', f_acc: 'большу́ю', pl_nom: 'больши́е', pl_gen: 'больши́х', pl_ins: 'больши́ми' },
  'си́ний': { m_nom: 'си́ний', m_gen: 'си́него', m_dat: 'си́нему', m_ins: 'си́ним', m_pre: 'си́нем', n_nom: 'си́нее', f_nom: 'си́няя', f_gen: 'си́ней', f_acc: 'си́нюю', pl_nom: 'си́ние', pl_gen: 'си́них', pl_ins: 'си́ними' },
  // Possessive -ий (soft-sign stem in every form but the masc-nominative).
  'бо́жий': { m_nom: 'бо́жий', m_gen: 'бо́жьего', m_dat: 'бо́жьему', m_acc: 'бо́жий', m_ins: 'бо́жьим', m_pre: 'бо́жьем', n_nom: 'бо́жье', n_acc: 'бо́жье', f_nom: 'бо́жья', f_gen: 'бо́жьей', f_acc: 'бо́жью', pl_nom: 'бо́жьи', pl_gen: 'бо́жьих', pl_ins: 'бо́жьими' },
})

/**
 * Golden paradigms that disagree with the derivation, as
 * `{ lemma, slot, expected, actual }`. Empty means the ending tables are intact.
 * Shared by the generator's refusal guard and this module's test.
 * @param {Record<string, Record<string, string>>} [golden]
 */
export function goldenAdjectiveMismatches(golden = GOLDEN_ADJECTIVES) {
  const out = []
  for (const [lemma, expected] of Object.entries(golden)) {
    // Pass the curated nominatives so the possessive class (indistinguishable
    // from a sibilant by the m-nominative alone) is detected.
    const forms = { m: expected.m_nom, f: expected.f_nom, n: expected.n_nom, pl: expected.pl_nom }
    const got = declineAdjective(lemma, forms)
    for (const [slot, want] of Object.entries(expected)) {
      if (got[slot] !== want) out.push({ lemma, slot, expected: want, actual: got[slot] })
    }
  }
  return out
}
