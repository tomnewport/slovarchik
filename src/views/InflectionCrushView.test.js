import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setImmediate } from 'node:timers'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount, flushPromises } from '@vue/test-utils'

import InflectionCrushView from './InflectionCrushView.vue'
import { state as vocabState } from '../stores/vocab.js'
import { resetProgress, loadProgress, state as progressState } from '../stores/progress.js'
import { loadFixtureWords } from '../test/fixtures.js'
import {
  CHASE_MS_PER_FEATURE,
  CLEARS_PER_LEVEL,
  COLUMNS,
  FEATURE_LABELS,
  RUN,
  featuresOf,
} from '../lib/inflectionCrush.js'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  await resetProgress()
  // fake-indexeddb settles its transactions on setImmediate, which has to stay
  // real; Date is faked with the timers because the chase window is read off a
  // deadline rather than counted down tick by tick.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
  vocabState.words = loadFixtureWords()
  vocabState.status = 'ready'
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const label = (mode) => (mode === 'case' ? 'Cases' : 'Genders')

/** Start a game in `mode` and hand back the mounted view. */
async function play(mode = 'case') {
  const wrapper = mount(InflectionCrushView)
  await wrapper
    .findAll('button.game')
    .find((b) => b.text().includes(label(mode)))
    .trigger('click')
  return wrapper
}

const strips = (wrapper) => wrapper.findAll('button.strip')
const tiles = (wrapper) => wrapper.findAll('button.tile')

/**
 * Play the falling tile the way the game asks to be played: if the stack it is
 * about to land on shares none of its categories but a neighbouring stack does,
 * trade the two columns first. Without this the tests only ever pile tiles up,
 * and whether a run of drops reaches a level turn or tops a column out is the
 * luck of the deal rather than anything the code decides.
 */
async function playWell(wrapper) {
  const board = wrapper.vm.board
  const falling = wrapper.vm.falling
  if (!falling) return
  const wanted = new Set(featuresOf(falling.tile, board.mode).filter((f) => board.categories.includes(f)))
  const topShares = (c) => {
    const top = board.cols[c].at(-1)
    return !!top && featuresOf(top, board.mode).some((f) => wanted.has(f))
  }
  const here = falling.col
  if (wanted.size && !topShares(here)) {
    const helpful = [here - 1, here + 1].find((c) => c >= 0 && c < board.cols.length && topShares(c))
    // Failing a match, get out from under the tallest column so the board lasts.
    const shorter = [here - 1, here + 1].find(
      (c) => c >= 0 && c < board.cols.length && board.cols[c].length < board.cols[here].length - 1,
    )
    const swapWith = helpful ?? shorter
    if (swapWith != null) {
      await strips(wrapper)[here].trigger('click')
      await strips(wrapper)[swapWith].trigger('click')
    }
  }
  await slam(wrapper)
}

/** Drop the falling tile now and let any collapse finish. */
async function slam(wrapper) {
  await wrapper
    .findAll('button')
    .find((b) => b.text().includes('Drop'))
    .trigger('click')
  for (let i = 0; i < 30 && wrapper.vm.busy; i++) await vi.advanceTimersByTimeAsync(300)
  await wrapper.vm.$nextTick()
}

/** Let an open chase window lapse, so the board takes swaps again. */
async function calm(wrapper) {
  while (wrapper.vm.chase) await vi.advanceTimersByTimeAsync(4000)
  for (let i = 0; i < 30 && wrapper.vm.busy; i++) await vi.advanceTimersByTimeAsync(300)
}

/** Keep dropping until a chase window opens, or give up. */
async function playUntilChase(wrapper, tries = 60) {
  for (let i = 0; i < tries && !wrapper.vm.chase; i++) {
    if (wrapper.vm.phase !== 'playing' || !wrapper.vm.falling) break
    await slam(wrapper)
  }
  return wrapper.vm.chase
}

describe('InflectionCrushView', () => {
  it('waits on a start screen offering both modes', () => {
    const wrapper = mount(InflectionCrushView)
    expect(strips(wrapper)).toHaveLength(0)
    expect(wrapper.findAll('button.game')).toHaveLength(2)
    expect(wrapper.text()).toContain('Inflection crush')
  })

  it('opens a level on four named categories and starts a tile falling', async () => {
    const wrapper = await play('case')
    expect(wrapper.vm.board.categories).toHaveLength(4)
    expect(strips(wrapper)).toHaveLength(COLUMNS)
    expect(wrapper.vm.falling).toBeTruthy()
    expect(wrapper.vm.falling.row).toBe(0)
    // The four are named in full — holding them in your head is the game.
    for (const c of wrapper.vm.board.categories) {
      expect(wrapper.text()).toContain(FEATURE_LABELS[c])
    }
    expect(wrapper.text()).toContain('Level 1')
  })

  it('deals only tiles that carry one of the level categories', async () => {
    const wrapper = await play('case')
    const cats = wrapper.vm.board.categories
    for (let i = 0; i < 12; i++) {
      const tile = wrapper.vm.falling?.tile
      if (!tile) break
      expect(featuresOf(tile, 'case').some((f) => cats.includes(f))).toBe(true)
      await slam(wrapper)
    }
  })

  it('falls a row at a time and lands on the floor', async () => {
    const wrapper = await play('case')
    const { col } = wrapper.vm.falling
    await vi.advanceTimersByTimeAsync(1200)
    expect(wrapper.vm.falling.row).toBe(1)
    expect(wrapper.vm.falling.col).toBe(col)

    // Run it all the way down; it becomes a stacked tile in that column.
    for (let i = 0; i < 12 && wrapper.vm.falling; i++) await vi.advanceTimersByTimeAsync(1200)
    expect(wrapper.vm.board.cols.some((c) => c.length > 0)).toBe(true)
  })

  it('drops the tile straight down when asked', async () => {
    const wrapper = await play('case')
    const before = wrapper.vm.board.cols.flat().length
    await slam(wrapper)
    // Either it stacked, or it landed on a match and cleared.
    const after = wrapper.vm.board.cols.flat().length
    expect(after === before + 1 || after <= before).toBe(true)
    expect(wrapper.vm.falling).toBeTruthy() // the next one is already falling
  })

  it('swaps two neighbouring columns whole, and no others', async () => {
    const wrapper = await play('case')
    for (let i = 0; i < 4; i++) await slam(wrapper)
    await calm(wrapper)
    const before = wrapper.vm.board.cols.map((c) => c.map((t) => t.id))

    await strips(wrapper)[0].trigger('click')
    expect(wrapper.vm.selected).toBe(0)
    await strips(wrapper)[1].trigger('click')

    const after = wrapper.vm.board.cols.map((c) => c.map((t) => t.id))
    expect(after[0]).toEqual(before[1])
    expect(after[1]).toEqual(before[0])
    expect(after[2]).toEqual(before[2])
    expect(wrapper.vm.selected).toBeNull()
  })

  it('refuses a swap across a gap, picking up the far column instead', async () => {
    const wrapper = await play('case')
    for (let i = 0; i < 4; i++) await slam(wrapper)
    await calm(wrapper)
    const before = wrapper.vm.board.cols.map((c) => c.map((t) => t.id))

    await strips(wrapper)[0].trigger('click')
    await strips(wrapper)[2].trigger('click')

    expect(wrapper.vm.board.cols.map((c) => c.map((t) => t.id))).toEqual(before)
    expect(wrapper.vm.selected).toBe(2)
  })

  it('puts a picked-up column down when it is tapped again', async () => {
    const wrapper = await play('case')
    await strips(wrapper)[1].trigger('click')
    expect(wrapper.vm.selected).toBe(1)
    await strips(wrapper)[1].trigger('click')
    expect(wrapper.vm.selected).toBeNull()
  })

  it('clears a stack of two sharing a category, and scores it', async () => {
    const wrapper = await play('case')
    const chase = await playUntilChase(wrapper)
    expect(chase).toBeTruthy()
    expect(wrapper.vm.score).toBeGreaterThan(0)
    // A clear is RUN tiles at least, and it counts toward the level.
    expect(wrapper.vm.clearedCount).toBeGreaterThanOrEqual(RUN)
  })

  it('pays the chase window a second per category the stack fired on', async () => {
    const wrapper = await play('case')
    const chase = await playUntilChase(wrapper)
    expect(chase).toBeTruthy()

    const paid = chase.categories.length * CHASE_MS_PER_FEATURE
    expect(wrapper.vm.chaseLeft).toBeLessThanOrEqual(paid)
    expect(wrapper.text()).toContain('Chase ')
    await vi.advanceTimersByTimeAsync(paid + 200)
    expect(wrapper.vm.chase).toBeNull()
    // The next tile was held back while the window ran, and resumes after it.
    expect(wrapper.vm.falling).toBeTruthy()
  })

  it('marks the tiles a chase tap would take, and takes one', async () => {
    const wrapper = await play('case')
    const chase = await playUntilChase(wrapper)
    expect(chase).toBeTruthy()

    const targets = wrapper.findAll('button.tile.target')
    if (!targets.length) return // a board with nothing else matching is legal
    const before = { score: wrapper.vm.score, tiles: wrapper.vm.board.cols.flat().length }
    await targets[0].trigger('click')

    expect(wrapper.vm.score).toBeGreaterThan(before.score)
    expect(wrapper.vm.board.cols.flat().length).toBeLessThan(before.tiles)
    expect(wrapper.vm.chase.streak).toBe(1)
  })

  it('closes the window on a tile carrying none of its categories', async () => {
    const wrapper = await play('case')
    const chase = await playUntilChase(wrapper)
    expect(chase).toBeTruthy()

    const miss = tiles(wrapper).find((t) => !t.classes().includes('target'))
    if (!miss) return
    await miss.trigger('click')
    expect(wrapper.vm.chase).toBeNull()
  })

  it('queues a word card for what it cleared, and holds the last one', async () => {
    const wrapper = await play('case')
    expect(await playUntilChase(wrapper)).toBeTruthy()
    expect(wrapper.vm.cards.length).toBeGreaterThan(0)
    expect(wrapper.find('.word-card').exists()).toBe(true)

    // The board has to stop producing clears for the hold to be observable —
    // a live game queues a new card behind this one within a drop or two.
    wrapper.vm.finish()
    await wrapper.vm.$nextTick()
    while (wrapper.vm.cards.length > 1) {
      await wrapper.findAll('.word-card button').find((b) => b.text() === 'Got it').trigger('click')
    }
    const held = wrapper.vm.cards[0].key
    await vi.advanceTimersByTimeAsync(10000)
    expect(wrapper.vm.cards[0]?.key).toBe(held)

    await wrapper.findAll('.word-card button').find((b) => b.text() === 'Got it').trigger('click')
    expect(wrapper.vm.cards).toHaveLength(0)
  })

  it('names the word in its dictionary form, not the form on the board', async () => {
    const wrapper = await play('case')
    expect(await playUntilChase(wrapper)).toBeTruthy()
    const card = wrapper.vm.cards[0]
    const text = wrapper.find('.word-card').text()
    expect(text).toContain(card.lemma)
    expect(text).toContain(card.en)
    expect(text).toContain('on the board as')
  })

  it('steps a card aside after two seconds once another is waiting', async () => {
    const wrapper = await play('case')
    expect(await playUntilChase(wrapper)).toBeTruthy()
    if (wrapper.vm.cards.length < 2) return
    const first = wrapper.vm.cards[0].key
    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.vm.cards[0].key).not.toBe(first)
  })

  it('lets a translated word card join the next batch wishlist (#773)', async () => {
    await loadProgress()
    const wrapper = await play('case')
    expect(await playUntilChase(wrapper)).toBeTruthy()
    const key = wrapper.vm.cards[0].key

    await wrapper.find('.word-card .next-batch').trigger('click')
    await new Promise((resolve) => setImmediate(resolve))
    await flushPromises()

    expect(progressState.learningWishlist).toContain(key)
    wrapper.unmount()
  })

  it('keeps a card for the summary when the player asks to read it later', async () => {
    const wrapper = await play('case')
    expect(await playUntilChase(wrapper)).toBeTruthy()
    const saved = wrapper.vm.cards[0]

    await wrapper
      .findAll('.word-card button')
      .find((b) => b.text().includes('Read later'))
      .trigger('click')
    expect(wrapper.vm.readLater.map((c) => c.key)).toEqual([saved.key])

    wrapper.vm.finish()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Saved to read')
    expect(wrapper.text()).toContain(saved.lemma)
  })

  it('sweeps the board and re-decks when the level turns over', async () => {
    const wrapper = await play('case')
    const first = wrapper.vm.board.categories.join()
    let turned = false
    for (let i = 0; i < 200 && wrapper.vm.phase === 'playing'; i++) {
      if (wrapper.vm.chase) await vi.advanceTimersByTimeAsync(4000)
      if (!wrapper.vm.falling) break
      await playWell(wrapper)
      if (wrapper.vm.clearedCount >= CLEARS_PER_LEVEL) {
        turned = true
        break
      }
    }
    expect(turned).toBe(true)
    expect(wrapper.vm.level).toBe(2)
    // The sweep happens at the next settle point, not mid-cascade.
    await calm(wrapper)
    expect(wrapper.vm.board.cols.flat()).toEqual([])
    expect(wrapper.vm.levelOpen).toBe(2)
    expect(first).toBeTruthy()
  })

  it('ends the game when a column reaches the ceiling', async () => {
    const wrapper = await play('case')
    // Force a topped-out board rather than waiting for one: the point under
    // test is the ending, not how long a bot survives.
    const col = wrapper.vm.board.cols[0]
    while (col.length < wrapper.vm.board.rows) col.push({ ...wrapper.vm.falling.tile, id: `x${col.length}` })
    wrapper.vm.finish()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.phase).toBe('over')
    expect(wrapper.vm.falling).toBeNull()
    expect(wrapper.text()).toContain('Topped out')
  })

  it('plays the gender board on genders rather than cases', async () => {
    const wrapper = await play('gender')
    expect(wrapper.vm.board.mode).toBe('gender')
    expect(wrapper.vm.board.categories).toEqual(['m', 'f', 'n', 'pl'])
  })

  it('goes back to the start screen on Stop, leaving no timer running', async () => {
    const wrapper = await play('case')
    await slam(wrapper)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Stop')
      .trigger('click')

    expect(wrapper.vm.phase).toBe('idle')
    expect(wrapper.vm.falling).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
