import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import BlindEndings from './BlindEndings.vue'

vi.mock('../../lib/speech.js', () => ({ speak: vi.fn() }))

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
