import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import RussianKeyboard from './RussianKeyboard.vue'
import { resetHint } from '../stores/keyboard.js'

// A Russian input lives in the document; the keyboard follows focus to it.
function makeInput(lang = 'ru') {
  const el = document.createElement('input')
  el.type = 'text'
  if (lang) el.setAttribute('lang', lang)
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
  resetHint()
})

describe('RussianKeyboard', () => {
  it('stays hidden until a Russian input is focused', async () => {
    const wrapper = mount(RussianKeyboard, { attachTo: document.body })
    expect(wrapper.find('.kbd').exists()).toBe(false)

    const input = makeInput()
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.kbd').exists()).toBe(true)
    wrapper.unmount()
  })

  it('ignores non-Russian inputs', async () => {
    const wrapper = mount(RussianKeyboard, { attachTo: document.body })
    const input = makeInput('en')
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.kbd').exists()).toBe(false)
    wrapper.unmount()
  })

  it('types Cyrillic at the caret and emits input events', async () => {
    const wrapper = mount(RussianKeyboard, { attachTo: document.body })
    const input = makeInput()
    let lastValue = ''
    input.addEventListener('input', () => (lastValue = input.value))
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await wrapper.vm.$nextTick()

    // Press the first key (й), then backspace, then space + another key.
    await wrapper.findAll('.kbd-key')[0].trigger('click')
    expect(input.value).toBe('й')
    expect(lastValue).toBe('й')

    await wrapper.find('[aria-label="Backspace"]').trigger('click')
    expect(input.value).toBe('')
    wrapper.unmount()
  })

  it('lights the next letter to type (plus decoys) once the hint is switched on', async () => {
    const wrapper = mount(RussianKeyboard, { attachTo: document.body })
    const input = makeInput()
    // The field declares the answer it expects via data-answer.
    input.dataset.answer = 'дом'
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await wrapper.vm.$nextTick()

    // Nothing is lit until the learner presses the 💡 hint key.
    expect(wrapper.findAll('.kbd-key.hint')).toHaveLength(0)

    await wrapper.find('[aria-label="Toggle hint"]').trigger('click')
    let lit = wrapper.findAll('.kbd-key.hint').map((k) => k.text())
    expect(lit).toContain('д') // the next letter to type …
    expect(lit).toHaveLength(3) // … plus two decoys

    // Typing the first letter advances the hint to the next one.
    input.value = 'д'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wrapper.vm.$nextTick()
    lit = wrapper.findAll('.kbd-key.hint').map((k) => k.text())
    expect(lit).toContain('о')

    // Switching the hint back off clears every highlight.
    await wrapper.find('[aria-label="Toggle hint"]').trigger('click')
    expect(wrapper.findAll('.kbd-key.hint')).toHaveLength(0)
    wrapper.unmount()
  })

  it('applies shift for a single capital letter', async () => {
    const wrapper = mount(RussianKeyboard, { attachTo: document.body })
    const input = makeInput()
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await wrapper.vm.$nextTick()

    await wrapper.find('[aria-pressed]').trigger('click') // shift on
    await wrapper.findAll('.kbd-key')[0].trigger('click') // й -> Й
    await wrapper.findAll('.kbd-key')[1].trigger('click') // ц (shift reset)
    expect(input.value).toBe('Йц')
    wrapper.unmount()
  })
})
