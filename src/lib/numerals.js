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
export function cardinalNominative(n, gender = 'm') {
  if (n === 0) return UNITS[0]
  const parts = []
  const thousands = Math.floor(n / 1000)
  const rest = n % 1000
  if (thousands === 1) {
    parts.push('ты́сяча')
  } else if (thousands > 1) {
    // тысяча is feminine, so its multiplier takes feminine один/два.
    parts.push(group3(thousands, 'f'))
    parts.push(agree(thousands, { one: 'ты́сяча', few: 'ты́сячи', many: 'ты́сяч' }))
  }
  if (rest) parts.push(group3(rest, gender))
  return parts.join(' ')
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
