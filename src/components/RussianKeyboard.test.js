import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import RussianKeyboard from './RussianKeyboard.vue'
import { setHintLetters, clearHintLetters } from '../stores/keyboard.js'

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
  clearHintLetters()
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

  it('highlights the hinted letters of the answer', async () => {
    const wrapper = mount(RussianKeyboard, { attachTo: document.body })
    const input = makeInput()
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    setHintLetters('дом')
    await wrapper.vm.$nextTick()

    const hinted = wrapper.findAll('.kbd-key.hint').map((k) => k.text())
    expect(new Set(hinted)).toEqual(new Set(['д', 'о', 'м']))

    // Clearing the hint removes every highlight.
    clearHintLetters()
    await wrapper.vm.$nextTick()
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
