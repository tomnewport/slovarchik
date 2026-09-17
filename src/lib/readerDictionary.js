// Literature lookup is intentionally context-free. The existing vocabulary
// owns meanings and forms; a book pack never carries a second dictionary.
import { hasStressMark, normToken, normTokenStress } from './phraseHint.js'
import { CASE_LABELS, NUMBER_LABELS } from './declension.js'

const WORD = /[\p{L}\p{M}]+(?:[-’][\p{L}\p{M}]+)*|[^\p{L}\p{M}]+/gu

export function readerTokens(sentence) {
  return [...String(sentence).matchAll(WORD)].map(([text]) => ({ text, word: /\p{L}/u.test(text) }))
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
    pos: word.pos === 'glossary' ? 'glossary' : word.pos,
    morphology: morphologyFor(word, surface),
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
