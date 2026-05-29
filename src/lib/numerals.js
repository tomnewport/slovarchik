// Russian numeral generator.
//
// Strategy: stress is *not* derived from rules — it is stored once on a small,
// finite lexicon of pre-stressed "atoms" (units, teens, tens, hundreds and the
// ordinal bases). Everything else is composition. This keeps the hard part
// (correct stress) a matter of a checked table rather than fragile heuristics.
//
// Scope today:
//   - cardinalNominative(n)         — counting numbers in the nominative
//   - ordinal(n, opts)              — ordinals in every case / gender / number
//   - yearOrdinal / yearIn          — "(в) … году́" for any year up to 2100+
//   - pluralCategory / agree        — pick the noun form a count governs
// Full oblique-case *cardinals* (where every component declines, e.g. the
// instrumental of 2945) are intentionally left for a later pass; the practical
// drills below need nominative cardinals plus declined ordinals.

// ── Cardinal atoms (nominative) ──────────────────────────────────────────
// Index = the digit's value. 1 and 2 vary by gender (одна / две …).
const UNITS = ['ноль', 'оди́н', 'два', 'три', 'четы́ре', 'пять', 'шесть', 'семь', 'во́семь', 'де́вять']
const UNITS_F = { 1: 'одна́', 2: 'две' }
const UNITS_N = { 1: 'одно́' }
// 10–19.
const TEENS = [
  'де́сять',
  'оди́ннадцать',
  'двена́дцать',
  'трина́дцать',
  'четы́рнадцать',
  'пятна́дцать',
  'шестна́дцать',
  'семна́дцать',
  'восемна́дцать',
  'девятна́дцать',
]
// Index = tens digit (2 → 20 … 9 → 90).
const TENS = [
  '',
  '',
  'два́дцать',
  'три́дцать',
  'со́рок',
  'пятьдеся́т',
  'шестьдеся́т',
  'се́мьдесят',
  'во́семьдесят',
  'девяно́сто',
]
// Index = hundreds digit (1 → 100 … 9 → 900).
const HUNDREDS = [
  '',
  'сто',
  'две́сти',
  'три́ста',
  'четы́реста',
  'пятьсо́т',
  'шестьсо́т',
  'семьсо́т',
  'восемьсо́т',
  'девятьсо́т',
]

/** The nominative of a single unit 0–9, respecting grammatical gender. */
function unit(value, gender) {
  if (gender === 'f' && UNITS_F[value]) return UNITS_F[value]
  if (gender === 'n' && UNITS_N[value]) return UNITS_N[value]
  return UNITS[value]
}

/** Nominative of a 1–999 group (returns '' for 0). */
function group3(n, gender) {
  const out = []
  const h = Math.floor(n / 100)
  const rem = n % 100
  if (h) out.push(HUNDREDS[h])
  if (rem >= 10 && rem < 20) {
    out.push(TEENS[rem - 10])
  } else {
    const t = Math.floor(rem / 10)
    const u = rem % 10
    if (t) out.push(TENS[t])
    if (u) out.push(unit(u, gender))
  }
  return out.join(' ')
}

/**
 * Which form a count governs: 1, 21, 31 … → "one"; 2–4, 22–24 … → "few";
 * everything else (incl. 11–14) → "many". (Russian's count agreement classes.)
 * @param {number} n
 * @returns {'one'|'few'|'many'}
 */
export function pluralCategory(n) {
  const abs = Math.abs(n)
  if (abs % 100 >= 11 && abs % 100 <= 14) return 'many'
  const last = abs % 10
  if (last === 1) return 'one'
  if (last >= 2 && last <= 4) return 'few'
  return 'many'
}

/**
 * Pick the noun form a count governs.
 * @param {number} n
 * @param {{one: string, few: string, many: string}} forms
 * @returns {string}
 */
export function agree(n, forms) {
  return forms[pluralCategory(n)]
}

/**
 * Spell a whole number in the nominative case.
 * @param {number} n            0 … 999_999
 * @param {'m'|'f'|'n'} [gender]  gender of the final unit (один/одна/одно, два/две)
 * @returns {string}  stress-marked Russian
 */
// ── Oblique-case cardinal atoms ──────────────────────────────────────────
// In an oblique case every component of a compound cardinal declines (e.g. the
// instrumental of 2945 is "двумя́ тысячами девятьюста́ми сорока́ пятью́"). These
// tables give the gen/dat/ins/pre of each atom; nominative & accusative reuse
// the nominative tables above (accusative ≈ nominative for inanimate counts).
const ONE_OBL = {
  m: { gen: 'одного́', dat: 'одному́', ins: 'одни́м', pre: 'одно́м' },
  f: { gen: 'одно́й', dat: 'одно́й', ins: 'одно́й', pre: 'одно́й' },
  n: { gen: 'одного́', dat: 'одному́', ins: 'одни́м', pre: 'одно́м' },
}
const UNIT_OBL = {
  2: { gen: 'двух', dat: 'двум', ins: 'двумя́', pre: 'двух' },
  3: { gen: 'трёх', dat: 'трём', ins: 'тремя́', pre: 'трёх' },
  4: { gen: 'четырёх', dat: 'четырём', ins: 'четырьмя́', pre: 'четырёх' },
  5: { gen: 'пяти́', dat: 'пяти́', ins: 'пятью́', pre: 'пяти́' },
  6: { gen: 'шести́', dat: 'шести́', ins: 'шестью́', pre: 'шести́' },
  7: { gen: 'семи́', dat: 'семи́', ins: 'семью́', pre: 'семи́' },
  8: { gen: 'восьми́', dat: 'восьми́', ins: 'восемью́', pre: 'восьми́' },
  9: { gen: 'девяти́', dat: 'девяти́', ins: 'девятью́', pre: 'девяти́' },
}
// Teens: десять is end-stressed; 11–19 keep stem stress (-надцати / -надцатью).
const TEEN_OBL = { 10: { gen: 'десяти́', dat: 'десяти́', ins: 'десятью́', pre: 'десяти́' } }
for (let i = 1; i <= 9; i++) {
  const stem = TEENS[i].slice(0, -1) // drop the soft sign
  TEEN_OBL[10 + i] = { gen: `${stem}и`, dat: `${stem}и`, ins: `${stem}ью`, pre: `${stem}и` }
}
const TENS_OBL = {
  2: { gen: 'двадцати́', dat: 'двадцати́', ins: 'двадцатью́', pre: 'двадцати́' },
  3: { gen: 'тридцати́', dat: 'тридцати́', ins: 'тридцатью́', pre: 'тридцати́' },
  4: { gen: 'сорока́', dat: 'сорока́', ins: 'сорока́', pre: 'сорока́' },
  5: { gen: 'пяти́десяти', dat: 'пяти́десяти', ins: 'пятью́десятью', pre: 'пяти́десяти' },
  6: { gen: 'шести́десяти', dat: 'шести́десяти', ins: 'шестью́десятью', pre: 'шести́десяти' },
  7: { gen: 'семи́десяти', dat: 'семи́десяти', ins: 'семью́десятью', pre: 'семи́десяти' },
  8: { gen: 'восьми́десяти', dat: 'восьми́десяти', ins: 'восемью́десятью', pre: 'восьми́десяти' },
  9: { gen: 'девяно́ста', dat: 'девяно́ста', ins: 'девяно́ста', pre: 'девяно́ста' },
}
const HUND_OBL = {
  1: { gen: 'ста', dat: 'ста', ins: 'ста', pre: 'ста' },
  2: { gen: 'двухсо́т', dat: 'двумста́м', ins: 'двумяста́ми', pre: 'двухста́х' },
  3: { gen: 'трёхсо́т', dat: 'трёмста́м', ins: 'тремяста́ми', pre: 'трёхста́х' },
  4: { gen: 'четырёхсо́т', dat: 'четырёмста́м', ins: 'четырьмяста́ми', pre: 'четырёхста́х' },
  5: { gen: 'пятисо́т', dat: 'пятиста́м', ins: 'пятьюста́ми', pre: 'пятиста́х' },
  6: { gen: 'шестисо́т', dat: 'шестиста́м', ins: 'шестьюста́ми', pre: 'шестиста́х' },
  7: { gen: 'семисо́т', dat: 'семиста́м', ins: 'семьюста́ми', pre: 'семиста́х' },
  8: { gen: 'восьмисо́т', dat: 'восьмиста́м', ins: 'восемьюста́ми', pre: 'восьмиста́х' },
  9: { gen: 'девятисо́т', dat: 'девятиста́м', ins: 'девятьюста́ми', pre: 'девятиста́х' },
}
const NOLL_OBL = { gen: 'ноля́', dat: 'нолю́', ins: 'нолём', pre: 'ноле́' }

// Scale nouns. Their case form is governed by the count before them: the "one"
// class keeps the singular ("двадцати одной ты́сячи"), everything else takes the
// plural in oblique cases; the nominative uses the usual ты́сяча / ты́сячи / ты́сяч.
const THOUSAND = {
  sg: { nom: 'ты́сяча', gen: 'ты́сячи', dat: 'ты́сяче', acc: 'ты́сячу', ins: 'ты́сячей', pre: 'ты́сяче' },
  pl: { nom: 'ты́сячи', gen: 'ты́сяч', dat: 'ты́сячам', acc: 'ты́сячи', ins: 'ты́сячами', pre: 'ты́сячах' },
}
const MILLION = {
  sg: { nom: 'миллио́н', gen: 'миллио́на', dat: 'миллио́ну', acc: 'миллио́н', ins: 'миллио́ном', pre: 'миллио́не' },
  pl: { nom: 'миллио́ны', gen: 'миллио́нов', dat: 'миллио́нам', acc: 'миллио́ны', ins: 'миллио́нами', pre: 'миллио́нах' },
}

const isOblique = (kase) => kase === 'gen' || kase === 'dat' || kase === 'ins' || kase === 'pre'

/** Oblique form of a single unit 1–9 (gendered for один). */
function unitOblique(u, kase, gender) {
  if (u === 1) return ONE_OBL[gender][kase]
  return UNIT_OBL[u][kase]
}

/** Oblique form of a 1–999 group. */
function group3Oblique(n, kase, gender) {
  const out = []
  const h = Math.floor(n / 100)
  const rem = n % 100
  if (h) out.push(HUND_OBL[h][kase])
  if (rem >= 10 && rem < 20) {
    out.push(TEEN_OBL[rem][kase])
  } else {
    const t = Math.floor(rem / 10)
    const u = rem % 10
    if (t) out.push(TENS_OBL[t][kase])
    if (u) out.push(unitOblique(u, kase, gender))
  }
  return out.join(' ')
}

/** The form a scale noun (ты́сяча / миллио́н) takes after a group of size `gv`. */
function scaleForm(scale, gv, kase) {
  const cat = pluralCategory(gv)
  if (kase === 'nom' || kase === 'acc') {
    // Count government: 1 → ты́сяча, 2–4 → ты́сячи, 5+ → ты́сяч.
    if (cat === 'one') return scale.sg.nom
    return cat === 'few' ? scale.sg.gen : scale.pl.gen
  }
  return (cat === 'one' ? scale.sg : scale.pl)[kase]
}

// Scales, widest first: [divisor, scale noun, gender the multiplier agrees with].
const SCALES = [
  [1000000, MILLION, 'm'],
  [1000, THOUSAND, 'f'],
  [1, null, null],
]

/**
 * Spell a whole number in any case. Nominative and (inanimate) accusative reuse
 * the nominative atoms; the four oblique cases decline every component.
 * @param {number} n            0 … 999_999_999
 * @param {{case?: string, gender?: 'm'|'f'|'n'}} [opts]
 * @returns {string}
 */
export function cardinal(n, { case: kase = 'nom', gender = 'm' } = {}) {
  if (n === 0) return isOblique(kase) ? NOLL_OBL[kase] : UNITS[0]
  const oblique = isOblique(kase)
  const parts = []
  for (const [div, scale, scaleGender] of SCALES) {
    const gv = Math.floor(n / div) % 1000
    if (!gv) continue
    const g = scale ? scaleGender : gender
    // Drop the bare multiplier "один" directly before a scale noun (тысяча, not
    // одна тысяча) — but keep it inside a larger group (двадцать одна тысяча).
    if (!(scale && gv === 1)) {
      parts.push(oblique ? group3Oblique(gv, kase, g) : group3(gv, g))
    }
    if (scale) parts.push(scaleForm(scale, gv, kase))
  }
  return parts.join(' ')
}

/**
 * Spell a whole number in the nominative case.
 * @param {number} n            0 … 999_999_999
 * @param {'m'|'f'|'n'} [gender]  gender of the final unit (один/одна/одно, два/две)
 * @returns {string}  stress-marked Russian
 */
export function cardinalNominative(n, gender = 'm') {
  return cardinal(n, { case: 'nom', gender })
}

// ── Ordinal atoms ────────────────────────────────────────────────────────
// Each "place" maps to a stem + declension kind:
//   hard — adjective like но́вый, stress sits on the (pre-stressed) stem
//   oj   — end-stressed adjective like второ́й (the ending carries the stress)
//   tretij — the irregular soft adjective тре́тий
const ORDINAL_BASES = {
  1: { stem: 'пе́рв', kind: 'hard' },
  2: { stem: 'втор', kind: 'oj' },
  3: { kind: 'tretij' },
  4: { stem: 'четвёрт', kind: 'hard' },
  5: { stem: 'пя́т', kind: 'hard' },
  6: { stem: 'шест', kind: 'oj' },
  7: { stem: 'седьм', kind: 'oj' },
  8: { stem: 'восьм', kind: 'oj' },
  9: { stem: 'девя́т', kind: 'hard' },
  10: { stem: 'деся́т', kind: 'hard' },
  11: { stem: 'оди́ннадцат', kind: 'hard' },
  12: { stem: 'двена́дцат', kind: 'hard' },
  13: { stem: 'трина́дцат', kind: 'hard' },
  14: { stem: 'четы́рнадцат', kind: 'hard' },
  15: { stem: 'пятна́дцат', kind: 'hard' },
  16: { stem: 'шестна́дцат', kind: 'hard' },
  17: { stem: 'семна́дцат', kind: 'hard' },
  18: { stem: 'восемна́дцат', kind: 'hard' },
  19: { stem: 'девятна́дцат', kind: 'hard' },
  20: { stem: 'двадца́т', kind: 'hard' },
  30: { stem: 'тридца́т', kind: 'hard' },
  40: { stem: 'сороков', kind: 'oj' },
  50: { stem: 'пятидеся́т', kind: 'hard' },
  60: { stem: 'шестидеся́т', kind: 'hard' },
  70: { stem: 'семидеся́т', kind: 'hard' },
  80: { stem: 'восьмидеся́т', kind: 'hard' },
  90: { stem: 'девяно́ст', kind: 'hard' },
  100: { stem: 'со́т', kind: 'hard' },
  200: { stem: 'двухсо́т', kind: 'hard' },
  300: { stem: 'трёхсо́т', kind: 'hard' },
  400: { stem: 'четырёхсо́т', kind: 'hard' },
  500: { stem: 'пятисо́т', kind: 'hard' },
  600: { stem: 'шестисо́т', kind: 'hard' },
  700: { stem: 'семисо́т', kind: 'hard' },
  800: { stem: 'восьмисо́т', kind: 'hard' },
  900: { stem: 'девятисо́т', kind: 'hard' },
  1000: { stem: 'ты́сячн', kind: 'hard' },
  2000: { stem: 'двухты́сячн', kind: 'hard' },
  3000: { stem: 'трёхты́сячн', kind: 'hard' },
}

// Adjective endings. Hard endings are unstressed (the stem holds the stress);
// `oj` endings carry their own stress for end-stressed ordinals.
function hardEnding(gender, number, kase, animate) {
  if (number === 'pl') {
    return { nom: 'ые', gen: 'ых', dat: 'ым', acc: animate ? 'ых' : 'ые', ins: 'ыми', pre: 'ых' }[
      kase
    ]
  }
  if (gender === 'f') {
    return { nom: 'ая', gen: 'ой', dat: 'ой', acc: 'ую', ins: 'ой', pre: 'ой' }[kase]
  }
  if (gender === 'n') {
    return { nom: 'ое', gen: 'ого', dat: 'ому', acc: 'ое', ins: 'ым', pre: 'ом' }[kase]
  }
  return { nom: 'ый', gen: 'ого', dat: 'ому', acc: animate ? 'ого' : 'ый', ins: 'ым', pre: 'ом' }[
    kase
  ]
}

function ojEnding(gender, number, kase, animate) {
  if (number === 'pl') {
    return { nom: 'ы́е', gen: 'ы́х', dat: 'ы́м', acc: animate ? 'ы́х' : 'ы́е', ins: 'ы́ми', pre: 'ы́х' }[
      kase
    ]
  }
  if (gender === 'f') {
    return { nom: 'а́я', gen: 'о́й', dat: 'о́й', acc: 'у́ю', ins: 'о́й', pre: 'о́й' }[kase]
  }
  if (gender === 'n') {
    return { nom: 'о́е', gen: 'о́го', dat: 'о́му', acc: 'о́е', ins: 'ы́м', pre: 'о́м' }[kase]
  }
  return { nom: 'о́й', gen: 'о́го', dat: 'о́му', acc: animate ? 'о́го' : 'о́й', ins: 'ы́м', pre: 'о́м' }[
    kase
  ]
}

// The irregular ordinal тре́тий, declined in full.
const TRETIJ = {
  sg: {
    m: { nom: 'тре́тий', gen: 'тре́тьего', dat: 'тре́тьему', acc: 'тре́тий', accAnim: 'тре́тьего', ins: 'тре́тьим', pre: 'тре́тьем' },
    f: { nom: 'тре́тья', gen: 'тре́тьей', dat: 'тре́тьей', acc: 'тре́тью', ins: 'тре́тьей', pre: 'тре́тьей' },
    n: { nom: 'тре́тье', gen: 'тре́тьего', dat: 'тре́тьему', acc: 'тре́тье', ins: 'тре́тьим', pre: 'тре́тьем' },
  },
  pl: { nom: 'тре́тьи', gen: 'тре́тьих', dat: 'тре́тьим', acc: 'тре́тьи', accAnim: 'тре́тьих', ins: 'тре́тьими', pre: 'тре́тьих' },
}

function declineBase(base, { case: kase = 'nom', gender = 'm', number = 'sg', animate = false } = {}) {
  if (base.kind === 'tretij') {
    const cell = number === 'pl' ? TRETIJ.pl : TRETIJ.sg[gender]
    if (kase === 'acc' && animate && cell.accAnim) return cell.accAnim
    return cell[kase]
  }
  const ending =
    base.kind === 'oj'
      ? ojEnding(gender, number, kase, animate)
      : hardEnding(gender, number, kase, animate)
  return base.stem + ending
}

/** Split a number into its trailing ordinal "place" and the cardinal prefix. */
function decomposeOrdinal(n) {
  const last2 = n % 100
  if (last2 >= 10 && last2 <= 19) return { place: last2, prefix: n - last2 }
  const u = n % 10
  if (u !== 0) return { place: u, prefix: n - u }
  if (last2 !== 0) return { place: last2, prefix: n - last2 } // 20, 30 … 90
  const h = n % 1000
  if (h !== 0) return { place: h, prefix: n - h } // 100 … 900
  return { place: n, prefix: 0 } // 1000, 2000 …
}

/**
 * Spell an ordinal number. Only the final element inflects (everything before
 * it stays a cardinal nominative), which is exactly how Russian forms compound
 * ordinals — and what years rely on.
 * @param {number} n
 * @param {{case?: string, gender?: 'm'|'f'|'n', number?: 'sg'|'pl', animate?: boolean}} [opts]
 * @returns {string}
 */
export function ordinal(n, opts = {}) {
  const { place, prefix } = decomposeOrdinal(n)
  const base = ORDINAL_BASES[place]
  if (!base) throw new RangeError(`ordinal: unsupported number ${n}`)
  const word = declineBase(base, opts)
  const lead = prefix > 0 ? cardinalNominative(prefix) : ''
  return lead ? `${lead} ${word}` : word
}

/**
 * The ordinal used to say a year, e.g. yearOrdinal(1945) → "ты́сяча девятьсо́т
 * со́рок пя́том" (prepositional by default — the "(в) … году́" form).
 * @param {number} n
 * @param {string} [kase]
 * @returns {string}
 */
export function yearOrdinal(n, kase = 'pre') {
  return ordinal(n, { case: kase, gender: 'm', number: 'sg' })
}

/** "(в) … году́": the full spoken form for "in <year>". */
export function yearIn(n) {
  return `в ${yearOrdinal(n, 'pre')} году́`
}

/** Just the year phrase "… году́" (no preposition), handy for prompts/answers. */
export function yearPhrase(n) {
  return `${yearOrdinal(n, 'pre')} году́`
}

/** The whole year read as a plain cardinal, e.g. "ты́сяча девятьсо́т со́рок пять". */
export function yearCardinal(n) {
  return cardinalNominative(n)
}
