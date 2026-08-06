import { describe, it, expect } from 'vitest'

import { duplicateSpellPrompts, posLabel, spellPrompt, spellPromptsFor } from './spellPrompt.js'

describe('posLabel', () => {
  it('is just the part of speech when there is no aspect', () => {
    expect(posLabel('noun')).toBe('noun')
    expect(posLabel('adjective', null)).toBe('adjective')
  })

  it('spells out a verb’s aspect alongside it', () => {
    expect(posLabel('verb', 'pf')).toBe('verb · perfective')
    expect(posLabel('verb', 'impf')).toBe('verb · imperfective')
  })

  it('ignores an aspect it doesn’t recognise', () => {
    expect(posLabel('verb', 'bogus')).toBe('verb')
  })

  it('is empty without a part of speech', () => {
    expect(posLabel(null, 'pf')).toBe('')
  })
})

describe('spellPrompt', () => {
  it('renders gloss, note and part of speech', () => {
    const w = { en: ['to kill', 'to murder'], note: 'to murder', pos: 'verb', aspect: 'pf' }
    expect(spellPrompt(w)).toBe('to kill (to murder) — verb · perfective')
  })

  it('omits the brackets when there is no note', () => {
    expect(spellPrompt({ en: 'house', pos: 'noun' })).toBe('house — noun')
  })

  it('accepts a plain string gloss', () => {
    expect(spellPrompt({ en: 'quickly', note: 'at speed', pos: 'adverb' })).toBe(
      'quickly (at speed) — adverb',
    )
  })

  it('takes an explicit shown gloss over the word’s own', () => {
    expect(spellPrompt({ en: ['glove'], pos: 'noun' }, 'gloves')).toBe('gloves — noun')
  })
})

describe('spellPromptsFor', () => {
  const base = { en: ['glove'], pos: 'noun', ruPl: 'перча́тки', enPl: ['gloves'] }

  it('is one prompt for an ordinary word', () => {
    expect(spellPromptsFor({ en: ['house'], pos: 'noun' })).toEqual(['house — noun'])
  })

  it('is the plural alone when the word always displays plural', () => {
    expect(spellPromptsFor({ ...base, displayNumber: 'pl' })).toEqual(['gloves — noun'])
  })

  it('covers both surfaces when the display number is mixed', () => {
    expect(spellPromptsFor({ ...base, displayNumber: 'mixed' })).toEqual([
      'glove — noun',
      'gloves — noun',
    ])
  })

  it('falls back to the singular when the plural data is missing', () => {
    expect(spellPromptsFor({ en: ['glove'], pos: 'noun', displayNumber: 'pl' })).toEqual([
      'glove — noun',
    ])
  })
})

describe('duplicateSpellPrompts', () => {
  const kill = { id: 'убить=to kill', en: ['to kill'], note: 'to murder', pos: 'verb', aspect: 'pf' }
  const killing = {
    id: 'убивать=to kill',
    en: ['to kill'],
    note: 'to murder',
    pos: 'verb',
    aspect: 'impf',
  }

  it('finds nothing when every prompt is distinct', () => {
    expect(duplicateSpellPrompts([kill, killing])).toEqual([])
  })

  it('reports words the learner cannot tell apart', () => {
    const same = { ...killing, aspect: 'pf' }
    expect(duplicateSpellPrompts([kill, same])).toEqual([
      { prompt: 'to kill (to murder) — verb · perfective', ids: ['убивать=to kill', 'убить=to kill'] },
    ])
  })

  it('catches a collision on a plural display surface only', () => {
    const a = { id: 'a', en: ['glove'], pos: 'noun', displayNumber: 'pl', ruPl: 'x', enPl: ['gloves'] }
    const b = { id: 'b', en: ['gloves'], pos: 'noun' }
    expect(duplicateSpellPrompts([a, b])).toEqual([{ prompt: 'gloves — noun', ids: ['a', 'b'] }])
  })

  it('tolerates an empty list', () => {
    expect(duplicateSpellPrompts()).toEqual([])
  })
})
