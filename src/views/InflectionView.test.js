import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { flushPromises, mount } from '@vue/test-utils'

import InflectionView from './InflectionView.vue'
import DragTable from '../components/inflection/DragTable.vue'
import { state as vocabState } from '../stores/vocab.js'
import { isTableClean, resetProgress } from '../stores/progress.js'
import { loadFixtureWords } from '../test/fixtures.js'

vi.mock('../lib/speech.js', () => ({ speak: vi.fn(), speechSupported: () => false }))

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  await resetProgress()
  // Only the timers the view itself uses: fake-indexeddb completes its
  // transactions on setImmediate, which must stay real for the progress writes
  // these tests make.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
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

describe('InflectionView — staged first pass (#645)', () => {
  const cardFor = (wrapper, label) =>
    wrapper.findAll('button.card').find((button) => button.text().includes(label))

  it('serves a table staged until it has been built with nothing in the wrong cell', async () => {
    const wrapper = mount(InflectionView, { props: { pos: 'noun' } })
    await cardFor(wrapper, 'Build the table').trigger('click')
    const table = wrapper.findComponent(DragTable)
    expect(table.props('staged')).toBe(true)

    const drawn = table.props('paradigm')
    table.vm.$emit(
      'graded',
      true,
      // A stress warning does not stop the promotion — only a wrong cell would.
      drawn.cells.map((c) => ({ slot: `${c.row}.${c.col}`, correct: true, stressCorrect: false })),
    )
    await flushPromises()
    expect(isTableClean(drawn.word.key, drawn.variant ?? null)).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    // The next round of the same table comes whole.
    while (wrapper.vm.paradigm.key !== drawn.key) {
      wrapper.vm.newRound()
      await wrapper.vm.$nextTick()
    }
    expect(wrapper.findComponent(DragTable).props('staged')).toBe(false)
  })

  it('keeps staging a table that needed a correction', async () => {
    const wrapper = mount(InflectionView, { props: { pos: 'noun' } })
    await cardFor(wrapper, 'Build the table').trigger('click')
    const drawn = wrapper.findComponent(DragTable).props('paradigm')
    wrapper.findComponent(DragTable).vm.$emit('graded', false, [
      { slot: `${drawn.cells[0].row}.${drawn.cells[0].col}`, correct: false, stressCorrect: null },
    ])
    await flushPromises()
    expect(isTableClean(drawn.word.key, drawn.variant ?? null)).toBe(false)
  })
})
