import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

import HintPassButton from './HintPassButton.vue'

describe('HintPassButton (#725)', () => {
  it('starts as a lit fire offering hints', () => {
    const wrapper = mount(HintPassButton)
    expect(wrapper.find('.face').text()).toBe('🔥')
    expect(wrapper.find('.label').text()).toBe('Hints')
    expect(wrapper.find('.face').classes()).not.toContain('out')
  })

  it('asks for hints first, and only then offers a pass', async () => {
    const wrapper = mount(HintPassButton)
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('hints')).toHaveLength(1)
    expect(wrapper.emitted('pass')).toBeUndefined()

    await wrapper.setProps({ hinted: true })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('pass')).toHaveLength(1)
    expect(wrapper.emitted('hints')).toHaveLength(1)
  })

  it('puts the fire out, then swaps it for a thinking face', async () => {
    vi.useFakeTimers()
    const wrapper = mount(HintPassButton)
    await wrapper.setProps({ hinted: true })
    // Greyed and faded straight away — the emoji itself lags behind.
    expect(wrapper.find('.face').classes()).toContain('out')
    expect(wrapper.find('.face').text()).toBe('🔥')
    expect(wrapper.find('.label').text()).toBe('Pass')

    vi.advanceTimersByTime(500)
    await flushPromises()
    expect(wrapper.find('.face').text()).toBe('🤔')
    vi.useRealTimers()
  })

  it('mounts spent without an animation to replay', () => {
    const wrapper = mount(HintPassButton, { props: { hinted: true } })
    expect(wrapper.find('.face').text()).toBe('🤔')
  })

  it('shows the spent fire with nothing to press where there is no pass', async () => {
    const wrapper = mount(HintPassButton, { props: { hinted: true, canPass: false } })
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('pass')).toBeUndefined()
  })
})
