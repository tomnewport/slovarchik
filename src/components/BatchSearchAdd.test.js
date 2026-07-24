import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'

// Minimal, deterministic stand-ins for the engine so the test focuses purely on
// the combo-box interaction.
const vocabState = reactive({ words: [] })
const progressState = reactive({ learning: { words: [], size: 0 } })
const commitBatch = vi.fn(async (updated) => {
  progressState.learning = updated
})

vi.mock('@/stores/vocab.js', () => ({ state: vocabState }))
vi.mock('@/stores/progress.js', () => ({
  state: progressState,
  commitBatch,
  stateOf: () => 'new',
}))
vi.mock('@/lib/collections.js', () => ({ COLLECTIONS: [] }))
vi.mock('@/lib/vocabBuild.js', () => ({ learnableWords: (words) => words }))
vi.mock('@/lib/batches.js', () => ({
  isEligible: () => true,
  batchSize: () => 20,
  refineToLowest: (words) => words,
}))

const { default: BatchSearchAdd } = await import('./BatchSearchAdd.vue')

beforeEach(() => {
  vocabState.words = [
    { key: 'apple', ru: 'яблоко', en: 'apple', cefr: 'A1', headword: 'яблоко', meaning: 'apple' },
    { key: 'apricot', ru: 'абрикос', en: 'apricot', cefr: 'A2', headword: 'абрикос', meaning: 'apricot' },
    { key: 'avocado', ru: 'авокадо', en: 'avocado', cefr: 'B1', headword: 'авокадо', meaning: 'avocado' },
  ]
  progressState.learning = { words: [], size: 0 }
  commitBatch.mockClear()
})

describe('BatchSearchAdd combo-box', () => {
  it('keeps working after picking an option — the dropdown reappears on the next query', async () => {
    const wrapper = mount(BatchSearchAdd)
    const input = wrapper.find('.search-input')

    // Focus and search: the dropdown offers matches.
    await input.trigger('focus')
    await input.setValue('ap')
    expect(wrapper.find('.dropdown').exists()).toBe(true)
    expect(wrapper.findAll('.item').length).toBeGreaterThan(0)

    // Pick the first match. Selection happens on mousedown (with .prevent so the
    // input never blurs), so the input retains focus throughout.
    await wrapper.find('.item').trigger('mousedown')
    await flushPromises()
    expect(commitBatch).toHaveBeenCalledTimes(1)
    expect(progressState.learning.words).toContain('apple')

    // The query is cleared, so the dropdown closes on its own.
    expect(wrapper.find('.dropdown').exists()).toBe(false)

    // Typing again must re-open the dropdown without any manual blur/re-focus —
    // this is the regression the fix guards against.
    await input.setValue('av')
    expect(wrapper.find('.dropdown').exists()).toBe(true)
    expect(wrapper.find('.item').text()).toContain('авокадо')

    // And a second pick still works.
    await wrapper.find('.item').trigger('mousedown')
    await flushPromises()
    expect(commitBatch).toHaveBeenCalledTimes(2)
    expect(progressState.learning.words).toContain('avocado')
  })
})
