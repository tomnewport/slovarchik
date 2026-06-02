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

  it('accepts duplicate-word tokens placed in swapped positions (easy mode)', async () => {
    const wrapper = mount(PhraseTesterView)
    await wrapper.findAll('button.card')[0].trigger('click')

    // Override with a phrase that has two identical words so we can test equivalence.
    const dupePhrase = { id: 'dupe-test', ru: 'кот сидит рядом с котом', en: 'the cat sees the cat' }
    wrapper.vm.current = dupePhrase
    wrapper.vm.bank = phraseTokens(dupePhrase.en).map((text, id) => ({ id, text }))
    // bank: [{id:0,'the'},{id:1,'cat'},{id:2,'sees'},{id:3,'the'},{id:4,'cat'}]
    await wrapper.vm.$nextTick()

    // Place tokens to form the correct phrase but using swapped IDs for the two 'the' tiles:
    // use id=3 (second 'the') for the first position, id=0 (first 'the') for the fourth.
    wrapper.vm.placeToken({ id: 3, text: 'the' })   // first slot — wrong ID, same text
    wrapper.vm.placeToken({ id: 1, text: 'cat' })
    wrapper.vm.placeToken({ id: 2, text: 'sees' })
    wrapper.vm.placeToken({ id: 0, text: 'the' })   // fourth slot — wrong ID, same text
    wrapper.vm.placeToken({ id: 4, text: 'cat' })
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.wasCorrect).toBe(true)
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
