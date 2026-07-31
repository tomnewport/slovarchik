// Data-integrity guard for the in-context inflection drill. The drill is driven
// by `inflect:` annotations on words' usage examples (in the vocab YAML) plus the
// grammar-rules.yml explanations. Every annotated example must:
//   - point its `token` at a token whose core equals the word's stored form for
//     the annotated slot (catches a mis-counted index or a wrong case/number)
//   - reference a rule id that exists
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import { loadFixtureWords } from '../test/fixtures.js'
import { shapeContextPhrases } from './vocabBuild.js'
import { normalize } from './text.js'
import { ANALYTIC_FUTURE_FORMS, buildFromPhrase, indexPhrases } from './phraseContext.js'

const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/vocab')
const rules = yaml.load(readFileSync(resolve(vocabDir, 'grammar-rules.yml'), 'utf8')).rules

const words = loadFixtureWords()
const byKey = new Map(words.map((w) => [w.key, w]))
const phrases = shapeContextPhrases(words)

/** The word's stored form for an annotated slot, or null if not found. */
function storedForm(word, t) {
  if (t.degree === 'short') {
    return word.pos === 'adjective' ? (word.short?.[t.gender] ?? null) : null
  }
  if (t.case) {
    // An adjective/pronoun accusative agreeing with an animate noun takes the
    // genitive form for masculine and plural (ви́жу хоро́шего дру́га).
    const animAcc = t.animate && t.case === 'acc' && (t.gender === 'm' || t.gender === 'pl')
    if (word.pos === 'adjective') {
      const col = animAcc ? `${t.gender}_gen` : `${t.gender}_${t.case}`
      return word.extra?.declension?.[col] ?? null
    }
    if (word.pos === 'pronoun') {
      // Pronoun forms live on the raw entry (`extra`): gendered possessives /
      // demonstratives decline like adjectives (declension[gender_case]); the
      // personal, reflexive and interrogative pronouns are flat by case.
      const ex = word.extra ?? {}
      if (t.gender) return ex.declension?.[animAcc ? `${t.gender}_gen` : `${t.gender}_${t.case}`] ?? null
      const bare = ex.forms?.[t.case] ?? null
      // Third-person post-preposition н- prefix: у него́, с ни́ми.
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
    // Imperfective verbs have no synthetic future cell of their own. Their
    // annotated future token is the finite auxiliary from быть.
    if (t.tense === 'future' && word.aspect === 'impf') return ANALYTIC_FUTURE_FORMS[t.person] ?? null
    return conj[t.tense]?.[t.person] ?? null
  }
  return null
}

describe('usage `inflect` annotations', () => {
  it('produces context phrases', () => expect(phrases.length).toBeGreaterThan(0))

  it.each(phrases.map((p) => [p.id, p]))('%s token matches the stored form for its slot', (_id, p) => {
    const w = byKey.get(p.target.key)
    expect(w, `unknown key ${p.target.key}`).toBeTruthy()
    expect(w.learnable, `${p.target.key} is not learnable`).not.toBe(false)
    const ex = buildFromPhrase(p, w, { rules })
    expect(ex, `${p.id} did not resolve`).toBeTruthy()
    const stored = storedForm(w, p.target)
    expect(stored, `no stored form for ${p.id} (${JSON.stringify(p.target)})`).toBeTruthy()
    expect(normalize(ex.answerAccented)).toBe(normalize(stored))
  })

  it.each(phrases.filter((p) => p.target.rule).map((p) => [p.id, p]))(
    '%s references an existing rule',
    (_id, p) => expect(rules[p.target.rule], `missing rule ${p.target.rule}`).toBeTruthy(),
  )

  it('every phrase id is unique', () => {
    const ids = phrases.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('indexPhrases covers every phrase', () => {
    const idx = indexPhrases(phrases)
    const total = [...idx.values()].reduce((n, list) => n + list.length, 0)
    expect(total).toBe(phrases.length)
  })
})
