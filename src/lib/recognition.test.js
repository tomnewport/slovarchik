import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  recognitionSupported,
  spokenSimilarity,
  wordDiff,
  isPass,
  gradeSpoken,
  recognitionErrorMessage,
  listen,
} from './recognition.js'

afterEach(() => {
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
  vi.restoreAllMocks()
})

describe('recognitionSupported', () => {
  it('is false without a SpeechRecognition implementation', () => {
    expect(recognitionSupported()).toBe(false)
  })

  it('is true with either the standard or webkit-prefixed constructor', () => {
    window.webkitSpeechRecognition = class {}
    expect(recognitionSupported()).toBe(true)
  })
})

describe('spokenSimilarity', () => {
  it('scores identical phrases as 1 (ignoring stress, case and punctuation)', () => {
    expect(spokenSimilarity('Приве́т, как дела?', 'привет как дела')).toBe(1)
  })

  it('scores nothing in common as 0', () => {
    expect(spokenSimilarity('кошка', 'dog')).toBe(0)
  })

  it('treats two empty strings as a perfect match but empty-vs-nonempty as 0', () => {
    expect(spokenSimilarity('', '')).toBe(1)
    expect(spokenSimilarity('', 'привет')).toBe(0)
  })

  it('gives partial credit for partly-right utterances', () => {
    const s = spokenSimilarity('как дела', 'привет как дела')
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })
})

describe('isPass', () => {
  it('recognises short skip utterances in either language', () => {
    expect(isPass('pass')).toBe(true)
    expect(isPass('skip')).toBe(true)
    expect(isPass('не знаю')).toBe(true)
    expect(isPass('пас')).toBe(true)
  })

  it('does not treat a real answer containing a pass word as a pass', () => {
    expect(isPass('what comes next in the queue')).toBe(false)
    expect(isPass('')).toBe(false)
  })
})

describe('gradeSpoken', () => {
  it('accepts an exact (normalised) match', () => {
    const { correct, similarity } = gradeSpoken('Приве́т!', 'привет')
    expect(correct).toBe(true)
    expect(similarity).toBe(1)
  })

  it('accepts a close-enough match above the threshold', () => {
    const { correct } = gradeSpoken('the cat is sleeping', 'the cat is asleep', 0.5)
    expect(correct).toBe(true)
  })

  it('rejects an answer below the threshold', () => {
    expect(gradeSpoken('собака', 'большая красивая кошка').correct).toBe(false)
  })
})

describe('wordDiff', () => {
  it('flags each target word as hit or miss against what was heard', () => {
    const { words } = wordDiff('the cat is asleep', 'the cat is sleeping')
    expect(words.map((w) => w.text)).toEqual(['the', 'cat', 'is', 'sleeping'])
    expect(words.map((w) => w.hit)).toEqual([true, true, true, false])
  })

  it('keeps original spelling/punctuation but matches stress- and case-insensitively', () => {
    const { words, score } = wordDiff('привет как дела', 'Приве́т, как дела́?')
    expect(words.map((w) => w.text)).toEqual(['Приве́т,', 'как', 'дела́?'])
    expect(words.every((w) => w.hit)).toBe(true)
    expect(score).toBe(1)
  })

  it('reports words that were heard but not wanted as extra', () => {
    const { extra } = wordDiff('the big red cat', 'the cat')
    expect(extra).toEqual(expect.arrayContaining(['big', 'red']))
  })

  it('needs a repeated target word to be said the right number of times', () => {
    const { words } = wordDiff('na na', 'na na na')
    expect(words.map((w) => w.hit)).toEqual([true, true, false])
  })
})

describe('recognitionErrorMessage', () => {
  it('maps known codes to friendly text and falls back for unknown ones', () => {
    expect(recognitionErrorMessage('not-allowed')).toMatch(/Microphone/i)
    expect(recognitionErrorMessage('network')).toMatch(/network/i)
    expect(recognitionErrorMessage('unsupported')).toMatch(/Chrome/i)
    expect(recognitionErrorMessage('weird')).toMatch(/wrong/i)
  })
})

describe('listen', () => {
  it('reports unsupported and no-ops without the API', () => {
    const onError = vi.fn()
    const onEnd = vi.fn()
    const ctl = listen({ onError, onEnd })
    expect(onError).toHaveBeenCalledWith('unsupported')
    expect(onEnd).toHaveBeenCalledWith('')
    // Controller methods are safe no-ops.
    expect(() => {
      ctl.stop()
      ctl.abort()
    }).not.toThrow()
  })

  it('wires up the recogniser and surfaces transcripts and the final result', () => {
    let instance
    window.SpeechRecognition = class {
      constructor() {
        instance = this
        this.start = vi.fn()
        this.stop = vi.fn()
        this.abort = vi.fn()
      }
    }

    const results = []
    let ended
    listen({
      lang: 'en-GB',
      onResult: (r) => results.push(r),
      onEnd: (final) => {
        ended = final
      },
    })

    expect(instance.lang).toBe('en-GB')
    expect(instance.start).toHaveBeenCalled()

    // Simulate an interim then a final result, the way the browser fires them.
    instance.onresult({
      resultIndex: 0,
      results: [Object.assign([{ transcript: 'the cat' }], { isFinal: false, length: 1 })],
    })
    instance.onresult({
      resultIndex: 0,
      results: [Object.assign([{ transcript: 'the cat sleeps' }], { isFinal: true, length: 1 })],
    })
    instance.onend()

    expect(results[0].transcript).toBe('the cat')
    expect(results[1].final).toBe(true)
    expect(ended).toBe('the cat sleeps')
  })
})
