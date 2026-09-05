// Data-integrity guard for the rule oracle (#646).
//
// The oracle names grammar rules and reads a preposition table, and both are
// held in the module so it stays framework- and data-free. That is only honest
// while the module and the corpus agree, which is what this file checks:
//
//   - every rule id the oracle can emit exists in `grammar-rules.yml`, so a
//     reminder can never point at a rule the app has nothing to show for;
//   - the single-case preposition table matches `prepositions.yml` in BOTH
//     directions — no preposition claimed to have one case that the corpus
//     gives two, and none quietly missing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import { ORACLE_RULES, SINGLE_CASE_PREPOSITIONS } from './ruleOracle.js'
import { stripStress } from './text.js'

const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/vocab')
const load = (file) => yaml.load(readFileSync(resolve(vocabDir, file), 'utf8'))

const rules = load('grammar-rules.yml').rules
const prepositions = load('prepositions.yml').words

/** Corpus prepositions that govern exactly one case: bare spelling → case. */
const corpusSingleCase = new Map(
  Object.entries(prepositions)
    .map(([key, w]) => [stripStress(w.accented || key.split('=')[0]).toLowerCase(), w.governs ?? []])
    .filter(([, governs]) => governs.length === 1)
    .map(([ru, governs]) => [ru, governs[0]]),
)

describe('rule ids the oracle can name', () => {
  it.each([...ORACLE_RULES])('%s exists in grammar-rules.yml', (id) => {
    expect(rules[id], `missing rule ${id}`).toBeTruthy()
  })

  it.each([...ORACLE_RULES])('%s carries a title and an explanation', (id) => {
    expect(rules[id].title, id).toBeTruthy()
    expect(rules[id].explanation, id).toBeTruthy()
  })
})

describe('the single-case preposition table', () => {
  it('covers every one-case preposition in the corpus', () => {
    const missing = [...corpusSingleCase.keys()].filter((ru) => !SINGLE_CASE_PREPOSITIONS[ru])
    expect(missing, `prepositions.yml has one-case entries the oracle omits`).toEqual([])
  })

  it('claims no preposition the corpus gives more than one case', () => {
    const wrong = Object.keys(SINGLE_CASE_PREPOSITIONS).filter((ru) => !corpusSingleCase.has(ru))
    expect(wrong, `the oracle claims a single case the corpus does not`).toEqual([])
  })

  it('agrees with the corpus on which case each governs', () => {
    for (const [ru, kase] of Object.entries(SINGLE_CASE_PREPOSITIONS)) {
      expect(corpusSingleCase.get(ru), ru).toBe(kase)
    }
  })

  it('has a rule for each case it can point at', () => {
    for (const kase of new Set(Object.values(SINGLE_CASE_PREPOSITIONS))) {
      expect(rules[`prep-gov-${kase}`], `prep-gov-${kase}`).toBeTruthy()
    }
  })
})
