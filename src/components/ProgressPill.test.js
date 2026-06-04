import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

import { state as progress } from '../stores/progress.js'
import { state as vocabState } from '../stores/vocab.js'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const { default: ProgressPill } = await import('./ProgressPill.vue')

// A record whose events satisfy every learning criterion (→ mastered for an
// uninflected word).
function learnedRecord(word) {
  const events = []
  for (const d of ['identification', 'usage', 'hearing']) {
    for (let i = 0; i < 3; i++) events.push({ dimension: d, level: 'learning', correct: true, ts: 1 })
  }
  for (let i = 0; i < 3; i++) events.push({ dimension: 'speaking', level: 'learning', correct: true, ts: 1 })
  return { word, events, learnedAt: 1, masteredAt: 1, peak: 3 }
}

beforeEach(() => {
  progress.records = {}
  vocabState.words = [{ key: 'w0', hasInflections: false }]
  push.mockClear()
})

describe('ProgressPill', () => {
  it('shows the live learned and mastered counts', () => {
    const wrapper = mount(ProgressPill)
    expect(wrapper.find('.learn').text()).toBe('0')
    expect(wrapper.find('.master').text()).toBe('0')
  })

  it('navigates to the progress screen when clicked', async () => {
    const wrapper = mount(ProgressPill)
    await wrapper.find('.pill-btn').trigger('click')
    expect(push).toHaveBeenCalledWith('/progress')
  })

  it('whooshes a heart and pulses when a count increases', async () => {
    const wrapper = mount(ProgressPill)
    expect(wrapper.find('.particle.heart').exists()).toBe(false)

    progress.records = { w0: learnedRecord('w0') }
    await flushPromises()

    expect(wrapper.find('.learn').text()).toBe('1')
    expect(wrapper.find('.particle.heart').exists()).toBe(true)
    expect(wrapper.find('.pill-btn').classes()).toContain('pulse')
  })

  it('releases a ghost when a count decreases', async () => {
    progress.records = { w0: learnedRecord('w0') }
    const wrapper = mount(ProgressPill)
    await flushPromises()

    progress.records = {} // the word slips away entirely
    await flushPromises()

    expect(wrapper.find('.particle.ghost').exists()).toBe(true)
  })
})
