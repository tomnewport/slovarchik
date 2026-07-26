import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import InflectionView from './InflectionView.vue'
import DragTable from '../components/inflection/DragTable.vue'
import { state as vocabState } from '../stores/vocab.js'
import { loadFixtureWords } from '../test/fixtures.js'

vi.mock('../lib/speech.js', () => ({ speak: vi.fn(), speechSupported: () => false }))

beforeEach(() => {
  vi.useFakeTimers()
  vocabState.words = loadFixtureWords()
  vocabState.status = 'ready'
})

afterEach(() => vi.useRealTimers())

describe('InflectionView', () => {
  it('counts a stress-only table warning as right but waits for the learner to continue', async () => {
    const wrapper = mount(InflectionView, { props: { pos: 'noun' } })
    const buildButton = wrapper
      .findAll('button.card')
      .find((button) => button.text().includes('Build the table'))
    await buildButton.trigger('click')

    wrapper.findComponent(DragTable).vm.$emit('graded', true, [
      { slot: 'nom.pl', correct: true, stressCorrect: false },
    ])
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Score: 1 / 1')
    expect(wrapper.findAll('button').some((button) => button.text().includes('Next →'))).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.findAll('button').some((button) => button.text().includes('Next →'))).toBe(true)
  })
})
