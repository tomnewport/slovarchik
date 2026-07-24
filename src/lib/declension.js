// Pure helpers for working with Russian noun declension tables.
//
// A noun's `forms` is keyed by number ('sg' / 'pl') then case. Some nouns are
// pluralia tantum (e.g. деньги, ворота) and only carry a 'pl' table, so helpers
// iterate over whichever numbers are actually present.

import { stripStress } from './text.js'

export const CASES = ['nom', 'gen', 'dat', 'acc', 'ins', 'pre']

// The second locative ("местный"/second prepositional). It is *not* one of the
// six core CASES: only a subset of nouns have a distinct one, it is singular
// only, and it is always spelled like another case (the dative for masculines,
// the genitive/dative/prepositional for feminine -ь nouns) — differing only in
// its end stress (в лесу́, not в ле́се). Keeping it out of CASES means grading,
// completeness checks and the context drill stay on the six-case system, while
// the declension table can still surface it as an extra optional row.
export const LOCATIVE = 'loc'

// The animate accusative for adjectives and adjective-like pronouns. Like the
// second locative it is *not* one of the six core CASES: it is a derived display
// slot, not a stored form. For masculine singular and the plural, an adjective
// agreeing with an animate noun takes its genitive form (ви́жу хоро́шего дру́га,
// зна́ю но́вых сосе́дей) — feminine (-ую) and neuter (= nominative) don't change.
// Nouns already store their animate accusative directly, so this pseudo-case is
// adjective/pronoun-only; keeping it out of CASES leaves grading and the
// six-case context drill untouched.
export const ACC_ANIMATE = 'acc_anim'

export const CASE_LABELS = {
  nom: 'Nominative',
  gen: 'Genitive',
  dat: 'Dative',
  acc: 'Accusative',
  ins: 'Instrumental',
  pre: 'Prepositional',
  loc: 'Locative',
  acc_anim: 'Accusative (animate)',
}

/** Short hint of the question each case answers, handy for learners. */
export const CASE_HINTS = {
  nom: 'who / what (subject)',
  gen: 'of whom / of what',
  dat: 'to whom / to what',
  acc: 'whom / what (object)',
  ins: 'with / by whom / what',
  pre: 'about whom / what',
  loc: 'in / at — after в / на',
  acc_anim: 'whom (animate object)',
}

/** Longer explanations, shown as a tooltip on the rare cases learners may not know. */
export const CASE_NOTES = {
  loc: 'Locative (a second prepositional): the special “in/at” form some nouns take after в or на — в лесу́ “in the forest”, not в ле́се. It is spelled like the dative but stressed on the ending.',
  acc_anim:
    'Accusative with an animate noun: a masculine or plural adjective takes its genitive form when the noun is a person or animal — ви́жу хоро́шего дру́га, зна́ю но́вых сосе́дей. Feminine (-ую) and neuter (= nominative) are unchanged.',
}

export const NUMBERS = ['sg', 'pl']

export const NUMBER_LABELS = {
  sg: 'Singular',
  pl: 'Plural',
}

/** Numbers actually present in a noun's table, in canonical order. */
export function numbersOf(noun) {
  return NUMBERS.filter((n) => noun.forms?.[n])
}

/**
 * Longest common prefix of a list of word forms — used as the (approximate)
 * stem so we can derive endings without hand-annotating every noun.
 * @param {string[]} forms
 * @returns {string}
 */
export function commonStem(forms) {
  if (!forms.length) return ''
  const chars = [...forms[0]]
  let len = chars.length
  for (const form of forms.slice(1)) {
    const other = [...form]
    len = Math.min(len, other.length)
    let i = 0
    while (i < len && chars[i] === other[i]) i++
    len = i
  }
  return chars.slice(0, len).join('')
}

/**
 * Flatten every form in a noun's table into a single list of (stress-free)
 * strings.
 * @param {object} noun
 * @returns {string[]}
 */
export function allForms(noun) {
  return numbersOf(noun).flatMap((num) =>
    CASES.filter((c) => noun.forms[num][c]).map((c) => stripStress(noun.forms[num][c])),
  )
}

/**
 * Derive the ending table (stem stripped) for a noun. Stress marks are removed
 * first so endings reflect what a learner would type.
 * @param {object} noun
 * @returns {{stem: string, endings: Record<string, Record<string, string>>}}
 */
export function endingsTable(noun) {
  const stem = commonStem(allForms(noun))
  const stemLen = [...stem].length
  const endings = {}
  for (const num of numbersOf(noun)) {
    endings[num] = {}
    for (const c of CASES) {
      if (!noun.forms[num][c]) continue
      endings[num][c] = [...stripStress(noun.forms[num][c])].slice(stemLen).join('')
    }
  }
  return { stem, endings }
}

/**
 * Given a surface form, return every (number, case) slot in which the noun
 * takes exactly that form (comparison ignores stress and case). Powers the
 * "which case is this?" easy drill, where a single form (e.g. книге = dative
 * *and* prepositional) can have several correct answers.
 * @param {object} noun
 * @param {string} form
 * @returns {Array<{number: string, case: string}>}
 */
export function matchingSlots(noun, form) {
  const target = stripStress(form).trim().toLowerCase()
  const matches = []
  for (const num of numbersOf(noun)) {
    for (const c of CASES) {
      if (!noun.forms[num][c]) continue
      if (stripStress(noun.forms[num][c]).toLowerCase() === target) {
        matches.push({ number: num, case: c })
      }
    }
  }
  return matches
}

/**
 * The set of distinct cases a form is valid in (collapsing number), as a Set of
 * case keys. Convenient for grading the easy-mode multi-select.
 * @param {object} noun
 * @param {string} form
 * @returns {Set<string>}
 */
export function validCases(noun, form) {
  return new Set(matchingSlots(noun, form).map((m) => m.case))
}

/** Canonical key for a (number, case) slot, e.g. 'pl.gen'. */
export function slotKey(number, c) {
  return `${number}.${c}`
}

/**
 * The set of (number, case) slots a form is valid in, as a Set of slot keys
 * (e.g. 'pl.gen'). Like {@link validCases} but keeps the number distinction —
 * used to grade the easy drill where learners pick case *and* number.
 * @param {object} noun
 * @param {string} form
 * @returns {Set<string>}
 */
export function validSlots(noun, form) {
  return new Set(matchingSlots(noun, form).map((m) => slotKey(m.number, m.case)))
}
