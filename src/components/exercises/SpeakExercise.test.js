import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SpeakExercise from './SpeakExercise.vue'
import { setSelfCertifySpeech } from '../../stores/settings.js'
import { state as vocabState } from '../../stores/vocab.js'
import { loadFixtureWords } from '../../test/fixtures.js'

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

// A phrase drilling абзац, with the target token resolved as the builder does.
const phrase = {
  ...exercise,
  content: 'phrase',
  targets: ['абзац=paragraph'],
  ru: 'В э́том абза́це две оши́бки.',
  en: 'There are two mistakes in this paragraph.',
  targetTokens: ['абзаце'],
}

// Combining stress marks stripped so assertions don't depend on exact codepoints.
const bare = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

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
    abort() {
      this.aborted = true
    }
    // Helpers for tests.
    fireResult(transcript) {
      this.onresult?.({
        resultIndex: 0,
        results: [Object.assign([{ transcript }], { isFinal: true, length: 1 })],
      })
    }
  }
}

beforeAll(() => {
  vocabState.words = loadFixtureWords()
  vocabState.status = 'ready'
})

afterEach(() => {
  // Self-grading is sticky for the app session — reset it between tests.
  setSelfCertifySpeech(false)
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
  lastRec = null
  vi.restoreAllMocks()
})

// ── The prompt (#733) ──────────────────────────────────────────────────────
describe('SpeakExercise prompt', () => {
  it('asks for the Russian without showing it', () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise: phrase } })
    expect(wrapper.text()).toContain('There are two mistakes in this paragraph.')
    expect(bare(wrapper.text())).not.toContain('абзаце')
  })
})

// ── The help ladder (#733) ─────────────────────────────────────────────────
describe('SpeakExercise hint ladder', () => {
  it('gives the non-target words away from the start, never the target', () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise: phrase } })
    const words = wrapper.findAll('.dict-ru').map((n) => bare(n.text()))
    // Headwords, not the sentence's forms: «две» is listed as «два» and
    // «оши́бки» as «оши́бка». Inflecting them is the learner's job — and is what
    // the next rung hands over.
    expect(words).toEqual(['в', 'два', 'ошибка', 'этот'])
  })

  it('arranges them into the blanked sentence on the first hint, for free', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise: phrase } })
    expect(wrapper.find('.skeleton').exists()).toBe(false)

    await wrapper.find('button.hint-rung').trigger('click')
    const skeleton = wrapper.find('.skeleton')
    expect(bare(skeleton.text())).toContain('___')
    expect(bare(skeleton.text())).not.toContain('абзаце')
    // Free: the fire is still lit, and the result still says so.
    expect(wrapper.find('.hint-rung .face').classes()).not.toContain('out')

    await wrapper.find('button.mic').trigger('click')
    lastRec.fireResult('В э́том абза́це две оши́бки.')
    lastRec.stop()
    await wrapper.vm.$nextTick()
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, flawless: true })
  })

  it('fills the blank on the second hint, and that one costs the fire', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise: phrase } })
    await wrapper.find('button.hint-rung').trigger('click')
    await wrapper.find('button.hint-rung').trigger('click')

    expect(bare(wrapper.find('.revealed').text())).toContain('абзаце')
    // The ladder is spent: the control stays, disabled, with the fire out.
    expect(wrapper.find('button.hint-rung').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.hint-rung .face').classes()).toContain('out')

    await wrapper.find('button.mic').trigger('click')
    lastRec.fireResult('В э́том абза́це две оши́бки.')
    lastRec.stop()
    await wrapper.vm.$nextTick()
    await wrapper.find('button.next').trigger('click')
    // Still correct — but not flawless, so the word can't be fast-tracked on it.
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, flawless: false })
  })

  it('offers a single word the reveal alone — there is nothing to arrange', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    expect(wrapper.find('.dict-list').exists()).toBe(false)

    await wrapper.find('button.hint-rung').trigger('click')
    expect(wrapper.find('.revealed').text()).toContain('дом')
    expect(wrapper.find('.hint-rung .face').classes()).toContain('out')
  })
})

// ── Grading (#733): recognition can confirm, but never convict ─────────────
describe('SpeakExercise', () => {
  it('falls back to self-assessment when recognition is unavailable', async () => {
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    expect(wrapper.text()).toContain("Speech recognition isn't available")

    await wrapper.find('button.said').trigger('click')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, flawless: true })
  })

  it('listens and grades a close-enough answer as correct', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })

    await wrapper.find('button.mic').trigger('click')
    expect(wrapper.text()).toContain('Listening')

    lastRec.fireResult('дом')
    lastRec.stop() // recogniser ends → grade
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Got it')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, flawless: true })
  })

  it('never calls a mismatch wrong — it asks the learner', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    await wrapper.find('button.mic').trigger('click')

    lastRec.fireResult('кошка')
    lastRec.stop()
    await wrapper.vm.$nextTick()

    // No verdict yet: the answer is shown, and the question is put to them.
    expect(wrapper.emitted('done')).toBeFalsy()
    expect(wrapper.text()).toContain('Was what you said right?')
    expect(wrapper.findAll('button').some((b) => b.text().includes('Try again'))).toBe(true)
  })

  it('records the learner saying they got it, despite the recogniser', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    await wrapper.find('button.mic').trigger('click')
    lastRec.fireResult('кошка')
    lastRec.stop()
    await wrapper.vm.$nextTick()

    await wrapper.find('button.next').trigger('click') // "✓ I said it"
    expect(wrapper.text()).toContain('Got it')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, flawless: true })
  })

  it('records a self-certified miss as wrong', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    await wrapper.find('button.mic').trigger('click')
    lastRec.fireResult('кошка')
    lastRec.stop()
    await wrapper.vm.$nextTick()

    await wrapper.find('button.missed').trigger('click')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: false, flawless: true })
  })

  it('returns to the prompt (not a verdict) when nothing is heard', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    await wrapper.find('button.mic').trigger('click')

    lastRec.stop() // ended with no result
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('done')).toBeFalsy()
    expect(wrapper.find('button.mic').exists()).toBe(true)
  })

  it('hands grading to the learner when they say speech is not working', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    await wrapper.find('button.mic').trigger('click')
    expect(wrapper.text()).toContain('Listening')

    await wrapper.find('button.self-certify').trigger('click')
    // The mic is released and the verdict is theirs to give.
    expect(lastRec.aborted).toBe(true)
    expect(wrapper.text()).toContain("You're grading yourself")

    await wrapper.find('button.said').trigger('click')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, flawless: true })
  })

  it('records a self-graded miss as wrong, not as a free pass', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    await wrapper.find('button.self-certify').trigger('click')

    await wrapper.find('button.missed').trigger('click')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: false, flawless: true })
  })

  it('keeps self-grading for later exercises until the mic is asked back', async () => {
    installRecognition()
    const first = mount(SpeakExercise, { props: { exercise } })
    await first.find('button.self-certify').trigger('click')
    first.unmount()

    // A fresh exercise opens self-graded — no mic prompt, no listening.
    const second = mount(SpeakExercise, { props: { exercise } })
    expect(second.find('button.mic').exists()).toBe(false)
    expect(second.find('button.said').exists()).toBe(true)

    await second.find('button.self-certify').trigger('click') // "use the microphone"
    expect(second.find('button.mic').exists() || second.text().includes('Listening')).toBe(true)
  })

  it('offers no readback of an answer that is still hidden', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    await wrapper.find('button.mic').trigger('click')
    // Reading the target aloud mid-attempt would be the reveal by another route.
    expect(wrapper.findAll('button').some((b) => b.text().includes('Slow'))).toBe(false)
  })

  it('🐢 Slow while listening pauses recognition and returns to the prompt', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    await wrapper.find('button.hint-rung').trigger('click') // reveal — now audible

    await wrapper.find('button.mic').trigger('click')
    expect(wrapper.text()).toContain('Listening')

    const slowBtn = wrapper.findAll('button').find((b) => b.text().includes('Slow'))
    await slowBtn.trigger('click')

    // Recognition paused: phase is now 'prompt' with the mic button visible
    expect(wrapper.find('button.mic').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Listening')
  })

  it('try-again re-opens the mic without a verdict', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })

    await wrapper.find('button.mic').trigger('click')
    lastRec.fireResult('кошка')
    lastRec.stop()
    await wrapper.vm.$nextTick()

    const tryAgainBtn = wrapper.findAll('button').find((b) => b.text().includes('Try again'))
    await tryAgainBtn.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Listening')
    expect(wrapper.emitted('done')).toBeFalsy()
  })
})

// ── The facts panel (#586) ────────────────────────────────────────────────
describe('SpeakExercise word facts', () => {
  it('shows the word once it has been graded, right or wrong', async () => {
    installRecognition()
    const wrapper = mount(SpeakExercise, { props: { exercise } })
    expect(wrapper.findComponent({ name: 'WordFacts' }).exists()).toBe(false)

    await wrapper.find('button.mic').trigger('click')
    lastRec.fireResult('кошка')
    lastRec.stop()
    await wrapper.vm.$nextTick()
    await wrapper.find('button.missed').trigger('click') // wrong — not a reward

    const facts = wrapper.findComponent({ name: 'WordFacts' })
    expect(facts.exists()).toBe(true)
    expect(facts.props('wordKey')).toBe('дом=house')
  })
})
