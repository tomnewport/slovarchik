import { describe, it, expect, beforeAll } from 'vitest'
import { mount } from '@vue/test-utils'
import VocabView from './VocabView.vue'
import { state } from '../stores/vocab.js'
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

  it('runs an easy-mode round and scores a correct match', async () => {
    const wrapper = mount(VocabView)
    // Start easy mode (first level card).
    await wrapper.findAll('button.card')[0].trigger('click')

    const cols = wrapper.findAll('.match-col')
    expect(cols).toHaveLength(2)
    const left = cols[0].findAll('button.match-item')
    const right = cols[1].findAll('button.match-item')
    expect(left.length).toBeGreaterThan(1)
    expect(right.length).toBe(left.length)

    // Pick the first Russian word, then its English partner in the other column.
    const targetId = wrapper.vm.boardLeft[0].id
    const rightIndex = wrapper.vm.boardRight.findIndex((w) => w.id === targetId)
    await left[0].trigger('click')
    await right[rightIndex].trigger('click')

    expect(wrapper.vm.score).toEqual({ right: 1, total: 1 })
    // The cleared pair is marked matched (faded out) in both columns.
    expect(left[0].classes()).toContain('matched')
    expect(right[rightIndex].classes()).toContain('matched')
  })

  it('counts a mismatched pair as a wrong attempt without clearing it', async () => {
    const wrapper = mount(VocabView)
    await wrapper.findAll('button.card')[0].trigger('click')

    const cols = wrapper.findAll('.match-col')
    const left = cols[0].findAll('button.match-item')
    const right = cols[1].findAll('button.match-item')

    // Pick a left word and a right word that belong to different pairs.
    const leftId = wrapper.vm.boardLeft[0].id
    const wrongIndex = wrapper.vm.boardRight.findIndex((w) => w.id !== leftId)
    await left[0].trigger('click')
    await right[wrongIndex].trigger('click')

    expect(wrapper.vm.score).toEqual({ right: 0, total: 1 })
    expect(left[0].classes()).not.toContain('matched')
    expect(right[wrongIndex].classes()).not.toContain('matched')
  })
})
