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
  it('redirects to batch selection when starting a session with no batch', async () => {
    const wrapper = mount(HomeView)
    await wrapper.find('.size.quick').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/batch', query: { level: 'learning' } })
  })

  it('launches the three standard session sizes once a batch is set', async () => {
    progress.learning = { name: 'animals', level: 'learning', words: [], size: 20 }
    const wrapper = mount(HomeView)
    await wrapper.find('.size.quick').trigger('click')
    await wrapper.find('.size.normal').trigger('click')
    await wrapper.find('.size.super').trigger('click')
    expect(push).toHaveBeenNthCalledWith(1, { path: '/session', query: { type: 'standard', size: 'quick' } })
    expect(push).toHaveBeenNthCalledWith(2, { path: '/session', query: { type: 'standard', size: 'normal' } })
    expect(push).toHaveBeenNthCalledWith(3, { path: '/session', query: { type: 'standard', size: 'super' } })
  })

  it('launches each focused session type once a batch is set', async () => {
    progress.learning = { name: 'animals', level: 'learning', words: [], size: 20 }
    const wrapper = mount(HomeView)
    const buttons = wrapper.findAll('.focus-btn')
    expect(buttons).toHaveLength(5)
    await buttons[0].trigger('click') // Speaking
    expect(push).toHaveBeenCalledWith({ path: '/session', query: { type: 'speaking' } })
  })

  it('prompts to choose a learning batch when none is set', async () => {
    const wrapper = mount(HomeView)
    const card = wrapper.find('.batch-card.learn')
    expect(card.element.tagName).toBe('BUTTON')
    expect(card.text()).toContain('Choose words to learn')
    await card.trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/batch', query: { level: 'learning' } })
  })

  it('links to the standalone free-practice drills', async () => {
    const wrapper = mount(HomeView)
    const drills = wrapper.findAll('.drill')
    expect(drills.length).toBe(9)
    await drills[0].trigger('click') // Vocabulary
    expect(push).toHaveBeenCalledWith('/vocab')
  })

  it('shows the committed batch name as a non-clickable card', () => {
    progress.learning = { name: 'animals', level: 'learning', words: [], size: 20 }
    const wrapper = mount(HomeView)
    const card = wrapper.find('.batch-card.learn')
    expect(card.element.tagName).toBe('DIV')
    expect(card.text()).toContain('animals')
  })

  it('shows mastery card only when a mastery batch is active', () => {
    const wrapper = mount(HomeView)
    expect(wrapper.find('.batch-card.master').exists()).toBe(false)

    progress.mastery = { name: 'Random', level: 'mastery', words: [], size: 10 }
    const wrapper2 = mount(HomeView)
    expect(wrapper2.find('.batch-card.master').exists()).toBe(true)
    expect(wrapper2.find('.batch-card.master').text()).toContain('Random')
  })
})
