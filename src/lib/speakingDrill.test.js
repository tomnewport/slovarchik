import { describe, it, expect } from 'vitest'

import {
  MODES,
  findMode,
  estimateSpeechMs,
  sequenceDurationMs,
  ruWords,
  needsWarmUp,
  buildWarmUpSequence,
  gradeGuesses,
  buildFeedbackSequence,
  shouldRetryEmpty,
  LONG_PHRASE_WORDS,
  MAX_EMPTY_RETRIES,
} from './speakingDrill.js'
import { SLOW_RATE } from './speech.js'

describe('MODES / findMode', () => {
  it('has the three drill modes with distinct ids', () => {
    expect(MODES.map((m) => m.id)).toEqual(['echo', 'produce', 'interpret'])
  })

  it('interpret listens in English and grades the English field', () => {
    const m = findMode('interpret')
    expect(m.recLang).toBe('en-GB')
    expect(m.target).toBe('en')
    expect(m.promptRu).toBe(true)
  })

  it('returns null for an unknown mode', () => {
    expect(findMode('nope')).toBe(null)
  })
})

describe('estimateSpeechMs', () => {
  it('clamps to the [2500, 12000] range', () => {
    expect(estimateSpeechMs('')).toBe(2500)
    expect(estimateSpeechMs('a')).toBe(2500) // below the floor
    expect(estimateSpeechMs('x'.repeat(1000))).toBe(12000) // above the ceiling
  })

  it('scales with length between the bounds', () => {
    expect(estimateSpeechMs('x'.repeat(50))).toBe(50 * 90 + 1200)
  })

  it('treats null/undefined as empty', () => {
    expect(estimateSpeechMs(null)).toBe(2500)
    expect(estimateSpeechMs(undefined)).toBe(2500)
  })
})

describe('sequenceDurationMs', () => {
  it('sums the estimates of each part', () => {
    const seq = [{ text: 'a' }, { text: 'b' }]
    expect(sequenceDurationMs(seq)).toBe(estimateSpeechMs('a') + estimateSpeechMs('b'))
  })

  it('is zero for an empty or missing sequence', () => {
    expect(sequenceDurationMs([])).toBe(0)
    expect(sequenceDurationMs(undefined)).toBe(0)
  })
})

describe('ruWords', () => {
  it('splits on whitespace and drops blanks', () => {
    expect(ruWords('  Я  люблю  молоко ')).toEqual(['Я', 'люблю', 'молоко'])
  })

  it('is empty for null/empty input', () => {
    expect(ruWords('')).toEqual([])
    expect(ruWords(null)).toEqual([])
  })
})

describe('needsWarmUp', () => {
  const long = Array.from({ length: LONG_PHRASE_WORDS }, (_, i) => `сло${i}`).join(' ')
  const short = 'одно два'

  it('warms up long phrases only in hands-free mode', () => {
    expect(needsWarmUp(long, true)).toBe(true)
    expect(needsWarmUp(long, false)).toBe(false)
  })

  it('never warms up phrases shorter than the threshold', () => {
    expect(needsWarmUp(short, true)).toBe(false)
  })
})

describe('buildWarmUpSequence', () => {
  const phrase = { ru: 'Я о́чень люблю пить молоко́', en: 'I really like to drink milk' }

  it('reads RU, EN, slow RU, a cue, then each word', () => {
    const seq = buildWarmUpSequence(phrase)
    expect(seq[0]).toEqual({ text: phrase.ru, lang: 'ru-RU', rate: 0.9 })
    expect(seq[1]).toEqual({ text: phrase.en, lang: 'en-GB', rate: 1 })
    expect(seq[2]).toEqual({ text: phrase.ru, lang: 'ru-RU', rate: SLOW_RATE })
    expect(seq[3]).toEqual({ text: 'Repeat each word:', lang: 'en-GB', rate: 1 })
    // one slow item per Russian word, letters only (stress marks stripped)
    expect(seq.slice(4)).toEqual([
      { text: 'Я', lang: 'ru-RU', rate: 0.7 },
      { text: 'очень', lang: 'ru-RU', rate: 0.7 },
      { text: 'люблю', lang: 'ru-RU', rate: 0.7 },
      { text: 'пить', lang: 'ru-RU', rate: 0.7 },
      { text: 'молоко', lang: 'ru-RU', rate: 0.7 },
    ])
  })

  it('drops words that reduce to no letters', () => {
    const seq = buildWarmUpSequence({ ru: 'да — нет', en: 'yes no' })
    expect(seq.slice(4).map((s) => s.text)).toEqual(['да', 'нет'])
  })
})

describe('gradeGuesses', () => {
  it('counts an exact match correct with a per-word diff', () => {
    const r = gradeGuesses('спасибо', [], 'спасибо')
    expect(r.passed).toBe(false)
    expect(r.correct).toBe(true)
    expect(r.best).toBe('спасибо')
    expect(r.diff).not.toBe(null)
  })

  it('treats "pass" as a deliberate skip: score 0, no diff', () => {
    const r = gradeGuesses('pass', [], 'спасибо')
    expect(r.passed).toBe(true)
    expect(r.correct).toBe(false)
    expect(r.similarity).toBe(0)
    expect(r.diff).toBe(null)
    expect(r.best).toBe('pass')
  })

  it('grades on the most generous alternative when several are given', () => {
    const r = gradeGuesses('spa seebo', ['spa seebo', 'спасибо'], 'спасибо')
    expect(r.correct).toBe(true)
    expect(r.best).toBe('спасибо')
  })

  it('marks a clearly wrong answer incorrect', () => {
    const r = gradeGuesses('до свидания', [], 'спасибо')
    expect(r.passed).toBe(false)
    expect(r.correct).toBe(false)
  })
})

describe('buildFeedbackSequence', () => {
  it('says "Correct." then the phrase at normal rate when right', () => {
    const { cue, sequence } = buildFeedbackSequence({ correct: true, passed: false }, 'спасибо')
    expect(cue).toBe('Correct.')
    expect(sequence[0]).toEqual({ text: 'Correct.', lang: 'en-GB', rate: 1 })
    expect(sequence[1]).toEqual({ text: 'спасибо', lang: 'ru-RU', rate: 0.9 })
  })

  it('says "Not quite." and reads the model slowly when wrong', () => {
    const { cue, sequence } = buildFeedbackSequence({ correct: false, passed: false }, 'спасибо')
    expect(cue).toBe('Not quite.')
    expect(sequence[1].rate).toBe(SLOW_RATE)
  })

  it('says "Passed." on a deliberate pass', () => {
    const { cue } = buildFeedbackSequence({ correct: false, passed: true }, 'спасибо')
    expect(cue).toBe('Passed.')
  })
})

describe('shouldRetryEmpty', () => {
  it('retries silent results in hands-free mode under the cap', () => {
    expect(shouldRetryEmpty(true, '', 0)).toBe(true)
    expect(shouldRetryEmpty(true, 'no-speech', MAX_EMPTY_RETRIES - 1)).toBe(true)
  })

  it('never retries when not hands-free', () => {
    expect(shouldRetryEmpty(false, '', 0)).toBe(false)
  })

  it('never retries on a fatal error', () => {
    expect(shouldRetryEmpty(true, 'not-allowed', 0)).toBe(false)
    expect(shouldRetryEmpty(true, 'audio-capture', 0)).toBe(false)
  })

  it('stops once the retry cap is reached', () => {
    expect(shouldRetryEmpty(true, '', MAX_EMPTY_RETRIES)).toBe(false)
  })
})
