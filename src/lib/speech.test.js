import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  speak,
  speechSupported,
  estimateSpeechMs,
  sequenceDurationMs,
  voiceAvailable,
  SLOW_RATE,
} from './speech.js'

afterEach(() => {
  delete window.speechSynthesis
  delete window.SpeechSynthesisUtterance
  vi.restoreAllMocks()
})

describe('speech', () => {
  it('reports unsupported and no-ops without the Web Speech API', () => {
    expect(speechSupported()).toBe(false)
    expect(speak('привет')).toBe(false)
  })

  it('speaks text with stress marks preserved in the requested language', () => {
    const spoken = []
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text
      }
    }
    window.speechSynthesis = {
      cancel: vi.fn(),
      speak: vi.fn((u) => spoken.push(u)),
    }

    expect(speechSupported()).toBe(true)
    const ok = speak('Приве́т, как дела́?', 'ru-RU')

    expect(ok).toBe(true)
    expect(window.speechSynthesis.cancel).toHaveBeenCalled()
    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1)
    // Stress marks (U+0301) stay so Russian voices stress the right vowel —
    // the only audible difference between heteronyms like сто́ит / стои́т.
    expect(spoken[0].text).toBe('Приве́т, как дела́?')
    expect(spoken[0].lang).toBe('ru-RU')
  })

  it('passes a heteronym stress mark through unchanged', () => {
    const spoken = []
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text
      }
    }
    window.speechSynthesis = { cancel: vi.fn(), speak: vi.fn((u) => spoken.push(u)) }

    speak('сто́ит')
    // The stress is the only thing telling сто́ит (costs) from стои́т (stands).
    expect(spoken[0].text).toBe('сто́ит')
  })

  it('does not speak empty text', () => {
    window.SpeechSynthesisUtterance = class {}
    window.speechSynthesis = { cancel: vi.fn(), speak: vi.fn() }
    expect(speak('   ')).toBe(false)
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled()
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

  it('stretches the estimate for a slower playback rate', () => {
    // A half-speed read takes about twice as long: a watchdog that ignored the
    // rate would open the mic while the phone was still talking.
    expect(estimateSpeechMs('x'.repeat(50), SLOW_RATE)).toBe((50 * 90 + 1200) * 2)
    expect(estimateSpeechMs('x'.repeat(50), 1)).toBe(50 * 90 + 1200)
  })

  it('treats a zero or missing rate as normal speed', () => {
    expect(estimateSpeechMs('x'.repeat(50), 0)).toBe(50 * 90 + 1200)
    expect(estimateSpeechMs('x'.repeat(50), undefined)).toBe(50 * 90 + 1200)
  })
})

describe('sequenceDurationMs', () => {
  it('sums the estimates of each part', () => {
    const seq = [{ text: 'a' }, { text: 'b' }]
    expect(sequenceDurationMs(seq)).toBe(estimateSpeechMs('a') + estimateSpeechMs('b'))
  })

  it('scales each part by its own rate', () => {
    const seq = [{ text: 'a', rate: 1 }, { text: 'b', rate: SLOW_RATE }]
    expect(sequenceDurationMs(seq)).toBe(estimateSpeechMs('a') + estimateSpeechMs('b') * 2)
  })

  it('is zero for an empty or missing sequence', () => {
    expect(sequenceDurationMs([])).toBe(0)
    expect(sequenceDurationMs(undefined)).toBe(0)
  })
})

describe('voiceAvailable', () => {
  const withVoices = (voices) => {
    window.SpeechSynthesisUtterance = class {}
    window.speechSynthesis = { getVoices: () => voices, cancel: vi.fn(), speak: vi.fn() }
  }

  it('is false without the Web Speech API at all', () => {
    expect(voiceAvailable('ru-RU')).toBe(false)
  })

  it('finds an exact match, and a looser one on the base language', () => {
    withVoices([{ lang: 'en-US' }, { lang: 'ru-RU' }])
    expect(voiceAvailable('ru-RU')).toBe(true)
    withVoices([{ lang: 'ru' }])
    expect(voiceAvailable('ru-RU')).toBe(true)
  })

  it('is false when only other languages are installed', () => {
    withVoices([{ lang: 'en-US' }, { lang: 'de-DE' }])
    expect(voiceAvailable('ru-RU')).toBe(false)
  })

  it('is false while the voice list is still empty — asked too early, not answered "none"', () => {
    withVoices([])
    expect(voiceAvailable('ru-RU')).toBe(false)
  })

  it('defaults to Russian', () => {
    withVoices([{ lang: 'ru-RU' }])
    expect(voiceAvailable()).toBe(true)
  })
})
