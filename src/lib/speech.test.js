import { describe, it, expect, afterEach, vi } from 'vitest'
import { speak, speechSupported } from './speech.js'

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

  it('speaks stress-stripped text in the requested language', () => {
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
    expect(spoken[0].text).toBe('Привет, как дела?')
    expect(spoken[0].lang).toBe('ru-RU')
  })

  it('does not speak empty text', () => {
    window.SpeechSynthesisUtterance = class {}
    window.speechSynthesis = { cancel: vi.fn(), speak: vi.fn() }
    expect(speak('   ')).toBe(false)
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled()
  })
})
