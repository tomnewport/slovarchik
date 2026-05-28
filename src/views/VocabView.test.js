import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
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

  it('celebrates and auto-advances after a correct answer', async () => {
    vi.useFakeTimers()
    const wrapper = mount(VocabView)
    // Start advanced (typing) mode — celebration applies to the typing drills.
    await wrapper.findAll('button.card')[2].trigger('click')

    // Type the correct answer and submit.
    const want = wrapper.vm.current
    const answer = Array.isArray(want.en) ? want.en[0] : want.en
    await wrapper.find('input[type="text"]').setValue(answer)
    await wrapper.find('form').trigger('submit')

    // Celebration is showing and no manual "Next" button is offered.
    expect(wrapper.vm.wasCorrect).toBe(true)
    expect(wrapper.vm.celebrating).toBe(true)
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(true)
    expect(wrapper.text()).not.toContain('Next')

    // After the celebration window, it moves on to a fresh question.
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.answered).toBe(false)
    expect(wrapper.vm.celebrating).toBe(false)
  })

  it('waits for the user after a wrong answer', async () => {
    const wrapper = mount(VocabView)
    // Start advanced (typing) mode.
    await wrapper.findAll('button.card')[2].trigger('click')

    // Submit an answer that is definitely wrong.
    await wrapper.find('input[type="text"]').setValue('definitely-not-correct')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.vm.wasCorrect).toBe(false)
    expect(wrapper.vm.celebrating).toBe(false)
    expect(wrapper.text()).toContain('Next')
  })
})

afterEach(() => {
  vi.useRealTimers()
})
