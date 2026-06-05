import { describe, it, expect, afterEach, vi } from 'vitest'

import {
  SUCCESS_SOUNDS,
  NEUTRAL_SOUNDS,
  audioSupported,
  playNotes,
  playSound,
  soundById,
  _resetForTests,
} from './feedbackSound.js'

afterEach(() => {
  delete window.AudioContext
  delete window.webkitAudioContext
  _resetForTests()
  vi.restoreAllMocks()
})

describe('feedbackSound presets', () => {
  it('offers exactly five distinct success and five distinct neutral sounds', () => {
    expect(SUCCESS_SOUNDS).toHaveLength(5)
    expect(NEUTRAL_SOUNDS).toHaveLength(5)
    const ids = [...SUCCESS_SOUNDS, ...NEUTRAL_SOUNDS].map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every preset has a label and at least one note', () => {
    for (const s of [...SUCCESS_SOUNDS, ...NEUTRAL_SOUNDS]) {
      expect(typeof s.label).toBe('string')
      expect(s.notes.length).toBeGreaterThan(0)
      for (const n of s.notes) expect(typeof n.freq).toBe('number')
    }
  })

  it('looks sounds up by kind and id', () => {
    expect(soundById('success', SUCCESS_SOUNDS[0].id)).toBe(SUCCESS_SOUNDS[0])
    expect(soundById('error', NEUTRAL_SOUNDS[0].id)).toBe(NEUTRAL_SOUNDS[0])
    expect(soundById('success', 'nope')).toBeNull()
  })
})

describe('feedbackSound playback', () => {
  it('reports unsupported and no-ops without the Web Audio API', () => {
    expect(audioSupported()).toBe(false)
    expect(playNotes([{ freq: 440 }])).toBe(false)
    expect(playSound('success', SUCCESS_SOUNDS[0].id)).toBe(false)
  })

  it('schedules one oscillator per note when audio is available', () => {
    const started = []
    function fakeNode() {
      return {
        type: '',
        frequency: { value: 0 },
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(function () {
          return this
        }),
        start: vi.fn((t) => started.push(t)),
        stop: vi.fn(),
      }
    }
    window.AudioContext = class {
      constructor() {
        this.state = 'running'
        this.currentTime = 0
        this.destination = {}
      }
      createOscillator() {
        return fakeNode()
      }
      createGain() {
        return fakeNode()
      }
    }

    expect(audioSupported()).toBe(true)
    const sound = SUCCESS_SOUNDS.find((s) => s.id === 'sparkle')
    expect(playSound('success', sound.id)).toBe(true)
    // Sparkle is four notes → four oscillators started.
    expect(started).toHaveLength(sound.notes.length)
  })

  it('resumes a suspended context before playing', () => {
    const resume = vi.fn()
    window.AudioContext = class {
      constructor() {
        this.state = 'suspended'
        this.currentTime = 0
        this.destination = {}
        this.resume = resume
      }
      createOscillator() {
        return {
          type: '',
          frequency: { value: 0 },
          connect() {
            return this
          },
          start() {},
          stop() {},
        }
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {
            return this
          },
        }
      }
    }

    expect(playNotes([{ freq: 440, dur: 0.1 }])).toBe(true)
    expect(resume).toHaveBeenCalled()
  })

  it('returns false for an unknown sound id without touching audio', () => {
    window.AudioContext = class {
      createOscillator() {
        throw new Error('should not be called')
      }
      createGain() {
        throw new Error('should not be called')
      }
    }
    expect(playSound('success', 'does-not-exist')).toBe(false)
  })
})
