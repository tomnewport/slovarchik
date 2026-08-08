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

// Same spelling, different stress — e.g. nominative plural versus genitive
// singular for окно. The table remains correct when these are swapped, but the
// stress distinction should not disappear.
const stressParadigm = {
  lemma: 'окно́',
  rows: [
    { key: 'nom', label: 'Nominative' },
    { key: 'gen', label: 'Genitive' },
  ],
  cols: [
    { key: 'sg', label: 'Singular' },
    { key: 'pl', label: 'Plural' },
  ],
  cells: [
    { row: 'nom', col: 'pl', form: 'о́кна' },
    { row: 'gen', col: 'sg', form: 'окна́' },
  ],
}

// The cell whose correct answer is `answer` — re-queried each time, since the
// table re-renders on every placement.
const cellFor = (wrapper, answer) =>
  wrapper.findAll('.drop').find((d) => d.attributes('data-answer') === answer)

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

  it('soft-warns when same-spelling forms are placed with the wrong stress', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: stressParadigm } })

    const nomPlural = wrapper.vm.bank.find((c) => c.form === 'о́кна')
    const genSingular = wrapper.vm.bank.find((c) => c.form === 'окна́')
    wrapper.vm.place('nom.pl', genSingular.id)
    wrapper.vm.place('gen.sg', nomPlural.id)
    await wrapper.vm.$nextTick()
    await wrapper.find('button.primary').trigger('click')

    const [correct, records] = wrapper.emitted('graded')[0]
    expect(correct).toBe(true) // stress is never a hard fail
    expect(records.every((record) => record.correct)).toBe(true)
    expect(records.every((record) => record.stressCorrect === false)).toBe(true)
    expect(wrapper.findAll('.drop.stress-warning')).toHaveLength(2)
    expect(wrapper.findAll('.drop.correct')).toHaveLength(0)
    expect(wrapper.find('.stress-hint').text()).toContain('Table accepted')
    expect(wrapper.findAll('.stress-correction').map((node) => node.text())).toEqual([
      'окна́→о́кна',
      'о́кна→окна́',
    ])
  })

  it('does not warn when same-spelling forms have the right stress', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: stressParadigm } })

    const nomPlural = wrapper.vm.bank.find((c) => c.form === 'о́кна')
    const genSingular = wrapper.vm.bank.find((c) => c.form === 'окна́')
    wrapper.vm.place('nom.pl', nomPlural.id)
    wrapper.vm.place('gen.sg', genSingular.id)
    await wrapper.vm.$nextTick()
    await wrapper.find('button.primary').trigger('click')

    const [correct, records] = wrapper.emitted('graded')[0]
    expect(correct).toBe(true)
    expect(records.every((record) => record.stressCorrect)).toBe(true)
    expect(wrapper.findAll('.drop.correct')).toHaveLength(2)
    expect(wrapper.find('.stress-hint').exists()).toBe(false)
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

  it('double-click places chip in first empty slot (left-to-right, top-to-bottom order)', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    const [firstChip] = wrapper.vm.bank
    await wrapper.findAll('button.chip')[0].trigger('dblclick')

    // Exactly one slot filled, and it's the first in reading order.
    expect(Object.keys(wrapper.vm.placed)).toHaveLength(1)
    expect(wrapper.vm.placed['nom.sg']).toBe(firstChip.id)
  })

  it('successive double-clicks fill slots in reading order', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    await wrapper.findAll('button.chip')[0].trigger('dblclick')
    await wrapper.vm.$nextTick()
    await wrapper.findAll('button.chip')[0].trigger('dblclick')
    await wrapper.vm.$nextTick()

    expect(Object.keys(wrapper.vm.placed)).toHaveLength(2)
    expect(wrapper.vm.placed['nom.sg']).toBeDefined()
    expect(wrapper.vm.placed['gen.sg']).toBeDefined()
  })

  it('places a chip with the keyboard alone: Enter on a chip, then Enter on a cell', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    const kotId = wrapper.vm.bank.find((c) => c.form === 'кот').id
    // Enter on a native <button> fires a click — that half already worked.
    await wrapper.findAll('button.chip').find((c) => c.text() === 'кот').trigger('click')
    await cellFor(wrapper, 'кот').trigger('keydown.enter')

    expect(wrapper.vm.placed['nom.sg']).toBe(kotId)

    // And Space works on the remaining cell.
    await wrapper.findAll('button.chip').find((c) => c.text() === 'кота').trigger('click')
    await cellFor(wrapper, 'кота').trigger('keydown.space')

    expect(Object.keys(wrapper.vm.placed).sort()).toEqual(['gen.sg', 'nom.sg'])
  })

  it('sends a chip back to the bank from the keyboard', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    const kotChip = wrapper.vm.bank.find((c) => c.form === 'кот')
    wrapper.vm.place('nom.sg', kotChip.id)
    await wrapper.vm.$nextTick()

    await cellFor(wrapper, 'кот').trigger('keydown.enter')

    expect(wrapper.vm.placed['nom.sg']).toBeUndefined()
    expect(wrapper.vm.bank.some((c) => c.id === kotChip.id)).toBe(true)
  })

  it('gives every cell a button contract naming its row and column', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    const cells = wrapper.findAll('.drop')
    expect(cells).toHaveLength(2)
    for (const cell of cells) {
      expect(cell.attributes('role')).toBe('button')
      expect(cell.attributes('tabindex')).toBe('0')
    }
    expect(cells.map((c) => c.attributes('aria-label'))).toEqual([
      'Nominative, Singular: empty',
      'Genitive, Singular: empty',
    ])
  })

  it('labels cells with their contents, and with the graded outcome once checked', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    const kotChip = wrapper.vm.bank.find((c) => c.form === 'кот')
    const kotaChip = wrapper.vm.bank.find((c) => c.form === 'кота')
    wrapper.vm.place('nom.sg', kotChip.id)
    wrapper.vm.place('gen.sg', kotaChip.id)
    await wrapper.vm.$nextTick()

    expect(cellFor(wrapper, 'кот').attributes('aria-label')).toBe(
      'Nominative, Singular: кот, press to return it to the bank',
    )

    await wrapper.find('button.primary').trigger('click')

    expect(cellFor(wrapper, 'кот').attributes('aria-label')).toBe(
      'Nominative, Singular: кот, correct',
    )
    expect(cellFor(wrapper, 'кот').attributes('tabindex')).toBe('-1')
  })

  it('labels a wrong cell with the expected form once checked', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    const kotChip = wrapper.vm.bank.find((c) => c.form === 'кот')
    const kotaChip = wrapper.vm.bank.find((c) => c.form === 'кота')
    wrapper.vm.place('nom.sg', kotaChip.id)
    wrapper.vm.place('gen.sg', kotChip.id)
    await wrapper.vm.$nextTick()
    await wrapper.find('button.primary').trigger('click')

    expect(cellFor(wrapper, 'кот').attributes('aria-label')).toBe(
      'Nominative, Singular: кота, wrong — кот',
    )
  })

  it('labels a stress miss as the right form with the wrong stress', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: stressParadigm } })

    const nomPlural = wrapper.vm.bank.find((c) => c.form === 'о́кна')
    const genSingular = wrapper.vm.bank.find((c) => c.form === 'окна́')
    wrapper.vm.place('nom.pl', genSingular.id)
    wrapper.vm.place('gen.sg', nomPlural.id)
    await wrapper.vm.$nextTick()
    await wrapper.find('button.primary').trigger('click')

    expect(cellFor(wrapper, 'о́кна').attributes('aria-label')).toBe(
      'Nominative, Plural: окна́, right form, wrong stress — о́кна',
    )
  })

  it('announces the pick → place sequence in a live region', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    const status = () => wrapper.find('[role="status"]')
    expect(status().text()).toBe('')

    const kotChip = () => wrapper.findAll('button.chip').find((c) => c.text() === 'кот')
    await kotChip().trigger('click')
    expect(status().text()).toBe('кот selected — choose a cell.')
    expect(kotChip().attributes('aria-pressed')).toBe('true')

    // The empty cells now advertise what pressing them would do.
    expect(cellFor(wrapper, 'кот').attributes('aria-label')).toBe(
      'Nominative, Singular: empty, place кот',
    )

    await cellFor(wrapper, 'кот').trigger('keydown.enter')
    expect(status().text()).toBe('кот placed in Nominative, Singular.')

    await cellFor(wrapper, 'кот').trigger('keydown.enter')
    expect(status().text()).toBe('кот returned to the bank.')

    await kotChip().trigger('click')
    await kotChip().trigger('click')
    expect(status().text()).toBe('кот deselected.')
  })

  it('ignores keyboard activation once the table is checked', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    const kotChip = wrapper.vm.bank.find((c) => c.form === 'кот')
    const kotaChip = wrapper.vm.bank.find((c) => c.form === 'кота')
    wrapper.vm.place('nom.sg', kotChip.id)
    wrapper.vm.place('gen.sg', kotaChip.id)
    await wrapper.vm.$nextTick()
    await wrapper.find('button.primary').trigger('click')

    const placedBefore = { ...wrapper.vm.placed }
    await cellFor(wrapper, 'кот').trigger('keydown.enter')
    await cellFor(wrapper, 'кот').trigger('keydown.space')

    expect(wrapper.vm.placed).toEqual(placedBefore)
  })

  it('double-click does nothing when checked', async () => {
    const wrapper = mount(DragTable, { props: { paradigm: normalParadigm } })

    // Fill all slots and check.
    const kotChip = wrapper.vm.bank.find((c) => c.form === 'кот')
    const kotaChip = wrapper.vm.bank.find((c) => c.form === 'кота')
    wrapper.vm.place('nom.sg', kotChip.id)
    wrapper.vm.place('gen.sg', kotaChip.id)
    await wrapper.vm.$nextTick()
    await wrapper.find('button.primary').trigger('click')

    const placedBefore = { ...wrapper.vm.placed }
    // Directly invoke the handler — the checked guard should block any change.
    wrapper.vm.onChipDblClick(kotChip.id)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.placed).toEqual(placedBefore)
  })
})
