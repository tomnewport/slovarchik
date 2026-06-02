import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PhraseTesterView from './PhraseTesterView.vue'
import { state } from '../stores/vocab.js'
import { phraseTokens } from '../lib/phrases.js'
import { loadFixtureWords } from '../test/fixtures.js'

// Seed the reactive store with real vocab so the phrase bank is populated.
beforeAll(() => {
  state.words = loadFixtureWords()
  state.status = 'ready'
})

describe('PhraseTesterView', () => {
  it('shows the three difficulty options on the menu', () => {
    const wrapper = mount(PhraseTesterView)
    expect(wrapper.text()).toContain('Easy')
    expect(wrapper.text()).toContain('Intermediate')
    expect(wrapper.text()).toContain('Hard')
  })

  it('builds a sentence from tiles and scores it correct', async () => {
    const wrapper = mount(PhraseTesterView)
    // Start easy mode (first level card).
    await wrapper.findAll('button.card')[0].trigger('click')

    // Place the shuffled tiles back into their original (correct) order.
    const correctOrder = wrapper.vm.targetOf(wrapper.vm.current).trim().split(/\s+/)
    for (const word of correctOrder) {
      // Pick an *unplaced* pool tile (placed tiles keep the same text in the
      // answer line) so duplicate-word phrases resolve unambiguously.
      const tile = wrapper
        .findAll('button.tile')
        .find((b) => b.text() === word && !b.classes().includes('placed') && !b.element.disabled)
      await tile.trigger('click')
    }

    expect(wrapper.vm.score).toEqual({ right: 1, total: 1 })
    expect(wrapper.text()).toContain('Correct')
  })

  it('celebrates and auto-advances after a correct build', async () => {
    vi.useFakeTimers()
    const wrapper = mount(PhraseTesterView)
    await wrapper.findAll('button.card')[0].trigger('click')

    const correctOrder = wrapper.vm.targetOf(wrapper.vm.current).trim().split(/\s+/)
    for (const word of correctOrder) {
      const tile = wrapper
        .findAll('button.tile')
        .find((b) => b.text() === word && !b.classes().includes('placed') && !b.element.disabled)
      await tile.trigger('click')
    }

    expect(wrapper.vm.celebrating).toBe(true)
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(true)

    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.answered).toBe(false)
    expect(wrapper.vm.celebrating).toBe(false)
  })

  it('accepts duplicate-word tiles built through the real bank in any order (easy mode)', async () => {
    // Swap the store down to a single phrase that repeats a word, so starting the
    // drill is guaranteed to land on it and the bank is built by the real path
    // (nextQuestion → phraseTokens → shuffle), giving each occurrence its own tile.
    const saved = state.words
    state.words = [{ key: 'dupe', usage: [{ ru: 'кот видит кота', en_gb: 'the cat sees the cat' }] }]
    try {
      const wrapper = mount(PhraseTesterView)
      await wrapper.findAll('button.card')[0].trigger('click') // easy mode builds the bank
      expect(wrapper.vm.current.en).toBe('the cat sees the cat')

      // Tap pool tiles by text in the correct order. For the repeated words, take
      // the *last* matching tile each time, so the physical tiles fill positions
      // in a different order than they sit in the bank — the grade must come from
      // tile text alone, not which tile (id) lands where.
      for (const word of phraseTokens(wrapper.vm.current.en)) {
        const tiles = wrapper
          .findAll('button.tile')
          .filter((b) => b.text() === word && !b.classes().includes('placed') && !b.element.disabled)
        await tiles[tiles.length - 1].trigger('click')
      }
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.wasCorrect).toBe(true)
    } finally {
      state.words = saved
    }
  })

  it('grades a guided-keyboard answer that omits punctuation and stress', async () => {
    const wrapper = mount(PhraseTesterView)
    // Start intermediate mode (second level card).
    await wrapper.findAll('button.card')[1].trigger('click')

    // Type the bare letter/space sequence — phraseCorrect forgives the rest.
    const { typingSequence } = await import('../lib/phrases.js')
    wrapper.vm.typed = typingSequence(wrapper.vm.targetOf(wrapper.vm.current))
    wrapper.vm.submitTyped()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.wasCorrect).toBe(true)
    expect(wrapper.vm.score.right).toBe(1)
  })
})

afterEach(() => {
  vi.useRealTimers()
})
