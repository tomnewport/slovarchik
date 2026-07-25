import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

// Speech + feedback are side effects; SpeakButton needs speechSupported/SLOW_RATE.
vi.mock('../../lib/speech.js', () => ({
  speak: vi.fn(),
  speechSupported: () => true,
  SLOW_RATE: 0.7,
}))
vi.mock('../../stores/settings.js', () => ({ playFeedback: vi.fn() }))

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

  it('does not render any clickable answer options', () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    expect(wrapper.findAll('.option').length).toBe(0)
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('advances to the next card once the English is typed correctly', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('spring')
    // Second card is now shown, first was answered cleanly (chime played).
    expect(wrapper.find('.ru').text()).toBe('ме́сяц')
    expect(wrapper.find('.count').text()).toContain('Card 2 of 2')
    expect(playFeedback).toHaveBeenCalledWith(true)
  })

  it('reveals the correct answer when a wrong guess is submitted', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('summer')
    await wrapper.find('form').trigger('submit')
    // Still on card 1, but the answer is now revealed for the learner to read.
    expect(wrapper.find('.ru').text()).toBe('весна')
    expect(wrapper.find('.reveal').exists()).toBe(true)
    expect(wrapper.find('.reveal-en').text()).toBe('spring')
    expect(playFeedback).toHaveBeenLastCalledWith(false)
  })

  it('moves on from the revealed answer when Enter is pressed again', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('summer')
    await wrapper.find('form').trigger('submit') // reveal card 1
    await wrapper.find('form').trigger('submit') // continue
    expect(wrapper.find('.reveal').exists()).toBe(false)
    expect(wrapper.find('.ru').text()).toBe('ме́сяц')
  })

  it('a card guessed wrong is reported wrong even after moving on', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('summer') // wrong on card 1
    await wrapper.find('form').trigger('submit') // reveal
    await wrapper.find('.next').trigger('click') // continue to card 2
    await wrapper.find('.combo-input').setValue('month') // card 2 clean
    const payload = wrapper.emitted('done')[0][0]
    expect(payload.correct).toBe(false)
    expect(payload.wrong).toEqual(['a'])
  })

  it('Pass reveals the answer and reports the passed key as wrong', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('spring') // card 1 correct
    await wrapper.find('.pass').trigger('click') // card 2 passed
    expect(wrapper.find('.reveal-en').text()).toBe('month')
    await wrapper.find('.next').trigger('click') // finish
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

  it('a wrong spoken answer reveals the correct answer', async () => {
    listenImpl = (opts) => {
      opts.onEnd('winter', [])
      return { stop() {}, abort() {} }
    }
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.speak-toggle').trigger('click')
    expect(wrapper.find('.reveal-en').text()).toBe('spring')
  })
})
