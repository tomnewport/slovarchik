import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { buildFormIndex } from './phraseHint.js'
import { lookupReaderWord } from './readerDictionary.js'
import { buildWords } from './vocabBuild.js'

const doc = yaml.load(readFileSync(resolve('public/vocab/names.yml'), 'utf8'))
const words = buildWords([{ pos: 'noun', doc }])
const byKey = new Map(words.map((word) => [word.key, word]))
const index = buildFormIndex(words)

describe('personal names in the common dictionary', () => {
  it('recognizes diminutives, patronymics and ordinary case forms', () => {
    expect(words.length).toBeGreaterThanOrEqual(17)
    expect(words.every((word) => !word.learnable)).toBe(true)
    for (const [surface, key, caseName] of [
      ['Машу', 'Маша=Masha', 'Accusative singular'],
      ['Алексею', 'Алексей=Alexei', 'Dative singular'],
      ['Николаевича', 'Николаевич=Nikolaevich', 'Genitive singular'],
      ['Марией', 'Мария=Maria', 'Instrumental singular'],
    ]) {
      const hit = lookupReaderWord(surface, index, byKey).find((entry) => entry.key === key)
      expect(hit?.morphology).toContain(caseName)
    }
    expect(lookupReaderWord('Машенька', index, byKey)[0].notes[0]).toContain('Маша')
  })
})
