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
