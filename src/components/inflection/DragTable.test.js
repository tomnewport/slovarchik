import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import DragTable from './DragTable.vue'

vi.mock('../../lib/speech.js', () => ({ speak: vi.fn() }))

// Two cells with distinct forms — baseline correct/incorrect tests.
const normalParadigm = {
  lemma: 'кот',
  rows: [
    { key: 'nom', label: 'Nominative' },
    { key: 'gen', label: 'Genitive' },
  ],
  cols: [{ key: 'sg', label: 'Singular' }],
  cells: [
    { row: 'nom', col: 'sg', form: 'кот' },
    { row: 'gen', col: 'sg', form: 'кота' },
  ],
}

// Two cells that share the same form (syncretism — common for Russian inanimate nouns).
const syncreticParadigm = {
  lemma: 'стол',
  rows: [
    { key: 'nom', label: 'Nominative' },
    { key: 'acc', label: 'Accusative' },
  ],
  cols: [{ key: 'sg', label: 'Singular' }],
  cells: [
    { row: 'nom', col: 'sg', form: 'стол' },
    { row: 'acc', col: 'sg', form: 'стол' },
  ],
}

describe('DragTable', () => {
  it('grades the table correct when every chip is placed in a matching-form cell', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    const kotChip = wrapper.vm.bank.find((c) => c.form === 'кот')
    const kotaChip = wrapper.vm.bank.find((c) => c.form === 'кота')
    wrapper.vm.place('nom.sg', kotChip.id)
    wrapper.vm.place('gen.sg', kotaChip.id)
    await wrapper.vm.$nextTick()

    await wrapper.find('button.primary').trigger('click')

    expect(wrapper.emitted('graded')).toBeTruthy()
    expect(wrapper.emitted('graded')[0][0]).toBe(true)
  })

  it('grades a wrong placement as incorrect', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    const kotChip = wrapper.vm.bank.find((c) => c.form === 'кот')
    const kotaChip = wrapper.vm.bank.find((c) => c.form === 'кота')
    // Intentionally swap: put 'кота' in nominative and 'кот' in genitive.
    wrapper.vm.place('nom.sg', kotaChip.id)
    wrapper.vm.place('gen.sg', kotChip.id)
    await wrapper.vm.$nextTick()

    await wrapper.find('button.primary').trigger('click')

    expect(wrapper.emitted('graded')[0][0]).toBe(false)
  })

  it('accepts syncretic chips placed in either cell as correct', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: syncreticParadigm } })

    // Both chips carry the same form; swap them relative to their creation order.
    const [chipA, chipB] = wrapper.vm.bank
    wrapper.vm.place('acc.sg', chipA.id)
    wrapper.vm.place('nom.sg', chipB.id)
    await wrapper.vm.$nextTick()

    await wrapper.find('button.primary').trigger('click')

    expect(wrapper.emitted('graded')[0][0]).toBe(true)
  })

  it('emits per-cell records and the overall pass/fail flag', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    const kotChip = wrapper.vm.bank.find((c) => c.form === 'кот')
    const kotaChip = wrapper.vm.bank.find((c) => c.form === 'кота')
    wrapper.vm.place('nom.sg', kotChip.id)
    wrapper.vm.place('gen.sg', kotaChip.id)
    await wrapper.vm.$nextTick()
    await wrapper.find('button.primary').trigger('click')

    const [correct, records] = wrapper.emitted('graded')[0]
    expect(correct).toBe(true)
    expect(records).toHaveLength(2)
    expect(records.every((r) => r.correct)).toBe(true)
    expect(records.map((r) => r.slot).sort()).toEqual(['gen.sg', 'nom.sg'])
  })

  it('does not grade until all chips are placed', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    // Place only one chip and try to check.
    const kotChip = wrapper.vm.bank.find((c) => c.form === 'кот')
    wrapper.vm.place('nom.sg', kotChip.id)
    await wrapper.vm.$nextTick()

    // Check button should be disabled and no graded event emitted.
    expect(wrapper.find('button.primary').element.disabled).toBe(true)
    expect(wrapper.emitted('graded')).toBeFalsy()
  })
})
