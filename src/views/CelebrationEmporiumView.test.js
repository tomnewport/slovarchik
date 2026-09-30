import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount } from '@vue/test-utils'

import CelebrationEmporiumView from './CelebrationEmporiumView.vue'
import { BAKE_MS } from '../lib/celebrationEmporium.js'

// The view asks the real generator for its customers; this keeps a record of
// who came in, so a test knows which cake each one wants without a stub that
// could say something the generator never would.
const arrivals = []
vi.mock('../lib/celebrationEmporium.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    nextCustomer: (opts) => {
      const customer = actual.nextCustomer(opts)
      arrivals.push(customer)
      return customer
    },
  }
})

const cakes = (wrapper) => wrapper.findAll('button.cake:not(.empty)')
const customers = (wrapper) => wrapper.findAll('button.customer:not(.empty)')
const cakeTagged = (wrapper, value) => cakes(wrapper).find((c) => c.find('.tag').text() === String(value))

async function openShop(wrapper) {
  await wrapper.find('button.primary').trigger('click')
}

async function dial(wrapper, number) {
  for (const d of String(number)) {
    await wrapper.findAll('.keypad button').find((b) => b.text() === d).trigger('click')
  }
  await wrapper.find('button[aria-label="Order this cake"]').trigger('click')
}

beforeEach(() => {
  arrivals.length = 0
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CelebrationEmporiumView', () => {
  it('opens with a full cabinet and a customer who wants a cake on it', async () => {
    const wrapper = mount(CelebrationEmporiumView)
    await openShop(wrapper)
    expect(cakes(wrapper)).toHaveLength(9)
    expect(customers(wrapper)).toHaveLength(1)
    // No voice under test, so the order is written down, in Russian.
    expect(customers(wrapper)[0].find('.bubble.written').text()).toBe(arrivals[0].ru)
    expect(cakeTagged(wrapper, arrivals[0].value)).toBeTruthy()
  })

  it('serves the right cake and bins the wrong one', async () => {
    const wrapper = mount(CelebrationEmporiumView)
    await openShop(wrapper)
    const wanted = arrivals[0].value

    const wrong = cakes(wrapper).find((c) => c.find('.tag').text() !== String(wanted))
    await wrong.trigger('click')
    await customers(wrapper)[0].trigger('click')
    expect(wrapper.text()).toContain('🗑 1')
    expect(customers(wrapper)).toHaveLength(1)
    expect(cakes(wrapper)).toHaveLength(8)

    await cakeTagged(wrapper, wanted).trigger('click')
    await customers(wrapper)[0].trigger('click')
    expect(wrapper.text()).toContain('Served 1')
    expect(customers(wrapper)).toHaveLength(0)
    expect(cakes(wrapper)).toHaveLength(7)
  })

  it('bakes a dialled cake onto a free shelf, and refuses one it cannot bake', async () => {
    const wrapper = mount(CelebrationEmporiumView)
    await openShop(wrapper)
    await dial(wrapper, 5000)
    expect(wrapper.find('.refusal').text()).toContain('No cake for 5000')

    // Make room, then order.
    await cakes(wrapper)[0].trigger('click')
    await customers(wrapper)[0].trigger('click')
    const free = cakeTagged(wrapper, 1926) ? 1927 : 1926
    await dial(wrapper, free)
    expect(wrapper.find('.orders').text()).toContain(String(free))
    await vi.advanceTimersByTimeAsync(BAKE_MS + 200)
    expect(cakeTagged(wrapper, free)).toBeTruthy()
    expect(wrapper.find('.orders').exists()).toBe(false)
  })

  it('closes the day when nine customers are left waiting', async () => {
    const wrapper = mount(CelebrationEmporiumView)
    await openShop(wrapper)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(customers(wrapper)).toHaveLength(9)
    expect(wrapper.text()).toContain('The shop is full')
    // The clock stops with the shop: nobody else comes in.
    const count = arrivals.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(arrivals).toHaveLength(count)
  })
})
