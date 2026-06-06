import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  recognitionSupported,
  spokenSimilarity,
  levenshtein,
  charSimilarity,
  wordDiff,
  isPass,
  gradeSpoken,
  expandNumbers,
  recognitionErrorMessage,
  listen,
} from './recognition.js'

afterEach(() => {
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
  vi.restoreAllMocks()
})

describe('expandNumbers', () => {
  it('converts a time with :00 minutes to the hour cardinal', () => {
    expect(expandNumbers('в 09:00')).toBe('в де́вять')
    expect(expandNumbers('в 12:00')).toBe('в двена́дцать')
  })

  it('converts a time with non-zero minutes to hour + minute cardinals', () => {
    expect(expandNumbers('9:15')).toBe('де́вять пятна́дцать')
  })

  it('converts bare digit sequences to Russian cardinals', () => {
    expect(expandNumbers('5 кошек')).toBe('пять кошек')
  })

  it('leaves text without digits unchanged', () => {
    expect(expandNumbers('привет')).toBe('привет')
  })
})

describe('gradeSpoken', () => {
  it('accepts a time-format transcript for a Russian numeral target', () => {
    // The Web Speech API sometimes returns "09:00" instead of "де́вять".
    const { correct } = gradeSpoken(
      ['урок русского начинается в 09:00'],
      'Уро́к ру́сского начина́ется в де́вять.',
    )
    expect(correct).toBe(true)
  })
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

describe('levenshtein', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('abc', 'abc')).toBe(0)
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', '')).toBe(3)
  })
})

describe('charSimilarity', () => {
  it('is 1 for identical letters, ignoring stress, case, spaces and punctuation', () => {
    expect(charSimilarity('Приве́т, как дела?', 'привет как дела')).toBe(1)
  })

  it('drops by one edit over the longer length', () => {
    expect(charSimilarity('кот', 'кит')).toBeCloseTo(2 / 3)
  })

  it('treats empty-vs-empty as 1 and empty-vs-nonempty as 0', () => {
    expect(charSimilarity('', '')).toBe(1)
    expect(charSimilarity('', 'кот')).toBe(0)
  })
})

describe('gradeSpoken', () => {
  it('passes an exact match', () => {
    const { correct, similarity, best } = gradeSpoken('Приве́т!', 'привет')
    expect(correct).toBe(true)
    expect(similarity).toBe(1)
    expect(best).toBe('Приве́т!')
  })

  it('passes when ~90%+ of the letters match (one wrong ending)', () => {
    // 11 of 12 letters right → ≈ 0.92, above the 0.9 default.
    expect(gradeSpoken('здравствуйти', 'здравствуйте').correct).toBe(true)
  })

  it('rejects an answer with too many wrong letters', () => {
    expect(gradeSpoken('собака', 'большая кошка').correct).toBe(false)
  })

  it('keeps the most generous of several alternative guesses', () => {
    const { correct, best } = gradeSpoken(['кошка большая', 'здравствуйте'], 'здравствуйте')
    expect(correct).toBe(true)
    expect(best).toBe('здравствуйте')
  })

  it('honours a custom threshold', () => {
    expect(gradeSpoken('кот', 'кит', 0.6).correct).toBe(true) // 2/3 ≈ 0.67
    expect(gradeSpoken('кот', 'кит').correct).toBe(false) // default 0.9
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
    expect(onEnd).toHaveBeenCalledWith('', [])
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
    let endedAlts
    listen({
      lang: 'en-GB',
      onResult: (r) => results.push(r),
      onEnd: (final, alts) => {
        ended = final
        endedAlts = alts
      },
    })

    expect(instance.lang).toBe('en-GB')
    expect(instance.start).toHaveBeenCalled()

    // Simulate an interim, then a final result carrying two alternatives.
    instance.onresult({
      resultIndex: 0,
      results: [Object.assign([{ transcript: 'the cat' }], { isFinal: false, length: 1 })],
    })
    instance.onresult({
      resultIndex: 0,
      results: [
        Object.assign([{ transcript: 'the cat sleeps' }, { transcript: 'the cat creeps' }], {
          isFinal: true,
          length: 2,
        }),
      ],
    })
    instance.onend()

    expect(results[0].transcript).toBe('the cat')
    expect(results[1].final).toBe(true)
    // Best guess first, then the alternative full-phrase guess for the grader.
    expect(ended).toBe('the cat sleeps')
    expect(endedAlts).toEqual(['the cat sleeps', 'the cat creeps'])
  })
})
