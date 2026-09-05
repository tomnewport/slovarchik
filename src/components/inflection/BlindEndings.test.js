import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import BlindEndings from './BlindEndings.vue'

vi.mock('../../lib/speech.js', () => ({ speak: vi.fn(), speechSupported: () => false }))

// A three-cell paradigm (stem "кот") so there are three ending boxes to move
// between. endingOf strips the stem off each form: '' / 'а' / 'у'.
const paradigm = {
  lemma: 'кот',
  stem: 'кот',
  rows: [
    { key: 'nom', label: 'Nominative' },
    { key: 'gen', label: 'Genitive' },
    { key: 'dat', label: 'Dative' },
  ],
  cols: [{ key: 'sg', label: 'Singular' }],
  cells: [
    { row: 'nom', col: 'sg', form: 'кот' },
    { row: 'gen', col: 'sg', form: 'кота' },
    { row: 'dat', col: 'sg', form: 'коту' },
  ],
}

describe('BlindEndings — try-before-hint retry (allowRetry)', () => {
  async function fill(inputs, values) {
    for (let i = 0; i < values.length; i++) await inputs[i].setValue(values[i])
  }

  it('grades a wrong table immediately when retry is not allowed (default)', async () => {
    const wrapper = mount(BlindEndings, { props: { paradigm } })
    await fill(wrapper.findAll('input.ending-input'), ['х', 'а', 'у'])
    await wrapper.find('button.primary').trigger('click')
    expect(wrapper.emitted('graded')).toBeTruthy()
    expect(wrapper.emitted('retry')).toBeUndefined()
  })

  it('marks the slipped cells and asks for a retry instead of grading', async () => {
    const wrapper = mount(BlindEndings, { props: { paradigm, allowRetry: true } })
    const inputs = wrapper.findAll('input.ending-input')
    await fill(inputs, ['х', 'а', 'у']) // nominative wrong (zero ending)
    await wrapper.find('button.primary').trigger('click')

    expect(wrapper.emitted('graded')).toBeUndefined()
    expect(wrapper.emitted('retry')).toBeTruthy()
    expect(wrapper.text()).toContain('Not quite')
    // Only the wrong cell is marked — and never with the correct letters.
    expect(inputs[0].classes()).toContain('first-try-wrong')
    expect(inputs[1].classes()).not.toContain('first-try-wrong')

    // The second check grades for real.
    await inputs[0].setValue('')
    await wrapper.find('button.primary').trigger('click')
    expect(wrapper.emitted('graded')[0][0]).toBe(true)
  })

  it('spends only one retry: a second wrong check is graded wrong', async () => {
    const wrapper = mount(BlindEndings, { props: { paradigm, allowRetry: true } })
    const inputs = wrapper.findAll('input.ending-input')
    await fill(inputs, ['х', 'а', 'у'])
    await wrapper.find('button.primary').trigger('click') // retry
    await wrapper.find('button.primary').trigger('click') // still wrong → graded
    expect(wrapper.emitted('graded')[0][0]).toBe(false)
  })

  it('grades a correct first try straight away, without a retry round', async () => {
    const wrapper = mount(BlindEndings, { props: { paradigm, allowRetry: true } })
    await fill(wrapper.findAll('input.ending-input'), ['', 'а', 'у'])
    await wrapper.find('button.primary').trigger('click')
    expect(wrapper.emitted('graded')[0][0]).toBe(true)
    expect(wrapper.emitted('retry')).toBeUndefined()
  })
})

describe('BlindEndings — Enter advances to the next empty box', () => {
  it('jumps to the next still-empty ending input on Enter', async () => {
    const wrapper = mount(BlindEndings, { props: { paradigm }, attachTo: document.body })
    const inputs = wrapper.findAll('input.ending-input')
    expect(inputs).toHaveLength(3)

    inputs[0].element.focus()
    await inputs[0].setValue('а')
    await inputs[0].trigger('keydown', { key: 'Enter' })

    expect(document.activeElement).toBe(inputs[1].element)
    wrapper.unmount()
  })

  it('wraps around to find an empty box, skipping filled ones', async () => {
    const wrapper = mount(BlindEndings, { props: { paradigm }, attachTo: document.body })
    const inputs = wrapper.findAll('input.ending-input')

    // Boxes 1 and 2 are filled; box 0 is empty. From box 2, Enter wraps to box 0.
    await inputs[1].setValue('а')
    await inputs[2].setValue('у')
    inputs[2].element.focus()
    await inputs[2].trigger('keydown', { key: 'Enter' })

    expect(document.activeElement).toBe(inputs[0].element)
    wrapper.unmount()
  })

  it('stays put when every box is already filled', async () => {
    const wrapper = mount(BlindEndings, { props: { paradigm }, attachTo: document.body })
    const inputs = wrapper.findAll('input.ending-input')

    await inputs[0].setValue('')
    await inputs[1].setValue('а')
    await inputs[2].setValue('у')
    inputs[0].element.focus()
    await inputs[0].setValue('х') // now all three are non-empty
    await inputs[0].trigger('keydown', { key: 'Enter' })

    expect(document.activeElement).toBe(inputs[0].element)
    wrapper.unmount()
  })
})

// #646 — a wrong ending that is only wrong about the SPELLING of it. Typing
// «кни́гы» is the seven-letter rule, not a gap in the genitive, and the drill
// says so rather than leaving the learner to re-derive the whole case.
describe('BlindEndings — rule reminders', () => {
  // Stem "книг", so the endings drilled are и / и / е — the very column the
  // seven-letter rule governs.
  const kniga = {
    lemma: 'кни́га',
    stem: 'книг',
    rows: [
      { key: 'nom', label: 'Nominative' },
      { key: 'gen', label: 'Genitive' },
      { key: 'dat', label: 'Dative' },
    ],
    cols: [
      { key: 'sg', label: 'Singular' },
      { key: 'pl', label: 'Plural' },
    ],
    cells: [
      { row: 'nom', col: 'pl', form: 'кни́ги' },
      { row: 'gen', col: 'sg', form: 'кни́ги' },
      { row: 'dat', col: 'sg', form: 'кни́ге' },
    ],
  }

  const fill = async (inputs, values) => {
    for (let i = 0; i < values.length; i++) await inputs[i].setValue(values[i])
  }

  it('names the rule a wrong ending broke', async () => {
    const wrapper = mount(BlindEndings, { props: { paradigm: kniga } })
    await fill(wrapper.findAll('input.ending-input'), ['ы', 'и', 'е'])
    await wrapper.find('button.primary').trigger('click')
    expect(wrapper.text()).toContain('seven-letter rule')
  })

  it('says one rule once, however many cells it explains', async () => {
    const wrapper = mount(BlindEndings, { props: { paradigm: kniga } })
    await fill(wrapper.findAll('input.ending-input'), ['ы', 'ы', 'е'])
    await wrapper.find('button.primary').trigger('click')
    expect(wrapper.findAll('.rule-hint')).toHaveLength(1)
  })

  it('offers the reminder on the retry, while it can still be acted on', async () => {
    const wrapper = mount(BlindEndings, { props: { paradigm: kniga, allowRetry: true } })
    await fill(wrapper.findAll('input.ending-input'), ['ы', 'и', 'е'])
    await wrapper.find('button.primary').trigger('click')
    expect(wrapper.emitted('retry')).toBeTruthy()
    expect(wrapper.text()).toContain('seven-letter rule')
  })

  it('drops the reminder once the retry fixes the spelling', async () => {
    const wrapper = mount(BlindEndings, { props: { paradigm: kniga, allowRetry: true } })
    const inputs = wrapper.findAll('input.ending-input')
    await fill(inputs, ['ы', 'и', 'е'])
    await wrapper.find('button.primary').trigger('click')
    await fill(inputs, ['и', 'и', 'е'])
    await wrapper.find('button.primary').trigger('click')
    expect(wrapper.findAll('.rule-hint')).toHaveLength(0)
  })

  it('says nothing about an ending the learner simply did not know', async () => {
    const wrapper = mount(BlindEndings, { props: { paradigm: kniga } })
    await fill(wrapper.findAll('input.ending-input'), ['а', 'и', 'е'])
    await wrapper.find('button.primary').trigger('click')
    expect(wrapper.findAll('.rule-hint')).toHaveLength(0)
  })

  it('says nothing when the table is right', async () => {
    const wrapper = mount(BlindEndings, { props: { paradigm: kniga } })
    await fill(wrapper.findAll('input.ending-input'), ['и', 'и', 'е'])
    await wrapper.find('button.primary').trigger('click')
    expect(wrapper.findAll('.rule-hint')).toHaveLength(0)
  })
})
