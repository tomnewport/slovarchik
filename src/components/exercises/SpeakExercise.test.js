import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SpeakExercise from './SpeakExercise.vue'

const exercise = {
  id: 'ex0',
  kind: 'speak',
  dimension: 'speaking',
  level: 'learning',
  content: 'word',
  targets: ['дом=house'],
  ru: 'дом',
  en: 'house',
}

// A controllable SpeechRecognition stub: the test fires onresult/onend by hand.
let lastRec = null
function installRecognition() {
  window.webkitSpeechRecognition = class {
    constructor() {
      lastRec = this
      this.maxAlternatives = 1
    }
    start() {
      this.onstart?.()
    }
    stop() {
      this.onend?.()
    }
    abort() {}
    // Helpers for tests.
    fireResult(transcript) {
      this.onresult?.({
        resultIndex: 0,
        results: [Object.assign([{ transcript }], { isFinal: true, length: 1 })],
      })
    }
  }
}

afterEach(() => {
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
  lastRec = null
  vi.restoreAllMocks()
})

describe('SpeakExercise', () => {
  it('falls back to self-assessment when recognition is unavailable', async () => {
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    expect(wrapper.text()).toContain("Speech recognition isn't available")

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true })
  })

  it('listens and grades a close-enough answer as correct', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })

    // No TTS in jsdom, so it stays on the prompt with a Speak button.
    await wrapper.find('button.mic').trigger('click')
    expect(wrapper.text()).toContain('Listening')

    lastRec.fireResult('дом')
    lastRec.stop() // recogniser ends → grade
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Got it')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true })
  })

  it('marks a wrong utterance incorrect and offers another go', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    await wrapper.find('button.mic').trigger('click')

    lastRec.fireResult('кошка')
    lastRec.stop()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Not quite')
    // A retry button is offered; "Next" reports the (incorrect) result.
    expect(wrapper.findAll('button').some((b) => b.text().includes('Try again'))).toBe(true)
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: false })
  })

  it('returns to the prompt (not wrong) when nothing is heard', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    await wrapper.find('button.mic').trigger('click')

    lastRec.stop() // ended with no result
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('done')).toBeFalsy()
    expect(wrapper.find('button.mic').exists()).toBe(true)
  })

  it('🐢 Slow while listening pauses recognition and returns to the prompt', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })

    await wrapper.find('button.mic').trigger('click')
    expect(wrapper.text()).toContain('Listening')

    const slowBtn = wrapper.findAll('button').find((b) => b.text().includes('Slow'))
    await slowBtn.trigger('click')

    // Recognition paused: phase is now 'prompt' with the mic button visible
    expect(wrapper.find('button.mic').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Listening')
  })

  it('try-again clears the wrong result and re-opens the mic after slow readback', async () => {
    vi.useFakeTimers()
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })

    await wrapper.find('button.mic').trigger('click')
    lastRec.fireResult('кошка')
    lastRec.stop()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Not quite')

    const tryAgainBtn = wrapper.findAll('button').find((b) => b.text().includes('Try again'))
    await tryAgainBtn.trigger('click')
    await wrapper.vm.$nextTick()

    // Result cleared immediately; waiting for slow readback watchdog
    expect(wrapper.text()).not.toContain('Not quite')
    expect(wrapper.find('button.mic').exists()).toBe(true)

    // Slow readback watchdog fires → beginListen() reopens the mic
    vi.advanceTimersByTime(6000)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Listening')

    vi.useRealTimers()
  })
})
