import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

// Speech + feedback are side effects; SpeakButton needs speechSupported/SLOW_RATE.
vi.mock('../../lib/speech.js', () => ({
  speak: vi.fn(),
  speechSupported: () => true,
  SLOW_RATE: 0.7,
}))
vi.mock('../../stores/settings.js', () => ({ playFeedback: vi.fn() }))

// A small decoy vocabulary so the combo box has words to offer in tests.
vi.mock('../../stores/vocab.js', () => ({
  vocab: {
    value: [
      { en: 'autumn' },
      { en: 'summer' },
      { en: 'winter' },
      { en: 'week' },
      { en: 'year' },
    ],
  },
}))

// Recognition is controllable per test: `listenImpl` decides what the mic does.
let listenImpl = () => ({ stop() {}, abort() {} })
vi.mock('../../lib/recognition.js', () => ({
  recognitionSupported: () => true,
  gradeSpoken: (guesses, target) => ({
    correct: guesses.some((g) => String(g).toLowerCase() === String(target).toLowerCase()),
    similarity: 1,
    best: guesses[0] ?? '',
  }),
  listen: (opts) => listenImpl(opts),
}))

import { speak } from '../../lib/speech.js'
import { playFeedback } from '../../stores/settings.js'
import FlashcardExercise from './FlashcardExercise.vue'

const exercise = {
  id: 'f0',
  kind: 'match',
  dimension: 'identification',
  level: 'learning',
  audio: false,
  pairs: [
    { key: 'a', ru: 'весна', en: 'spring' },
    { key: 'b', ru: 'ме́сяц', en: 'month' },
  ],
  targets: ['a', 'b'],
}

const options = (wrapper) => wrapper.findAll('.option')
const optionByText = (wrapper, text) => options(wrapper).find((b) => b.text() === text)

beforeEach(() => {
  vi.clearAllMocks()
  listenImpl = () => ({ stop() {}, abort() {} })
})

describe('FlashcardExercise', () => {
  it('shows the Russian word and a card counter in visual mode', () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    expect(wrapper.find('.ru').text()).toBe('весна')
    expect(wrapper.find('.count').text()).toContain('Card 1 of 2')
  })

  it('offers the answer among the combo-box candidates', () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    expect(optionByText(wrapper, 'spring')).toBeTruthy()
  })

  it('advances to the next card once the English is typed correctly', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('spring')
    // Second card is now shown, first was answered cleanly (chime played).
    expect(wrapper.find('.ru').text()).toBe('ме́сяц')
    expect(wrapper.find('.count').text()).toContain('Card 2 of 2')
    expect(playFeedback).toHaveBeenCalledWith(true)
  })

  it('selecting the correct candidate advances the card', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await optionByText(wrapper, 'spring').trigger('click')
    expect(wrapper.find('.ru').text()).toBe('ме́сяц')
  })

  it('a wrong candidate flags the card but leaves it open', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    // "summer" is a decoy, not the answer for card 1.
    await optionByText(wrapper, 'summer').trigger('click')
    // Still on card 1, with a "keep trying" nudge.
    expect(wrapper.find('.ru').text()).toBe('весна')
    expect(wrapper.find('.miss').exists()).toBe(true)
    expect(playFeedback).toHaveBeenLastCalledWith(false)
  })

  it('a card reached after a wrong guess is still reported wrong', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await optionByText(wrapper, 'summer').trigger('click') // wrong on card 1
    await wrapper.find('.combo-input').setValue('spring') // then found it
    await wrapper.find('.combo-input').setValue('month') // card 2 clean
    const payload = wrapper.emitted('done')[0][0]
    expect(payload.correct).toBe(false)
    expect(payload.wrong).toEqual(['a'])
  })

  it('Pass fails the card and moves on; done reports the passed key', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('spring') // card 1 correct
    await wrapper.find('.pass').trigger('click') // card 2 passed
    const payload = wrapper.emitted('done')[0][0]
    expect(payload.correct).toBe(false)
    expect(payload.wrong).toEqual(['b'])
  })

  it('emits an all-correct result when every card is answered', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('spring')
    await wrapper.find('.combo-input').setValue('month')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, wrong: [] })
  })

  it('audio mode hides the Russian text and reads it aloud on appearance', () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: { ...exercise, audio: true } } })
    expect(wrapper.find('.ru').exists()).toBe(false)
    expect(wrapper.find('.big-speak').exists()).toBe(true)
    expect(speak).toHaveBeenCalledWith('весна')
  })

  it('lets the learner answer by speaking instead of typing', async () => {
    listenImpl = (opts) => {
      opts.onEnd('spring', [])
      return { stop() {}, abort() {} }
    }
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.speak-toggle').trigger('click')
    // The spoken "spring" was accepted and the card advanced.
    expect(wrapper.find('.ru').text()).toBe('ме́сяц')
  })

  it('narrows the candidate list as the answer is typed', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    const before = options(wrapper).length
    await wrapper.find('.combo-input').setValue('spr')
    const after = options(wrapper).length
    expect(after).toBeLessThan(before)
    // The answer is still reachable in the narrowed list.
    expect(optionByText(wrapper, 'spring')).toBeTruthy()
  })
})
