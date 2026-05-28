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
})
