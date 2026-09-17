import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount } from '@vue/test-utils'

import BombDisposalView from './BombDisposalView.vue'
import { COLORS, resolvePlan, stageTargets } from '../lib/bombDisposal.js'

/** A seedable RNG, so a failing run names a board we can rebuild. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The view calls `generateBomb(round)` with no RNG of its own. Rather than
// stub out a fake bomb — which would test the view against a board the
// generator cannot actually produce — feed the real generator a seeded source.
const rng = { next: mulberry32(1) }
vi.mock('../lib/bombDisposal.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, generateBomb: (round) => actual.generateBomb(round, rng.next) }
})

/** Pretend a Russian voice is installed, so the view speaks rather than prints. */
function giveRussianVoice() {
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text
    }
  }
  window.speechSynthesis = {
    getVoices: () => [{ lang: 'ru-RU' }],
    cancel: vi.fn(),
    speak: vi.fn(),
  }
}

async function start(wrapper) {
  await wrapper.find('button.primary').trigger('click')
}

/** The wire buttons, in the order the board lays them out. */
const wireButtons = (wrapper) => wrapper.findAll('button.wire')

/** Cut `id` by finding the button whose wire it is. */
async function cutById(wrapper, id) {
  const index = wrapper.vm.bomb.wires.findIndex((w) => w.id === id)
  await wireButtons(wrapper)[index].trigger('click')
}

/** Every wire the current plan asks for, in a safe cutting order. */
const safeOrder = (wrapper) =>
  stageTargets(resolvePlan(wrapper.vm.bomb.rule, wrapper.vm.bomb.wires), wrapper.vm.bomb.wires).flat()

beforeEach(() => {
  // The view reads the feedback-sound settings on mount, which is an
  // IndexedDB read.
  globalThis.indexedDB = new IDBFactory()
  rng.next = mulberry32(1)
  // Only the timers the view itself uses: fake-indexeddb completes its
  // transactions on setImmediate, which must stay real.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

afterEach(() => {
  vi.useRealTimers()
  delete window.speechSynthesis
  delete window.SpeechSynthesisUtterance
  vi.restoreAllMocks()
})

describe('BombDisposalView', () => {
  it('waits on a start screen, then arms a bomb with one button per wire', async () => {
    const wrapper = mount(BombDisposalView)
    expect(wireButtons(wrapper)).toHaveLength(0)

    await start(wrapper)
    expect(wrapper.vm.bomb.wires.length).toBeGreaterThanOrEqual(2)
    expect(wireButtons(wrapper)).toHaveLength(wrapper.vm.bomb.wires.length)
    expect(wrapper.text()).toContain('Round 1')
  })

  it('advances to the next round when every named wire is cut in order', async () => {
    const wrapper = mount(BombDisposalView)
    await start(wrapper)

    for (const id of safeOrder(wrapper)) await cutById(wrapper, id)

    expect(wrapper.vm.phase).toBe('defused')
    expect(wrapper.text()).toContain('Defused')

    vi.advanceTimersByTime(1200)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.round).toBe(2)
    expect(wrapper.vm.phase).toBe('armed')
  })

  it('blows up on a wire the instruction never named', async () => {
    // A round-one board is an ordered pair on two or three wires, so keep
    // arming until one turns up with a wire to spare.
    let wrapper = null
    let spare = null
    for (let attempt = 0; attempt < 30 && !spare; attempt += 1) {
      wrapper = mount(BombDisposalView)
      await start(wrapper)
      const targets = safeOrder(wrapper)
      spare = wrapper.vm.bomb.wires.find((w) => !targets.includes(w.id))
    }
    expect(spare).toBeTruthy()

    await cutById(wrapper, spare.id)
    expect(wrapper.vm.phase).toBe('boom')
    expect(wrapper.text()).toContain('never in the instruction')
  })

  it('blows up on the right wire at the wrong moment', async () => {
    const wrapper = mount(BombDisposalView)
    await start(wrapper)

    const order = safeOrder(wrapper)
    // Round 1 is always an ordered pair, so the second wire is premature.
    expect(order.length).toBeGreaterThanOrEqual(2)
    await cutById(wrapper, order[order.length - 1])

    expect(wrapper.vm.phase).toBe('boom')
    expect(wrapper.text()).toContain('wrong moment')
  })

  it('blows up when the clock runs out, and stops counting', async () => {
    const wrapper = mount(BombDisposalView)
    await start(wrapper)

    vi.advanceTimersByTime(wrapper.vm.bomb.seconds * 1000 + 200)
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.phase).toBe('boom')
    expect(wrapper.text()).toContain('Out of time')

    const atBang = wrapper.vm.msLeft
    vi.advanceTimersByTime(5000)
    expect(wrapper.vm.msLeft).toBe(atBang)
  })

  it('keeps the instruction off the screen while it can be heard', async () => {
    giveRussianVoice()
    const wrapper = mount(BombDisposalView)
    await start(wrapper)

    expect(wrapper.vm.canHear).toBe(true)
    expect(wrapper.find('.instruction').exists()).toBe(false)
    expect(window.speechSynthesis.speak).toHaveBeenCalled()
  })

  it('writes the instruction out when there is no Russian voice to hear it from', async () => {
    const wrapper = mount(BombDisposalView)
    await start(wrapper)

    expect(wrapper.vm.canHear).toBe(false)
    expect(wrapper.find('.instruction').text()).toBe(wrapper.vm.bomb.ru)
    expect(wrapper.text()).toContain('No Russian voice is installed')
  })

  it('reveals the Russian on request, and the translation only after that', async () => {
    giveRussianVoice()
    const wrapper = mount(BombDisposalView)
    await start(wrapper)

    const reveal = wrapper.findAll('button').find((b) => b.text().includes('Show it in writing'))
    await reveal.trigger('click')
    expect(wrapper.find('.instruction').text()).toBe(wrapper.vm.bomb.ru)
    expect(wrapper.text()).not.toContain(wrapper.vm.bomb.en)

    const translate = wrapper.findAll('button').find((b) => b.text().includes('Translate'))
    await translate.trigger('click')
    expect(wrapper.text()).toContain(wrapper.vm.bomb.en)
  })

  it('never names a colour in English on screen — recognising it is the game', async () => {
    giveRussianVoice()
    const wrapper = mount(BombDisposalView)
    await start(wrapper)

    // aria-label carries the English description for screen readers, which
    // cannot see the colours; strip the attributes before reading the page.
    const visible = wrapper.html().replace(/aria-label="[^"]*"/g, '')
    for (const w of wrapper.vm.bomb.wires) {
      expect(visible).not.toContain(COLORS[w.color].en)
    }
    // …and it really is on the button, or the game is unplayable blind.
    const labels = wireButtons(wrapper).map((b) => b.attributes('aria-label'))
    expect(labels.every((l) => l && l.includes('wire'))).toBe(true)
  })

  it('ignores a second click on a wire already cut', async () => {
    const wrapper = mount(BombDisposalView)
    await start(wrapper)

    const [first] = safeOrder(wrapper)
    await cutById(wrapper, first)
    await cutById(wrapper, first)

    expect(wrapper.vm.phase).toBe('armed')
    expect(wrapper.vm.cut).toEqual([first])
  })

  it('stops the clock when the view goes away', async () => {
    const wrapper = mount(BombDisposalView)
    await start(wrapper)
    const before = wrapper.vm.msLeft

    wrapper.unmount()
    vi.advanceTimersByTime(3000)

    expect(before).toBeGreaterThan(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
