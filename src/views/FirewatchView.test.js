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
/** Just the coordinate the box has understood so far. */
const hintCoord = (wrapper) => wrapper.find('p.parse .coord').text()

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

    // Nothing typed: a worked example of the rule, not an instruction.
    expect(hint(wrapper)).toContain('1203')
    expect(hint(wrapper)).toContain('ты́сяча две́сти три')
    // The number assembles itself as the words arrive.
    await box.setValue('ты́сяча')
    expect(hintCoord(wrapper)).toBe('1000')
    await box.setValue('ты́сяча две́сти')
    expect(hintCoord(wrapper)).toBe('1200')
    await box.setValue('ты́сяча две́сти три')
    expect(hintCoord(wrapper)).toBe('1203')
    expect(hint(wrapper)).toContain('→')
  })

  it('says so when the words are not a number, rather than going quiet', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    await wrapper.find('input[lang="ru"]').setValue('соба́ка')
    expect(hint(wrapper)).toContain('Not a number')
    expect(wrapper.find('p.parse').classes()).toContain('bad')
  })

  it('refuses the halves said separately, and says why', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    // The habit the drill exists to replace: reading 4320 off the two axes.
    await wrapper.find('input[lang="ru"]').setValue('со́рок три два́дцать')
    expect(hint(wrapper)).toContain('One number for the whole square')
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('accepts the numbers without their stress marks', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    await wrapper.find('input[lang="ru"]').setValue('девять тысяч девятьсот девяносто девять')
    expect(hintCoord(wrapper)).toBe('9999')
  })
})

describe('sending a plane', () => {
  it('will not send until the box spells a whole coordinate', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    const button = wrapper.find('button[type="submit"]')
    expect(button.attributes('disabled')).toBeDefined()
    await wrapper.find('input[lang="ru"]').setValue('соба́ка')
    expect(button.attributes('disabled')).toBeDefined()
    await wrapper.find('input[lang="ru"]').setValue('четы́ре ты́сячи три́дцать два')
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('sends it and clears the box, ready for the next one', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    await wrapper.find('input[lang="ru"]').setValue('четы́ре ты́сячи три́дцать два')
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

describe('the four-digit coordinate', () => {
  it('pads a small number, so the shape is always four digits', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    await wrapper.find('input[lang="ru"]').setValue('семь')
    expect(hintCoord(wrapper)).toBe('0007')
  })

  it('tints each half to match the axis it is read off', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    sizeMap(wrapper, 400)
    await point(wrapper.find('canvas.board').element, 'pointerdown', 174, 82)
    expect(wrapper.find('.readout .across').text()).toBe('43')
    expect(wrapper.find('.readout .down').text()).toBe('20')
    // The same two classes carry the ticks, which is the whole explanation.
    expect(wrapper.findAll('.axis.x span').length).toBeGreaterThan(0)
    expect(wrapper.find('.axis.x').classes()).toContain('x')
  })
})

describe('the fleet', () => {
  it('starts with two planes and puts the first two straight in the air', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    expect(wrapper.vm.fleet).toBe(2)
    for (const where of ['тысяча', 'две тысячи']) {
      await wrapper.find('input[lang="ru"]').setValue(where)
      await wrapper.find('form.send').trigger('submit')
    }
    expect(wrapper.vm.inAir).toBe(2)
    expect(wrapper.vm.queued).toHaveLength(0)
    expect(wrapper.vm.sent).toBe(2)
  })

  it('queues the rest, so typing never has to wait for a plane', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    for (const where of ['тысяча', 'две тысячи', 'три тысячи тридцать']) {
      await wrapper.find('input[lang="ru"]').setValue(where)
      await wrapper.find('form.send').trigger('submit')
    }
    expect(wrapper.vm.inAir).toBe(2)
    expect(wrapper.vm.queued).toEqual([{ x: 30, y: 30 }])
    expect(wrapper.find('.queue').text()).toContain('3030')
    // The box is empty and ready either way.
    expect(wrapper.find('input[lang="ru"]').element.value).toBe('')
  })

  it('turns away a coordinate once the queue is full, rather than hoarding them', async () => {
    const wrapper = mount(FirewatchView)
    await start(wrapper)
    for (let n = 0; n < 12; n++) {
      await wrapper.find('input[lang="ru"]').setValue('тысяча')
      await wrapper.find('form.send').trigger('submit')
    }
    expect(wrapper.vm.queued.length).toBeLessThanOrEqual(6)
    // The one that bounced is still in the box to try again.
    expect(wrapper.find('input[lang="ru"]').element.value).toBe('тысяча')
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
    // The four digits to say, not a pair to assemble.
    expect(wrapper.find('.readout .coord').text()).toBe('4320')
    expect(wrapper.find('.readout').text()).not.toContain('X 43')
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
    expect(wrapper.find('.readout').text()).not.toContain('ты́сячи')

    const toggle = wrapper.findAll('button').find((b) => b.text().includes('Show the words'))
    await toggle.trigger('click')
    // 4320, said whole — not «со́рок три» and «два́дцать».
    expect(wrapper.find('.readout').text()).toContain('четы́ре ты́сячи три́ста два́дцать')
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
