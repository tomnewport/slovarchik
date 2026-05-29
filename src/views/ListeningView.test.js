import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ListeningView from './ListeningView.vue'
import { state } from '../stores/vocab.js'
import { listeningTokens } from '../lib/phrases.js'
import { loadFixtureWords } from '../test/fixtures.js'

// Seed the reactive store with real vocab so the phrase bank is populated.
beforeAll(() => {
  state.words = loadFixtureWords()
  state.status = 'ready'
})

async function startDrill(wrapper) {
  await wrapper.find('button.start').trigger('click')
}

describe('ListeningView', () => {
  it('shows a start screen until the drill begins', () => {
    const wrapper = mount(ListeningView)
    expect(wrapper.find('button.start').exists()).toBe(true)
    expect(wrapper.findAll('.bank button.tile')).toHaveLength(0)
  })

  it('builds a word bank with the target words plus a few decoys', async () => {
    const wrapper = mount(ListeningView)
    await startDrill(wrapper)

    const targetWords = listeningTokens(wrapper.vm.current.en)
    expect(targetWords.length).toBeGreaterThan(0)

    // Every target word is somewhere in the bank …
    const bankWords = wrapper.vm.bank.map((t) => t.text)
    for (const word of targetWords) expect(bankWords).toContain(word)

    // … and the bank is padded out with decoy tiles.
    const decoys = wrapper.vm.bank.filter((t) => t.decoy)
    expect(decoys.length).toBeGreaterThan(0)
    // No decoy duplicates a real word of the phrase.
    for (const d of decoys) expect(targetWords).not.toContain(d.text)
  })

  it('accepts the words tapped in the correct order', async () => {
    const wrapper = mount(ListeningView)
    await startDrill(wrapper)

    for (const word of listeningTokens(wrapper.vm.current.en)) {
      const tile = wrapper
        .findAll('.bank button.tile')
        .find((b) => b.text() === word && !b.element.disabled)
      await tile.trigger('click')
    }
    await wrapper.find('button.check').trigger('click')

    expect(wrapper.vm.wasCorrect).toBe(true)
    expect(wrapper.vm.score.right).toBe(1)
    expect(wrapper.text()).toContain('Correct')
  })

  it('marks a wrong order incorrect and reveals the answer', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ListeningView)
    await startDrill(wrapper)

    // Place a single (likely wrong) tile and check.
    const first = wrapper.findAll('.bank button.tile')[0]
    await first.trigger('click')
    // Only force a wrong answer when the phrase has more than one word.
    if (listeningTokens(wrapper.vm.current.en).length > 1) {
      await wrapper.find('button.check').trigger('click')
      expect(wrapper.vm.wasCorrect).toBe(false)
      expect(wrapper.vm.celebrating).toBe(false)
      expect(wrapper.text()).toContain('Answer:')
    }
    vi.useRealTimers()
  })
})

afterEach(() => {
  vi.useRealTimers()
})
