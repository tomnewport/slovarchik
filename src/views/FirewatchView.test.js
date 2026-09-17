import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'

import FirewatchView from './FirewatchView.vue'

// jsdom has no 2D context, so nothing this view draws runs here — which is the
// point of keeping the simulation in src/lib/firewatch.js. What is testable is
// everything between the learner and that simulation: what the typing is read
// as, what a tap on the map says, and how a round starts and ends.

/** Give the canvas a size, so a pointer position maps onto a cell. */
function sizeMap(wrapper, px = 400) {
  const canvas = wrapper.find('canvas.board').element
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: px,
    height: px,
    right: px,
    bottom: px,
  })
  return canvas
}

/**
 * Point at the map. Dispatched rather than `trigger`ed because test-utils
 * builds its events by assigning the properties afterwards, and clientX on a
 * MouseEvent is read-only.
 */
async function point(canvas, type, clientX, clientY, buttons = 1) {
  canvas.dispatchEvent(new MouseEvent(type, { clientX, clientY, buttons, bubbles: true }))
  await nextTick()
}

async function start(wrapper) {
  await wrapper.find('button.primary').trigger('click')
}

const hint = (wrapper) => wrapper.find('p.parse').text()

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('starting a round', () => {
  it('explains the game before it starts one', () => {
    const wrapper = mount(FirewatchView)
    expect(wrapper.text()).toContain('Firewatch')
    expect(wrapper.find('canvas').exists()).toBe(false)
  })

  it('puts up the map, the box and the clock', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    expect(wrapper.find('canvas.board').exists()).toBe(true)
    expect(wrapper.find('input[lang="ru"]').exists()).toBe(true)
    expect(wrapper.find('.hud').text()).toContain('120s')
  })

  it('rules the map every ten squares, on both axes', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    const x = wrapper.findAll('.axis.x span').map((s) => s.text())
    const y = wrapper.findAll('.axis.y span').map((s) => s.text())
    expect(x).toEqual(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90'])
    expect(y).toEqual(x)
  })
})

describe('reading what was typed', () => {
  it('says what the words spell, as they are typed', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    const box = wrapper.find('input[lang="ru"]')

    expect(hint(wrapper)).toContain('Two numbers')
    await box.setValue('со́рок')
    expect(hint(wrapper)).toBe('→ X 40 · Y …')
    await box.setValue('со́рок три')
    expect(hint(wrapper)).toBe('→ X 43 · Y …')
    await box.setValue('со́рок три два́дцать')
    expect(hint(wrapper)).toBe('→ X 43 · Y 20')
  })

  it('says so when the words are not a number, rather than going quiet', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    await wrapper.find('input[lang="ru"]').setValue('соба́ка')
    expect(hint(wrapper)).toContain('Not a number')
    expect(wrapper.find('p.parse').classes()).toContain('bad')
  })

  it('refuses a third number', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    await wrapper.find('input[lang="ru"]').setValue('оди́н два три')
    expect(hint(wrapper)).toContain('Two numbers, not more')
  })

  it('accepts the numbers without their stress marks', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    await wrapper.find('input[lang="ru"]').setValue('девяносто девять ноль')
    expect(hint(wrapper)).toBe('→ X 99 · Y 0')
  })
})

describe('sending a plane', () => {
  it('will not send until the box spells a whole coordinate', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    const button = wrapper.find('button[type="submit"]')
    expect(button.attributes('disabled')).toBeDefined()
    await wrapper.find('input[lang="ru"]').setValue('со́рок три')
    expect(button.attributes('disabled')).toBeDefined()
    await wrapper.find('input[lang="ru"]').setValue('со́рок три два́дцать')
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('sends it and clears the box, ready for the next one', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    await wrapper.find('input[lang="ru"]').setValue('со́рок три два́дцать')
    await wrapper.find('form.send').trigger('submit')
    expect(wrapper.vm.sent).toBe(1)
    expect(wrapper.find('input[lang="ru"]').element.value).toBe('')
  })

  it('sends nothing when the box is not a coordinate', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    await wrapper.find('input[lang="ru"]').setValue('соба́ка')
    await wrapper.find('form.send').trigger('submit')
    expect(wrapper.vm.sent).toBe(0)
  })
})

describe('reading a coordinate off the map', () => {
  it('starts by inviting a tap', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    expect(wrapper.find('.readout').text()).toContain('Tap the map')
  })

  it('names the square that was tapped', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    const canvas = sizeMap(wrapper, 400) // 4px a square
    await point(canvas, 'pointerdown', 174, 82)
    expect(wrapper.vm.marker).toEqual({ x: 43, y: 20 })
    expect(wrapper.find('.readout').text()).toContain('X 43')
    expect(wrapper.find('.readout').text()).toContain('Y 20')
  })

  it('follows a drag, but not a hover with nothing pressed', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    const canvas = sizeMap(wrapper, 400)
    await point(canvas, 'pointerdown', 174, 82)
    await point(canvas, 'pointermove', 10, 10, 0)
    expect(wrapper.vm.marker).toEqual({ x: 43, y: 20 })
    await point(canvas, 'pointermove', 10, 10, 1)
    expect(wrapper.vm.marker).toEqual({ x: 2, y: 2 })
  })

  it('keeps a tap on the edge inside the map', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    const canvas = sizeMap(wrapper, 400)
    await point(canvas, 'pointerdown', -20, 900)
    expect(wrapper.vm.marker).toEqual({ x: 0, y: 99 })
  })

  it('offers the Russian for the coordinate, but only when asked', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    const canvas = sizeMap(wrapper, 400)
    await point(canvas, 'pointerdown', 174, 82)
    expect(wrapper.find('.readout').text()).not.toContain('со́рок')

    const toggle = wrapper.findAll('button').find((b) => b.text().includes('Show the words'))
    await toggle.trigger('click')
    expect(wrapper.find('.readout').text()).toContain('со́рок три')
    expect(wrapper.find('.readout').text()).toContain('два́дцать')
  })
})

describe('ending a round', () => {
  it('scores the forest and offers another go', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    const stop = wrapper.findAll('button').find((b) => b.text() === 'Stop')
    await stop.trigger('click')
    expect(wrapper.find('.feedback').text()).toContain('% of the forest still standing')
    expect(wrapper.find('form.send').exists()).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Again')).toBe(true)
  })

  it('remembers the best run once the game is put away', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    await wrapper.findAll('button').find((b) => b.text() === 'Stop').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'Stop').trigger('click')
    expect(wrapper.text()).toContain('Best run')
    expect(wrapper.find('canvas').exists()).toBe(false)
  })
})
