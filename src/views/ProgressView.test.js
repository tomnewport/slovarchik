import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import { state as progress } from '../stores/progress.js'
import { state as vocabState } from '../stores/vocab.js'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const { default: ProgressView } = await import('./ProgressView.vue')

function masteredRecord(word, ts) {
  const events = []
  for (const d of ['identification', 'usage', 'hearing']) {
    for (let i = 0; i < 3; i++) events.push({ dimension: d, level: 'learning', correct: true, ts })
  }
  for (let i = 0; i < 3; i++) events.push({ dimension: 'speaking', level: 'learning', correct: true, ts })
  return { word, events, learnedAt: ts, masteredAt: ts, peak: 3 }
}
function learningRecord(word) {
  return { word, events: [{ dimension: 'usage', level: 'learning', correct: true, ts: 1 }], learnedAt: null, masteredAt: null, peak: 1 }
}

beforeEach(() => {
  progress.records = {}
  vocabState.words = []
  push.mockClear()
})

describe('ProgressView', () => {
  it('renders the words-known chart and an expandable learned list', async () => {
    vocabState.words = [{ key: 'дом=house', pos: 'noun', gender: 'm', hasInflections: false }]
    progress.records = { 'дом=house': masteredRecord('дом=house', Date.parse('2026-06-01T10:00:00Z')) }

    const wrapper = mount(ProgressView)
    expect(wrapper.find('.line-learned').exists()).toBe(true)

    await wrapper.findAll('.toggle')[0].trigger('click') // Show learned
    expect(wrapper.find('.words').text()).toContain('дом=house')
    // A single history day draws a dot (a lone line has nothing to stroke).
    expect(wrapper.find('.dot-learned').exists()).toBe(true)
  })

  it('lists weakest skills and launches a focused session on tap', async () => {
    const nouns = ['n0', 'n1', 'n2'].map((key) => ({ key, pos: 'noun', gender: 'm', hasInflections: false }))
    vocabState.words = nouns
    progress.records = Object.fromEntries(nouns.map((n) => [n.key, learningRecord(n.key)]))

    const wrapper = mount(ProgressView)
    const chips = wrapper.findAll('.chip')
    expect(chips.length).toBeGreaterThan(0)

    await chips[0].trigger('click')
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/session', query: expect.objectContaining({ type: 'standard' }) }),
    )
    expect(typeof push.mock.calls[0][0].query.focus).toBe('string')
  })
})
