// Literature lookup is intentionally context-free. The existing vocabulary
// owns meanings and forms; a book pack never carries a second dictionary.
import { hasStressMark, normToken, normTokenStress } from './phraseHint.js'
import { CASE_LABELS, NUMBER_LABELS } from './declension.js'

const WORD = /[\p{L}\p{M}]+(?:[-’][\p{L}\p{M}]+)*|[^\p{L}\p{M}]+/gu
const CYRILLIC = /\p{Script=Cyrillic}/u
// «6-ым изданием»: the tokeniser splits on the digits, so the grammatical
// ending arrives as a token of its own. It is a suffix, not a word, and no
// dictionary will ever hold it — so it is text, like the digits it belongs to.
const ORDINAL_TAIL = /\d[-‑–—]$/

/**
 * Split a sentence into rendered tokens, marking the ones worth tapping.
 *
 * Only Cyrillic tokens are tappable: a Latin «III» or a page number is printed
 * as it stands, because the tap dictionary has nothing to say about it and an
 * always-empty popup reads as a broken lookup rather than a foreign word.
 * @param {string} sentence
 * @returns {{text: string, word: boolean}[]}
 */
export function readerTokens(sentence) {
  const tokens = [...String(sentence).matchAll(WORD)].map(([text]) => ({ text, word: CYRILLIC.test(text) }))
  for (let i = 1; i < tokens.length; i++) {
    if (ORDINAL_TAIL.test(tokens[i - 1].text)) tokens[i].word = false
  }
  return tokens
}

/** Return every dictionary record that claims this form, including homographs. */
export function lookupReaderWord(surface, index, byKey) {
  const stressed = hasStressMark(surface) && index?.stressIndex
    ? index.stressIndex
    : null
  const exactKey = stressed ? normTokenStress(surface) : ''
  const exact = stressed?.get(exactKey)
  const plainKey = normToken(surface)
  const chosen = exact || index?.get(plainKey)
  const keys = exact
    ? stressed.candidates?.get(exactKey) ?? exact.senses.map((sense) => sense.key)
    : index?.candidates?.get(plainKey) ?? chosen?.senses?.map((sense) => sense.key) ?? []
  return [...new Set(keys)].map((wordKey) => byKey.get(wordKey)).filter(Boolean).map((word) => ({
    key: word.key,
    lemma: word.headword || word.ru,
    meaning: word.meaning || word.en,
    // `glossary` is a filing decision, not a part of speech — the reader-only
    // and example-sentence stubs live under it — so the popup is given nothing
    // to print rather than the word "glossary".
    pos: word.pos === 'glossary' ? '' : word.pos,
    morphology: morphologyFor(word, surface),
    notes: word.facts?.filter((fact) => fact.kind === 'note').map((fact) => fact.text) ?? [],
  }))
}

function morphologyFor(word, surface) {
  const notes = []
  if (word.gender) notes.push(({ m: 'masculine', f: 'feminine', n: 'neuter' })[word.gender] ?? word.gender)
  if (word.aspect) notes.push(({ pf: 'perfective', impf: 'imperfective' })[word.aspect] ?? word.aspect)
  if (word.pos === 'noun') {
    for (const [number, forms] of Object.entries(word.forms ?? {})) {
      for (const [grammaticalCase, form] of Object.entries(forms ?? {})) {
        if (normToken(form) === normToken(surface)) {
          notes.push(`${CASE_LABELS[grammaticalCase] ?? grammaticalCase} ${NUMBER_LABELS[number]?.toLowerCase() ?? number}`)
        }
      }
    }
  }
  return notes
}
