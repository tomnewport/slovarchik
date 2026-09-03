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

describe('InflectionView — build the table before typing it (#645)', () => {
  const cardFor = (wrapper, label) =>
    wrapper.findAll('button.card').find((button) => button.text().includes(label))

  it('withholds the typing drill until a table has been built cleanly', async () => {
    const wrapper = mount(InflectionView, { props: { pos: 'noun' } })
    const endings = cardFor(wrapper, 'Type the endings')
    expect(endings.attributes('disabled')).toBeDefined()
    expect(endings.text()).toContain('Build a table correctly first')
    expect(cardFor(wrapper, 'Build the table').attributes('disabled')).toBeUndefined()
  })

  it('unlocks typing for a table assembled with nothing to correct', async () => {
    const wrapper = mount(InflectionView, { props: { pos: 'noun' } })
    await cardFor(wrapper, 'Build the table').trigger('click')
    const table = wrapper.findComponent(DragTable)
    // The learner's first pass at this table is staged, one column at a time.
    expect(table.props('staged')).toBe(true)

    const drawn = table.props('paradigm')
    table.vm.$emit(
      'graded',
      true,
      drawn.cells.map((c) => ({ slot: `${c.row}.${c.col}`, correct: true, stressCorrect: true })),
    )
    await flushPromises()
    expect(isTableClean(drawn.word.key, drawn.variant ?? null)).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    await wrapper.findAll('button').find((b) => b.text().includes('Change mode')).trigger('click')
    expect(cardFor(wrapper, 'Type the endings').attributes('disabled')).toBeUndefined()
  })

  it('draws the typing drill only from tables already built', async () => {
    const wrapper = mount(InflectionView, { props: { pos: 'noun' } })
    await cardFor(wrapper, 'Build the table').trigger('click')
    const drawn = wrapper.findComponent(DragTable).props('paradigm')
    wrapper
      .findComponent(DragTable)
      .vm.$emit(
        'graded',
        true,
        drawn.cells.map((c) => ({ slot: `${c.row}.${c.col}`, correct: true, stressCorrect: true })),
      )
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await wrapper.findAll('button').find((b) => b.text().includes('Change mode')).trigger('click')

    // Exactly one table has been built, so every round of the typing drill —
    // however many the learner asks for — draws that one and no other.
    await cardFor(wrapper, 'Type the endings').trigger('click')
    for (let i = 0; i < 5; i++) {
      expect(wrapper.vm.paradigm.key).toBe(drawn.key)
      wrapper.vm.newRound()
      await wrapper.vm.$nextTick()
    }
  })
})
