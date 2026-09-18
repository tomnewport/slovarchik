import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount } from '@vue/test-utils'

import InflectionCrushView from './InflectionCrushView.vue'
import { state as vocabState } from '../stores/vocab.js'
import { resetProgress } from '../stores/progress.js'
import { loadFixtureWords } from '../test/fixtures.js'
import {
  CHASE_MS_PER_FEATURE,
  MOVES_PER_GAME,
  featuresOf,
  findMatches,
  swapped,
} from '../lib/inflectionCrush.js'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  await resetProgress()
  // fake-indexeddb settles its transactions on setImmediate, which has to stay
  // real; Date is faked with the timers because the chase window is read off a
  // deadline rather than counted down tick by tick.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vocabState.words = loadFixtureWords()
  vocabState.status = 'ready'
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Start a game in `mode` and hand back the mounted view. */
async function play(mode = 'case') {
  const wrapper = mount(InflectionCrushView)
  const button = wrapper.findAll('button.game').find((b) => b.text().includes(label(mode)))
  await button.trigger('click')
  return wrapper
}

const label = (mode) => (mode === 'case' ? 'Cases' : 'Genders')

const tiles = (wrapper) => wrapper.findAll('button.tile')
const cellIndex = (wrapper, r, c) => r * wrapper.vm.grid.cols + c
const tapCell = (wrapper, r, c) => tiles(wrapper)[cellIndex(wrapper, r, c)].trigger('click')

/** The first adjacent pair whose swap would make a line, on the current board. */
function findMove(wrapper) {
  const grid = wrapper.vm.grid
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      for (const b of [
        { r, c: c + 1 },
        { r: r + 1, c },
      ]) {
        if (b.r >= grid.rows || b.c >= grid.cols) continue
        if (findMatches(swapped(grid, { r, c }, b), grid.mode).length) return [{ r, c }, b]
      }
    }
  }
  return null
}

/** Play the first legal swap and let the cascade run out. */
async function makeMove(wrapper) {
  // A chase window left open from the last move would read the taps below as
  // chase taps, so let it lapse first.
  if (wrapper.vm.chase) await vi.advanceTimersByTimeAsync(8000)
  const move = findMove(wrapper)
  expect(move).toBeTruthy()
  await tapCell(wrapper, move[0].r, move[0].c)
  await tapCell(wrapper, move[1].r, move[1].c)
  // Each cascade step waits before the survivors fall. Stop as soon as the
  // board settles rather than advancing a fixed span, which would spend the
  // chase window the move just paid for.
  for (let i = 0; i < 24 && wrapper.vm.busy; i++) await vi.advanceTimersByTimeAsync(300)
  return move
}

describe('InflectionCrushView', () => {
  it('waits on a start screen offering both modes', () => {
    const wrapper = mount(InflectionCrushView)
    expect(tiles(wrapper)).toHaveLength(0)
    expect(wrapper.findAll('button.game').map((b) => b.text())).toHaveLength(2)
    expect(wrapper.text()).toContain('Inflection crush')
  })

  it('deals a stable, playable board of Russian forms', async () => {
    const wrapper = await play('case')
    const grid = wrapper.vm.grid
    expect(tiles(wrapper)).toHaveLength(grid.rows * grid.cols)
    // Pre-generated to be stable: nothing is already three in a line.
    expect(findMatches(grid, 'case')).toEqual([])
    expect(findMove(wrapper)).toBeTruthy()
    expect(tiles(wrapper)[0].text()).toMatch(/[а-яё]/i)
    expect(wrapper.text()).toContain(`${MOVES_PER_GAME} swaps left`)
  })

  it('refuses a swap that would make nothing, and charges no move for it', async () => {
    const wrapper = await play('case')
    const grid = wrapper.vm.grid
    // A pair whose swap makes no line — the board is stable, so most are.
    let dud = null
    for (let r = 0; r < grid.rows && !dud; r++) {
      for (let c = 0; c + 1 < grid.cols && !dud; c++) {
        const pair = [{ r, c }, { r, c: c + 1 }]
        if (!findMatches(swapped(grid, pair[0], pair[1]), 'case').length) dud = pair
      }
    }
    expect(dud).toBeTruthy()

    const before = tiles(wrapper).map((t) => t.text())
    await tapCell(wrapper, dud[0].r, dud[0].c)
    await tapCell(wrapper, dud[1].r, dud[1].c)

    expect(wrapper.vm.moves).toBe(MOVES_PER_GAME)
    expect(tiles(wrapper).map((t) => t.text())).toEqual(before)
    expect(wrapper.findAll('button.tile.rejected')).toHaveLength(2)
  })

  it('clears a line, scores it, spends a move and opens the chase window', async () => {
    const wrapper = await play('case')
    await makeMove(wrapper)

    expect(wrapper.vm.moves).toBe(MOVES_PER_GAME - 1)
    expect(wrapper.vm.score).toBeGreaterThan(0)
    expect(wrapper.vm.chase).toBeTruthy()
    expect(wrapper.vm.chase.features.length).toBeGreaterThanOrEqual(1)
    expect(wrapper.text()).toContain('Chase ')
  })

  it('pays the chase window a second per feature the line fired on', async () => {
    const wrapper = await play('case')
    await makeMove(wrapper)

    const { features } = wrapper.vm.chase
    expect(wrapper.vm.chaseLeft).toBeLessThanOrEqual(features.length * CHASE_MS_PER_FEATURE)
    await vi.advanceTimersByTimeAsync(features.length * CHASE_MS_PER_FEATURE + 100)
    expect(wrapper.vm.chase).toBeNull()
  })

  it('clears a matching tile during the window, scores it and re-opens', async () => {
    const wrapper = await play('case')
    await makeMove(wrapper)

    const { features } = wrapper.vm.chase
    const grid = wrapper.vm.grid
    let hit = null
    for (let r = 0; r < grid.rows && !hit; r++) {
      for (let c = 0; c < grid.cols && !hit; c++) {
        const tile = grid.cells[r * grid.cols + c]
        if (featuresOf(tile, 'case').some((f) => features.includes(f))) hit = { r, c }
      }
    }
    expect(hit).toBeTruthy()

    const before = wrapper.vm.score
    await vi.advanceTimersByTimeAsync(200)
    await tapCell(wrapper, hit.r, hit.c)

    expect(wrapper.vm.score).toBeGreaterThan(before)
    expect(wrapper.vm.chase.streak).toBe(1)
    // The window is fresh again, not what was left of the old one.
    expect(wrapper.vm.chaseLeft).toBeGreaterThan(features.length * CHASE_MS_PER_FEATURE - 100)
  })

  it('closes the window on a tile carrying none of its features', async () => {
    const wrapper = await play('case')
    await makeMove(wrapper)

    const { features } = wrapper.vm.chase
    const grid = wrapper.vm.grid
    let miss = null
    for (let r = 0; r < grid.rows && !miss; r++) {
      for (let c = 0; c < grid.cols && !miss; c++) {
        const tile = grid.cells[r * grid.cols + c]
        if (!featuresOf(tile, 'case').some((f) => features.includes(f))) miss = { r, c }
      }
    }
    // A board with no non-matching tile at all would be a freak; skip rather
    // than assert on one.
    if (!miss) return

    await tapCell(wrapper, miss.r, miss.c)
    expect(wrapper.vm.chase).toBeNull()
  })

  it('marks the tiles a chase tap would score', async () => {
    const wrapper = await play('case')
    await makeMove(wrapper)
    expect(wrapper.findAll('button.tile.target').length).toBeGreaterThan(0)
  })

  it('queues a word card, and holds the last one until it is dismissed', async () => {
    const wrapper = await play('case')
    await tapCell(wrapper, 0, 0)

    expect(wrapper.vm.cards).toHaveLength(1)
    expect(wrapper.find('.word-card').exists()).toBe(true)
    // Nothing waiting behind it, so it stays however long the player looks.
    await vi.advanceTimersByTimeAsync(10000)
    expect(wrapper.vm.cards).toHaveLength(1)

    await wrapper.findAll('.word-card button').find((b) => b.text() === 'Got it').trigger('click')
    expect(wrapper.vm.cards).toHaveLength(0)
  })

  it('steps a card aside after two seconds once another is waiting', async () => {
    const wrapper = await play('case')
    await tapCell(wrapper, 0, 0)
    await tapCell(wrapper, 3, 3)
    expect(wrapper.vm.cards.length).toBeGreaterThanOrEqual(1)
    if (wrapper.vm.cards.length < 2) return // the two tiles were the same word

    const first = wrapper.vm.cards[0].key
    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.vm.cards[0].key).not.toBe(first)
  })

  it('names the word in its dictionary form, not the form on the board', async () => {
    const wrapper = await play('case')
    await tapCell(wrapper, 0, 0)
    const card = wrapper.vm.cards[0]
    expect(wrapper.find('.word-card').text()).toContain(card.lemma)
    expect(wrapper.find('.word-card').text()).toContain(card.en)
    expect(wrapper.find('.word-card').text()).toContain('on the board as')
  })

  it('keeps a card for the summary when the player asks to read it later', async () => {
    const wrapper = await play('case')
    await tapCell(wrapper, 0, 0)
    const saved = wrapper.vm.cards[0]

    await wrapper
      .findAll('.word-card button')
      .find((b) => b.text().includes('Read later'))
      .trigger('click')

    expect(wrapper.vm.cards).toHaveLength(0)
    expect(wrapper.vm.readLater.map((c) => c.key)).toEqual([saved.key])

    wrapper.vm.finish()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Saved to read')
    expect(wrapper.text()).toContain(saved.lemma)
  })

  it('ends the game when the swaps run out', async () => {
    const wrapper = await play('case')
    for (let i = 0; i < MOVES_PER_GAME; i++) await makeMove(wrapper)
    expect(wrapper.vm.moves).toBe(0)
    // The last move's chase window has to lapse before the game is over.
    await vi.advanceTimersByTimeAsync(8000)

    expect(wrapper.vm.phase).toBe('over')
    expect(wrapper.text()).toContain('Out of swaps')
  })

  it('plays the gender board on genders rather than cases', async () => {
    const wrapper = await play('gender')
    expect(wrapper.vm.grid.mode).toBe('gender')
    expect(findMatches(wrapper.vm.grid, 'gender')).toEqual([])
    await makeMove(wrapper)
    expect(wrapper.vm.chase.features.every((f) => ['m', 'f', 'n', 'pl'].includes(f))).toBe(true)
  })

  it('goes back to the start screen on Stop, leaving no timer running', async () => {
    const wrapper = await play('case')
    await makeMove(wrapper)
    await wrapper.findAll('button').find((b) => b.text() === 'Stop').trigger('click')

    expect(wrapper.vm.phase).toBe('idle')
    expect(wrapper.vm.chase).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
