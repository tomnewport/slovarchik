// Pure helpers for working with Russian noun declension tables.

export const CASES = ['nom', 'gen', 'dat', 'acc', 'ins', 'pre']

export const CASE_LABELS = {
  nom: 'Nominative',
  gen: 'Genitive',
  dat: 'Dative',
  acc: 'Accusative',
  ins: 'Instrumental',
  pre: 'Prepositional',
}

/** Short hint of the question each case answers, handy for learners. */
export const CASE_HINTS = {
  nom: 'who / what (subject)',
  gen: 'of whom / of what',
  dat: 'to whom / to what',
  acc: 'whom / what (object)',
  ins: 'with / by whom / what',
  pre: 'about whom / what',
}

export const NUMBERS = ['singular', 'plural']

export const NUMBER_LABELS = {
  singular: 'Singular',
  plural: 'Plural',
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
 * Flatten every form in a noun's table into a single list of strings.
 * @param {object} noun
 * @returns {string[]}
 */
export function allForms(noun) {
  return NUMBERS.flatMap((num) => CASES.map((c) => noun.forms[num][c]))
}

/**
 * Derive the ending table (stem stripped) for a noun.
 * @param {object} noun
 * @returns {{stem: string, endings: Record<string, Record<string, string>>}}
 */
export function endingsTable(noun) {
  const stem = commonStem(allForms(noun))
  const endings = {}
  for (const num of NUMBERS) {
    endings[num] = {}
    for (const c of CASES) {
      endings[num][c] = [...noun.forms[num][c]].slice([...stem].length).join('')
    }
  }
  return { stem, endings }
}

/**
 * Given a surface form, return every (number, case) slot in which the noun
 * takes exactly that form. Powers the "which case is this?" easy drill, where a
 * single form (e.g. книге = dative *and* prepositional) can have several
 * correct answers.
 * @param {object} noun
 * @param {string} form
 * @returns {Array<{number: string, case: string}>}
 */
export function matchingSlots(noun, form) {
  const target = String(form).trim().toLowerCase()
  const matches = []
  for (const num of NUMBERS) {
    for (const c of CASES) {
      if (noun.forms[num][c].toLowerCase() === target) {
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
