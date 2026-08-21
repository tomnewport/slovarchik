import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import ListeningView from './ListeningView.vue'
import { state } from '../stores/vocab.js'
import { buildListeningBank, listeningTokens } from '../lib/phrases.js'
import { shapePhrases } from '../lib/vocabBuild.js'
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

  it('accepts duplicate-word tiles built through the real bank in any order', async () => {
    // Swap the store down to a single phrase that repeats a word, so starting the
    // drill is guaranteed to land on it and buildListeningBank produces a separate
    // tile per occurrence. (With only this phrase in the store there are no decoy
    // candidates left after excluding the phrase's own words, so the bank is just
    // the five real tiles: two 'the', two 'cat', one 'sees'.)
    const saved = state.words
    state.words = [{ key: 'dupe', usage: [{ ru: 'кот видит кота', en_gb: 'the cat sees the cat' }] }]
    try {
      const wrapper = mount(ListeningView)
      await startDrill(wrapper)
      expect(wrapper.vm.current.en).toBe('the cat sees the cat')

      // Tap pool tiles by text in the correct order. For the repeated words, take
      // the *last* matching tile each time, so the tiles fill positions in a
      // different order than they sit in the bank — the grade must come from tile
      // text alone, not which tile (id) lands where.
      for (const word of listeningTokens(wrapper.vm.current.en)) {
        const tiles = wrapper
          .findAll('.bank button.tile')
          .filter((b) => b.text() === word && !b.element.disabled)
        await tiles[tiles.length - 1].trigger('click')
      }
      await wrapper.find('button.check').trigger('click')

      expect(wrapper.vm.wasCorrect).toBe(true)
    } finally {
      state.words = saved
    }
  })

  it('supplies tiles for a curated alternate and accepts it (#581)', async () => {
    const wrapper = mount(ListeningView)
    await startDrill(wrapper)

    // An alternate that needs a word the primary does not have: until #581 the
    // bank came from the primary alone while check() accepted `enAlt`, so the
    // answer was graded correct but could never be assembled.
    const phrases = shapePhrases(loadFixtureWords())
    const phrase = phrases.find((p) =>
      (p.enAlt ?? []).some((a) => listeningTokens(a).some((w) => !listeningTokens(p.en).includes(w))),
    )
    const alt = phrase.enAlt.find((a) =>
      listeningTokens(a).some((w) => !listeningTokens(phrase.en).includes(w)),
    )
    wrapper.vm.current = phrase
    wrapper.vm.bank = buildListeningBank(phrase.en, [], 0, () => 0.5, { alts: phrase.enAlt })
    await nextTick()

    for (const word of listeningTokens(alt)) {
      const tile = wrapper
        .findAll('.bank button.tile')
        .find((b) => b.text() === word && !b.element.disabled)
      expect(tile, `no tile for "${word}"`).toBeTruthy()
      await tile.trigger('click')
    }
    await wrapper.find('button.check').trigger('click')

    expect(wrapper.vm.wasCorrect).toBe(true)
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
