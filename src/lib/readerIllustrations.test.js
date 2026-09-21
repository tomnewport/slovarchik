import { describe, expect, it } from 'vitest'
import { illustrate, illustrationFor, LEXICON } from './readerIllustrations.js'

const s = (id, ru, en = '') => ({ id, ru, en })

describe('choosing a picture for one sentence', () => {
  it('reads the Russian, inflected as the text has it', () => {
    expect(illustrationFor(s('1', 'Голубка несла ветку.')).emoji).toBe('🕊️')
    expect(illustrationFor(s('2', 'Муравей спустился к ручью.')).emoji).toBe('🐜')
  })

  it('takes the translation as a second opinion, not as the only one', () => {
    expect(illustrationFor(s('1', 'Zzz zzz.', 'A dove carried a twig.')).emoji).toBe('🕊️')
    // One passing English word is not enough on its own to illustrate a window.
    expect(illustrate([s('1', 'Zzz zzz.', 'A leaf.')]).size).toBe(0)
  })

  it('prefers the concrete thing to the weather it is in', () => {
    expect(illustrationFor(s('1', 'Зимой голубка летела над полем.')).emoji).toBe('🕊️')
  })

  it('will not mistake a word that merely starts the same way', () => {
    // которая is not кот, столько is not стол, полно is not поле.
    for (const ru of ['Которая книга?', 'Столько дел!', 'Ну, полно!']) {
      const found = illustrationFor(s('1', ru))
      expect(found?.emoji, ru).not.toBe('🐱')
      expect(found?.emoji, ru).not.toBe('🍽️')
      expect(found?.emoji, ru).not.toBe('🌾')
    }
  })

  it('has nothing to say about a sentence with nothing in it to draw', () => {
    expect(illustrationFor(s('1', 'Он сказал, что это именно так.'))).toBeNull()
    expect(illustrationFor(undefined)).toBeNull()
  })
})

describe('illustrating a book', () => {
  const sentences = [
    s('1', 'Муравей спустился к ручью.'),
    s('2', 'Он захотел напиться.'),
    s('3', 'Волна захлестнула его.'),
    s('4', 'Голубка несла ветку.'),
    s('5', 'Муравей сел на ветку и спасся.'),
    s('6', 'Охотник расставил сеть на голубку.'),
  ]

  it('gives at most one picture to each window of sentences', () => {
    const picked = illustrate(sentences, { every: 3 })
    expect(picked.size).toBeLessThanOrEqual(2)
    const first = sentences.slice(0, 3).filter((sentence) => picked.has(sentence.id))
    expect(first).toHaveLength(1)
  })

  it('never repeats the picture it has just used, even at the cost of a window', () => {
    const doves = Array.from({ length: 12 }, (_, i) => s(String(i), 'Голубка несла ветку.'))
    const picked = [...illustrate(doves, { every: 2 }).values()]
    expect(picked).toEqual(['🕊️'])
  })

  it('leaves a stretch with nothing to draw bare', () => {
    const quiet = Array.from({ length: 8 }, (_, i) => s(String(i), 'Он сказал, что это именно так.'))
    expect(illustrate(quiet).size).toBe(0)
  })

  it('is the same book every time it is asked', () => {
    expect([...illustrate(sentences)]).toEqual([...illustrate(sentences)])
  })

  it('has nothing to illustrate in no book at all', () => {
    expect(illustrate(undefined).size).toBe(0)
    expect(illustrate([]).size).toBe(0)
  })
})

describe('the lexicon itself', () => {
  it('gives every entry an emoji and something to match on', () => {
    for (const entry of LEXICON) {
      expect(entry.emoji, JSON.stringify(entry)).toBeTruthy()
      expect((entry.ru?.length ?? 0) + (entry.ruExact?.length ?? 0) + (entry.en?.length ?? 0))
        .toBeGreaterThan(0)
      expect(entry.weight).toBeGreaterThan(0)
    }
  })

  it('claims each emoji once, so one picture has one meaning', () => {
    const emoji = LEXICON.map((entry) => entry.emoji)
    expect(new Set(emoji).size).toBe(emoji.length)
  })
})
