import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VocabView from './VocabView.vue'
import { state } from '../stores/vocab.js'
import { keyboardHint } from '../stores/keyboard.js'
import { hintLetters } from '../lib/quiz.js'
import { loadFixtureWords } from '../test/fixtures.js'

// Seed the reactive store with real vocab data so the menu is ready.
beforeAll(() => {
  state.words = loadFixtureWords()
  state.status = 'ready'
})

describe('VocabView', () => {
  it('shows the three difficulty options on the menu', () => {
    const wrapper = mount(VocabView)
    expect(wrapper.text()).toContain('Easy')
    expect(wrapper.text()).toContain('Intermediate')
    expect(wrapper.text()).toContain('Advanced')
  })

  it('runs an easy-mode round and scores a correct pick', async () => {
    const wrapper = mount(VocabView)
    // Start easy mode (first level card).
    await wrapper.findAll('button.card')[0].trigger('click')

    const choices = wrapper.findAll('button.choice')
    expect(choices).toHaveLength(4)

    // Click the option matching the current correct answer.
    const correctId = wrapper.vm.current.id
    const correctIndex = wrapper.vm.choices.findIndex((c) => c.id === correctId)
    await choices[correctIndex].trigger('click')

    expect(wrapper.vm.score).toEqual({ right: 1, total: 1 })
    expect(wrapper.text()).toContain('Correct')
  })

  it('celebrates and auto-advances after a correct answer', async () => {
    vi.useFakeTimers()
    const wrapper = mount(VocabView)
    await wrapper.findAll('button.card')[0].trigger('click')

    const correctId = wrapper.vm.current.id
    const choices = wrapper.findAll('button.choice')
    const correctIndex = wrapper.vm.choices.findIndex((c) => c.id === correctId)
    await choices[correctIndex].trigger('click')

    // Celebration is showing and no manual "Next" button is offered.
    expect(wrapper.vm.celebrating).toBe(true)
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(true)
    expect(wrapper.text()).not.toContain('Next')

    // After the celebration window, it moves on to a fresh question.
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.answered).toBe(false)
    expect(wrapper.vm.celebrating).toBe(false)
  })

  it('highlights the Russian answer letters on the keyboard in intermediate EN → RU', async () => {
    const wrapper = mount(VocabView)
    // Switch to EN → RU so the answer is Russian (the on-screen keyboard case).
    await wrapper.find('button:nth-of-type(2)').trigger('click')
    // Start intermediate mode (second level card).
    await wrapper.findAll('button.card')[1].trigger('click')

    const expected = hintLetters(wrapper.vm.current.ru)
    expect(keyboardHint.letters).toEqual(expected)
    expect(keyboardHint.letters.size).toBeGreaterThan(0)

    // Leaving the drill (Change mode) clears the hint.
    const back = wrapper.findAll('button').find((b) => b.text() === 'Change mode')
    await back.trigger('click')
    expect(keyboardHint.letters.size).toBe(0)
  })

  it('leaves the keyboard hint empty in intermediate RU → EN (English answer)', async () => {
    const wrapper = mount(VocabView)
    // Default direction is RU → EN; start intermediate mode.
    await wrapper.findAll('button.card')[1].trigger('click')
    expect(keyboardHint.letters.size).toBe(0)
  })

  it('waits for the user after a wrong answer', async () => {
    const wrapper = mount(VocabView)
    await wrapper.findAll('button.card')[0].trigger('click')

    const correctId = wrapper.vm.current.id
    const choices = wrapper.findAll('button.choice')
    const wrongIndex = wrapper.vm.choices.findIndex((c) => c.id !== correctId)
    await choices[wrongIndex].trigger('click')

    expect(wrapper.vm.celebrating).toBe(false)
    expect(wrapper.text()).toContain('Next')
  })
})

afterEach(() => {
  vi.useRealTimers()
})
