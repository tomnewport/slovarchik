import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

import ProgressView from './ProgressView.vue'
import { state as vocabState } from '../stores/vocab.js'
import { GRADES } from '../lib/progress.js'
import { record, setCurrentCollection, _resetForTests } from '../stores/progress.js'
import { loadFixtureWords } from '../test/fixtures.js'

beforeEach(() => {
  vocabState.words = loadFixtureWords()
  vocabState.status = 'ready'
  _resetForTests()
})

describe('ProgressView', () => {
  it('shows an empty state before any attempts', () => {
    const wrapper = mount(ProgressView)
    expect(wrapper.text()).toContain('No attempts recorded yet')
  })

  it('renders the dashboard once attempts exist', async () => {
    record({ kind: 'word', key: 'собака=dog' }, GRADES.INCORRECT, { level: 'easy' })
    record({ kind: 'word', key: 'собака=dog' }, GRADES.CORRECT, { level: 'advanced' })
    setCurrentCollection('animals')

    const wrapper = mount(ProgressView)
    const text = wrapper.text()
    expect(text).toContain('Skills by breadth')
    expect(text).toContain('Most mistaken words')
    expect(text).toContain('Exam readiness')
    expect(text).toContain('Practice session')
    // The breadth bands are always listed.
    expect(text).toContain('100+ words')
    expect(text).toContain('1+ words')
  })
})
