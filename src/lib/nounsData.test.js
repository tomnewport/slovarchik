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

// Guard the vocab word-drill display-number annotation (#…): usually-plural
// nouns stored singular (перчатка, сапог) may set `display_number` to show the
// plural in the vocab drills. When they do, the plural form and gloss must both
// exist, or the drill would render a blank/mismatched prompt.
describe('display_number annotation (full corpus)', () => {
  const annotated = entries.filter(([, w]) => w.display_number != null)

  it.each(annotated.map(([key, w]) => [key, w]))('%s is a valid display_number', (key, w) => {
    expect(['sg', 'pl', 'mixed'], `${key} bad display_number`).toContain(w.display_number)
    if (w.display_number === 'sg') return
    // pl / mixed need a plural nominative and an authored plural gloss.
    const numbers = w.number ?? ['sg', 'pl']
    expect(numbers, `${key} display_number ${w.display_number} but no pl number`).toContain('pl')
    expect(w.declension?.pl_nom, `${key} missing pl_nom`).toBeTruthy()
    const enPl = Array.isArray(w.en_pl) ? w.en_pl : w.en_pl != null ? [w.en_pl] : []
    expect(enPl.filter(Boolean).length, `${key} needs en_pl`).toBeGreaterThan(0)
  })
})
