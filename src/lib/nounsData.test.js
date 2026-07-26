// Data-integrity guard for the noun lexicon's declension completeness.
//
// The existing `declension.test.js` integrity check runs over the test
// *fixtures*, so a noun in the full corpus that declares a number but stores no
// forms for it slips through (ten `-ство` nouns declared `["sg", "pl"]` with no
// plural cells — #453). This guard runs over the whole `nouns.yml`: every
// number a noun declares must carry all six case forms, as a non-empty string.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/vocab')
const nouns = yaml.load(readFileSync(resolve(vocabDir, 'nouns.yml'), 'utf8')).words
const entries = Object.entries(nouns)

const CASES = ['nom', 'gen', 'dat', 'acc', 'ins', 'pre']

describe('declension completeness (full corpus)', () => {
  const declinable = entries.filter(([, w]) => w.declension && w.learn !== false)

  it('covers the lexicon', () => {
    expect(declinable.length).toBeGreaterThan(1500)
  })

  it.each(declinable.map(([key, w]) => [key, w]))(
    '%s has every case for each number it declares',
    (key, w) => {
      const numbers = w.number ?? ['sg']
      for (const num of numbers) {
        for (const c of CASES) {
          const form = w.declension[`${num}_${c}`]
          expect(typeof form, `${key} missing ${num}_${c}`).toBe('string')
          expect(form.length, `${key} empty ${num}_${c}`).toBeGreaterThan(0)
        }
      }
    },
  )
})
