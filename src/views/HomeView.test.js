import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import { state as progress } from '../stores/progress.js'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const { default: HomeView } = await import('./HomeView.vue')

beforeEach(() => {
  progress.records = {}
  progress.learning = null
  progress.mastery = null
  push.mockClear()
})

describe('HomeView', () => {
  it('launches the three standard session sizes', async () => {
    const wrapper = mount(HomeView)
    await wrapper.find('.size.quick').trigger('click')
    await wrapper.find('.size.normal').trigger('click')
    await wrapper.find('.size.super').trigger('click')
    expect(push).toHaveBeenNthCalledWith(1, { path: '/session', query: { type: 'standard', size: 'quick' } })
    expect(push).toHaveBeenNthCalledWith(2, { path: '/session', query: { type: 'standard', size: 'normal' } })
    expect(push).toHaveBeenNthCalledWith(3, { path: '/session', query: { type: 'standard', size: 'super' } })
  })

  it('launches each focused session type', async () => {
    const wrapper = mount(HomeView)
    const buttons = wrapper.findAll('.focus-btn')
    expect(buttons).toHaveLength(5)
    await buttons[0].trigger('click') // Speaking
    expect(push).toHaveBeenCalledWith({ path: '/session', query: { type: 'speaking' } })
  })

  it('prompts to choose a learning batch when none is set', async () => {
    const wrapper = mount(HomeView)
    expect(wrapper.find('.batch-card.learn').text()).toContain('Choose words to learn')
    await wrapper.find('.batch-card.learn').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/batch', query: { level: 'learning' } })
  })

  it('links to the standalone free-practice drills', async () => {
    const wrapper = mount(HomeView)
    const drills = wrapper.findAll('.drill')
    expect(drills.length).toBe(9)
    await drills[0].trigger('click') // Vocabulary
    expect(push).toHaveBeenCalledWith('/vocab')
  })

  it('shows the committed batch name and hides mastery until unlocked', () => {
    progress.learning = { name: 'animals', level: 'learning', words: [], size: 20 }
    const wrapper = mount(HomeView)
    expect(wrapper.find('.batch-card.learn').text()).toContain('animals')
    // Fewer than 100 words learned → no mastery card.
    expect(wrapper.find('.batch-card.master').exists()).toBe(false)
  })
})
