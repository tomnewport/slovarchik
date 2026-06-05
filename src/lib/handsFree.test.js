import { describe, it, expect } from 'vitest'

import {
  ACTIVITY_TYPES,
  buildActivity,
  gradeActivity,
  availableTypes,
  nextActivity,
  warmupActivities,
  isStart,
  isQuit,
  isPass,
} from './handsFree.js'
import { SLOW_RATE } from './speech.js'

const word = { id: 'молоко=milk', ru: 'молоко́', en: ['milk', 'dairy'] }
const phrase = { id: 'p1', ru: 'Я люблю молоко', en: 'I like milk', source: 'молоко=milk' }

describe('buildActivity', () => {
  it('returns null for a missing item', () => {
    expect(buildActivity('new-words', null)).toBe(null)
    expect(buildActivity('nope', word)).toBe(null)
  })

  it('new-words reads RU, EN, then slow RU and listens in Russian', () => {
    const a = buildActivity('new-words', word)
    expect(a.recLang).toBe('ru-RU')
    expect(a.targets).toEqual(['молоко́'])
    expect(a.maxAttempts).toBe(3)
    expect(a.dimension).toBe('speaking')
    expect(a.recordKey).toBe('молоко=milk')
    expect(a.prompt.map((p) => p.lang)).toEqual(['ru-RU', 'en-GB', 'ru-RU'])
    // last prompt part (the slow Russian) is at the slow rate
    expect(a.prompt[2].rate).toBe(SLOW_RATE)
    expect(a.prompt[1].text).toBe('milk')
  })

  it('word-test prompts in English and expects spoken Russian', () => {
    const a = buildActivity('word-test', word)
    expect(a.recLang).toBe('ru-RU')
    expect(a.prompt).toEqual([{ text: 'milk', lang: 'en-GB', rate: 0.9 }])
    expect(a.targets).toEqual(['молоко́'])
    expect(a.dimension).toBe('usage')
    expect(a.maxAttempts).toBe(1)
    // correction reads English, then Russian, then slow Russian
    expect(a.model.map((p) => p.lang)).toEqual(['en-GB', 'ru-RU', 'ru-RU'])
  })

  it('translate-word prompts in Russian and accepts any English gloss', () => {
    const a = buildActivity('translate-word', word)
    expect(a.recLang).toBe('en-GB')
    expect(a.targets).toEqual(['milk', 'dairy'])
    expect(a.dimension).toBe('hearing')
  })

  it('repeat-phrase reads Russian, English, then slow Russian', () => {
    const a = buildActivity('repeat-phrase', phrase)
    expect(a.prompt.map((p) => p.lang)).toEqual(['ru-RU', 'en-GB', 'ru-RU'])
    expect(a.prompt[0].text).toBe('Я люблю молоко')
    expect(a.prompt[2].rate).toBe(SLOW_RATE) // slow Russian = 50%
  })

  it('phrase activities record against the source word', () => {
    expect(buildActivity('repeat-phrase', phrase).recordKey).toBe('молоко=milk')
    expect(buildActivity('translate-phrase', phrase).recordKey).toBe('молоко=milk')
    expect(buildActivity('phrase-to-russian', phrase).recordKey).toBe('молоко=milk')
  })

  it('translate-phrase listens in English for the English gloss', () => {
    const a = buildActivity('translate-phrase', phrase)
    expect(a.recLang).toBe('en-GB')
    expect(a.targets).toEqual(['I like milk'])
  })

  it('phrase-to-russian listens in Russian for the Russian phrase', () => {
    const a = buildActivity('phrase-to-russian', phrase)
    expect(a.recLang).toBe('ru-RU')
    expect(a.targets).toEqual(['Я люблю молоко'])
  })
})

describe('gradeActivity', () => {
  it('marks a close Russian answer correct (stress/case ignored)', () => {
    const a = buildActivity('word-test', word)
    expect(gradeActivity(a, 'молоко').correct).toBe(true)
  })

  it('keeps the most generous match across alternative answers', () => {
    const a = buildActivity('translate-word', word)
    // "dairy" is the second accepted gloss — still correct.
    expect(gradeActivity(a, ['dairy']).correct).toBe(true)
  })

  it('rejects a wrong answer and reports the best guess', () => {
    const a = buildActivity('word-test', word)
    const r = gradeActivity(a, 'сыр')
    expect(r.correct).toBe(false)
    expect(r.best).toBe('сыр')
  })

  it('handles empty/blank guesses without throwing', () => {
    const a = buildActivity('word-test', word)
    expect(gradeActivity(a, '').correct).toBe(false)
    expect(gradeActivity(a, []).correct).toBe(false)
  })
})

describe('availableTypes / nextActivity', () => {
  it('lists only types with eligible items, in canonical order', () => {
    const pools = { 'word-test': [word], 'translate-phrase': [phrase], 'new-words': [] }
    expect(availableTypes(pools)).toEqual(['word-test', 'translate-phrase'])
  })

  it('returns null when nothing is eligible', () => {
    expect(nextActivity({})).toBe(null)
    expect(nextActivity({ 'new-words': [] })).toBe(null)
  })

  it('picks a deterministic activity given a fixed rng', () => {
    const pools = { 'word-test': [word], 'translate-word': [word] }
    // rng = 0 → first available type, first item
    const a = nextActivity(pools, () => 0)
    expect(a.type).toBe('word-test')
    expect(a.recordKey).toBe(word.id)
  })

  it('avoids repeating the same item when an alternative exists', () => {
    const other = { id: 'сыр=cheese', ru: 'сыр', en: ['cheese'] }
    const pools = { 'word-test': [word, other] }
    // rng=0 would normally choose `word`; with avoid set it skips to `other`.
    const a = nextActivity(pools, () => 0, word.id)
    expect(a.recordKey).toBe(other.id)
  })

  it('every activity type builds from a representative item', () => {
    for (const type of ACTIVITY_TYPES) {
      const item = type.includes('phrase') ? phrase : word
      expect(buildActivity(type, item)).not.toBe(null)
    }
  })
})

describe('warmupActivities', () => {
  const a = { id: 'a=a', ru: 'а', en: ['a'] }
  const b = { id: 'b=b', ru: 'б', en: ['b'] }

  it('builds new-words activities for up to `count` distinct words', () => {
    const out = warmupActivities([a, b], 2, () => 0)
    expect(out).toHaveLength(2)
    expect(out.every((x) => x.type === 'new-words')).toBe(true)
  })

  it('caps at the pool size and returns [] for an empty pool', () => {
    expect(warmupActivities([a], 3, () => 0)).toHaveLength(1)
    expect(warmupActivities([], 3)).toEqual([])
  })
})

describe('spoken control words', () => {
  it('recognises Russian start cues (the welcome mic listens in ru-RU)', () => {
    expect(isStart('давай')).toBe(true)
    expect(isStart('давай!')).toBe(true)
    expect(isStart('поехали')).toBe(true)
    // English cues aren't recognised in Russian mode, so they aren't accepted.
    expect(isStart('go')).toBe(false)
    expect(isStart('молоко')).toBe(false)
  })

  it('recognises quit cues', () => {
    expect(isQuit('quit')).toBe(true)
    expect(isQuit('стоп')).toBe(true)
    expect(isQuit('I want to keep going')).toBe(false)
  })

  it('re-exports isPass for skip detection', () => {
    expect(isPass('pass')).toBe(true)
    expect(isPass('молоко')).toBe(false)
  })
})
