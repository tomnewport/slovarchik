import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SpeakingView from './SpeakingView.vue'
import { state } from '../stores/vocab.js'
import { loadFixtureWords } from '../test/fixtures.js'

// Seed the reactive store with real vocab so the phrase bank is populated.
beforeAll(() => {
  state.words = loadFixtureWords()
  state.status = 'ready'
})

afterEach(() => {
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
  delete window.speechSynthesis
  delete window.SpeechSynthesisUtterance
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SpeakingView', () => {
  it('lists the three speaking modes', () => {
    const wrapper = mount(SpeakingView)
    expect(wrapper.text()).toContain('Echo')
    expect(wrapper.text()).toContain('Produce')
    expect(wrapper.text()).toContain('Interpret')
  })

  it('warns and disables drills when recognition is unavailable', () => {
    const wrapper = mount(SpeakingView)
    expect(wrapper.text()).toMatch(/can’t recognise speech/i)
    // Every mode card is disabled when the browser can't recognise speech.
    const cards = wrapper.findAll('button.card')
    expect(cards.length).toBe(3)
    for (const card of cards) expect(card.attributes('disabled')).toBeDefined()
  })

  it('enables and starts a drill when recognition is supported', async () => {
    // Stub a recogniser that just records its instance — start() is a no-op so
    // we stay in the prompt phase without any real audio.
    window.webkitSpeechRecognition = class {
      start() {}
      stop() {}
      abort() {}
    }
    // Hands-free off so mounting a question doesn't auto-listen.
    const wrapper = mount(SpeakingView)
    await wrapper.find('input[type="checkbox"]').setValue(false)

    const echo = wrapper.findAll('button.card')[0]
    expect(echo.attributes('disabled')).toBeUndefined()
    await echo.trigger('click')

    // We're now in a question: a phrase was picked and the mic button is shown.
    expect(wrapper.vm.current).toBeTruthy()
    expect(wrapper.text()).toContain('🎤 Speak')
  })

  it('grades a spoken answer, scores it and reveals the answer', async () => {
    window.webkitSpeechRecognition = class {
      start() {}
      stop() {}
      abort() {}
    }
    const wrapper = mount(SpeakingView)
    await wrapper.find('input[type="checkbox"]').setValue(false)
    await wrapper.findAll('button.card')[0].trigger('click') // echo (target = ru)

    // Feed the exact Russian phrase back as the recognised transcript.
    wrapper.vm.grade(wrapper.vm.current.ru)
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.phase).toBe('graded')
    expect(wrapper.vm.result.correct).toBe(true)
    expect(wrapper.vm.score.right).toBe(1)
    expect(wrapper.text()).toContain('✓ Correct!')
    // The letter-match score and a per-word breakdown are shown.
    expect(wrapper.text()).toContain('100% letters')
    const words = wrapper.findAll('.word-diff span')
    expect(words.length).toBeGreaterThan(0)
    expect(words.every((w) => w.classes('word-hit'))).toBe(true)
  })

  it('shows which words were missed when the answer is only partly right', async () => {
    window.webkitSpeechRecognition = class {
      start() {}
      stop() {}
      abort() {}
    }
    const wrapper = mount(SpeakingView)
    await wrapper.find('input[type="checkbox"]').setValue(false)
    await wrapper.findAll('button.card')[0].trigger('click') // echo (target = ru)

    // Drop the last word of the target so it registers as a miss.
    const said = wrapper.vm.current.ru.split(/\s+/).slice(0, -1).join(' ')
    wrapper.vm.grade(said)
    await wrapper.vm.$nextTick()

    const missed = wrapper.findAll('.word-diff .word-miss')
    expect(missed.length).toBeGreaterThan(0)
    expect(wrapper.vm.result.diff.score).toBeLessThan(1)
  })

  it('re-opens the mic after a silent result in hands-free mode', async () => {
    const instances = []
    window.webkitSpeechRecognition = class {
      constructor() {
        instances.push(this)
      }
      start() {}
      stop() {}
      abort() {}
    }
    vi.useFakeTimers()

    // No speechSynthesis, so the prompt's onEnd runs immediately and (hands-free
    // is on by default) opens the mic — creating the first recogniser.
    const wrapper = mount(SpeakingView)
    await wrapper.findAll('button.card')[2].trigger('click') // interpret
    expect(instances.length).toBe(1)
    expect(wrapper.vm.phase).toBe('listening')

    // A silent (empty) final result drops us back to the prompt …
    instances[0].onend()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.phase).toBe('prompt')

    // … and after a short pause the mic re-opens on its own.
    vi.advanceTimersByTime(800)
    await wrapper.vm.$nextTick()
    expect(instances.length).toBe(2)
  })

  it('marks a spoken "pass" as passed, not correct', async () => {
    window.webkitSpeechRecognition = class {
      start() {}
      stop() {}
      abort() {}
    }
    const wrapper = mount(SpeakingView)
    await wrapper.find('input[type="checkbox"]').setValue(false)
    await wrapper.findAll('button.card')[0].trigger('click')

    wrapper.vm.grade('pass')
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.result.passed).toBe(true)
    expect(wrapper.vm.result.correct).toBe(false)
    expect(wrapper.text()).toContain('Passed')
  })
})
