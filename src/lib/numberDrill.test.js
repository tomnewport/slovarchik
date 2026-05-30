import { describe, it, expect } from 'vitest'

import { GENERATORS, FOCUSES, nextExercise } from './numberDrill.js'
import { checkAnswer } from './quiz.js'
import { stripStress } from './text.js'

// A deterministic RNG so generated exercises are reproducible.
function seq(values) {
  let i = 0
  return () => values[i++ % values.length]
}

describe('exercise generators', () => {
  it('every generator returns a well-formed, self-consistent exercise', () => {
    const rng = seq([0.123, 0.456, 0.789, 0.05, 0.5])
    for (const make of Object.values(GENERATORS)) {
      const ex = make(rng)
      expect(ex.id, ex.kind).toBeTruthy()
      expect(ex.prompt.length, ex.kind).toBeGreaterThan(0)
      expect(Array.isArray(ex.answers) && ex.answers.length, ex.kind).toBeTruthy()
      // The revealed (accented) answer must itself be accepted by the grader.
      expect(checkAnswer(ex.reveal, ex.answers), ex.kind).toBe(true)
    }
  })

  it('grades a learner answer ignoring stress and ё/е', () => {
    const год2024 = GENERATORS.year(() => 0.62) // → some year ≥ 1900
    // Typing the bare (unstressed) reveal should be accepted.
    expect(checkAnswer(stripStress(год2024.reveal), год2024.answers)).toBe(true)
  })

  it('year answers accept the phrase with or without «году»', () => {
    const ex = GENERATORS.year(() => 0) // → 1900
    expect(checkAnswer('тысяча девятисотом году', ex.answers)).toBe(true)
    expect(checkAnswer('тысяча девятисотом', ex.answers)).toBe(true)
  })
})

describe('nextExercise', () => {
  it('only produces kinds from the requested focus', () => {
    const kinds = FOCUSES.find((f) => f.id === 'agreement').kinds
    for (let i = 0; i < 20; i++) {
      const ex = nextExercise(kinds, Math.random)
      expect(kinds).toContain(ex.kind)
    }
  })
})
