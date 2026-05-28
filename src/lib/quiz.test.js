import { describe, it, expect } from 'vitest'
import { normalize, checkAnswer, shuffle, sample, buildChoices, hintLetters } from './quiz.js'

// A deterministic pseudo-rng so shuffle/sample assertions are stable.
function seededRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

describe('normalize', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normalize('  Привет   мир ')).toBe('привет мир')
  })
  it('treats ё as е', () => {
    expect(normalize('всё')).toBe('все')
  })
})

describe('checkAnswer', () => {
  it('accepts a case-insensitive match', () => {
    expect(checkAnswer('Дом', 'дом')).toBe(true)
  })
  it('accepts any of several allowed answers', () => {
    expect(checkAnswer('hi', ['hello', 'hi'])).toBe(true)
  })
  it('rejects a wrong answer', () => {
    expect(checkAnswer('cat', 'dog')).toBe(false)
  })
  it('rejects an empty answer even against an empty accepted string', () => {
    expect(checkAnswer('', '')).toBe(false)
  })
})

describe('shuffle', () => {
  it('does not mutate the input and keeps all elements', () => {
    const input = [1, 2, 3, 4, 5]
    const out = shuffle(input, seededRng(42))
    expect(input).toEqual([1, 2, 3, 4, 5])
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5])
  })
  it('is deterministic for a given rng', () => {
    expect(shuffle([1, 2, 3, 4], seededRng(7))).toEqual(shuffle([1, 2, 3, 4], seededRng(7)))
  })
})

describe('sample', () => {
  it('returns n distinct elements', () => {
    const out = sample([1, 2, 3, 4, 5], 3, seededRng(1))
    expect(out).toHaveLength(3)
    expect(new Set(out).size).toBe(3)
  })
  it('clamps to the available count', () => {
    expect(sample([1, 2], 5, seededRng(1))).toHaveLength(2)
  })
})

describe('buildChoices', () => {
  const keyOf = (x) => x.id
  const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

  it('always includes the correct answer and never duplicates it', () => {
    const correct = { id: 'a' }
    const choices = buildChoices(correct, pool, 3, keyOf, seededRng(9))
    expect(choices).toHaveLength(3)
    expect(choices.filter((c) => c.id === 'a')).toHaveLength(1)
  })
})

describe('hintLetters', () => {
  it('returns the distinct lowercased letters of a word', () => {
    expect(hintLetters('Привет')).toEqual(new Set(['п', 'р', 'и', 'в', 'е', 'т']))
  })
  it('drops spaces, punctuation and duplicates', () => {
    expect(hintLetters('мама, papa')).toEqual(new Set(['м', 'а', 'p', 'a']))
  })
  it('strips stress marks so the bare letter is highlighted', () => {
    // дома́ carries a combining acute accent on the final а.
    expect(hintLetters('до́ма')).toEqual(new Set(['д', 'о', 'м', 'а']))
  })
})
