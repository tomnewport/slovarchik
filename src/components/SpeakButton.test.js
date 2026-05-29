import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('../lib/speech.js', () => ({
  speak: vi.fn(),
  speechSupported: vi.fn(),
}))

import { speak, speechSupported } from '../lib/speech.js'
import SpeakButton from './SpeakButton.vue'

describe('SpeakButton', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders a button and calls speak with the text and lang on click', async () => {
    speechSupported.mockReturnValue(true)
    const wrapper = mount(SpeakButton, { props: { text: 'книга' } })
    expect(wrapper.find('button').exists()).toBe(true)
    await wrapper.find('button').trigger('click')
    expect(speak).toHaveBeenCalledWith('книга', 'ru-RU')
  })

  it('respects an explicit lang prop', async () => {
    speechSupported.mockReturnValue(true)
    const wrapper = mount(SpeakButton, { props: { text: 'hello', lang: 'en-US' } })
    await wrapper.find('button').trigger('click')
    expect(speak).toHaveBeenCalledWith('hello', 'en-US')
  })

  it('hides the button when speech is not supported', () => {
    speechSupported.mockReturnValue(false)
    const wrapper = mount(SpeakButton, { props: { text: 'книга' } })
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
