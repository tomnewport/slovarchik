import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount, flushPromises } from '@vue/test-utils'

import MeaningMazeView from './MeaningMazeView.vue'
import * as idb from '../lib/idb.js'
import * as progress from '../stores/progress.js'
import { state } from '../stores/vocab.js'
import { loadFixtureWords } from '../test/fixtures.js'
import { neighbours } from '../lib/meaningMaze.js'

// The real corpus, so the board is built from the words the game actually
// draws on rather than a stand-in that could not fill it.
beforeAll(() => {
  state.words = loadFixtureWords()
  state.status = 'ready'
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Mount and start a small board. 13 × 13 rather than the default 25, because a
 * board is one DOM node per cell and the size under test is the behaviour, not
 * the cell count.
 */
async function play() {
  const wrapper = mount(MeaningMazeView)
  wrapper.vm.size = 13
  await wrapper.vm.$nextTick()
  await wrapper.find('button.primary').trigger('click')
  await wrapper.vm.$nextTick()
  return wrapper
}

/** A cell's text as the DOM shows it: no soft hyphens, no start/exit marker. */
const plain = (text) => text.replace(/[\u00ad\u{1F6A9}\u{1F3C1}]/gu, '')

/** The lens tile showing a given cell. */
const tile = (wrapper, cell) =>
  wrapper.findAll('.lens-cell').find((b) => plain(b.text()) === cell.text)

describe('MeaningMazeView', () => {
  it('explains both halves of the rule before it starts', () => {
    const wrapper = mount(MeaningMazeView)
    expect(wrapper.text()).toContain('only to its English translation')
    expect(wrapper.text()).toContain('any Russian word beside it, free')
    expect(wrapper.text()).toContain('Every Russian word has its translation beside it')
    expect(wrapper.find('#maze-size').exists()).toBe(true)
  })

  it('offers only the sizes the dictionary can fill', () => {
    const wrapper = mount(MeaningMazeView)
    expect(wrapper.vm.sizes).toEqual([13, 17, 25])
  })

  it('starts with every level in play, and narrows the pool as they come off', () => {
    const wrapper = mount(MeaningMazeView)
    expect(wrapper.vm.levels).toEqual(['A1', 'A2', 'B1'])
    const all = wrapper.vm.pool.length
    wrapper.vm.toggleLevel('B1')
    expect(wrapper.vm.levels).toEqual(['A1', 'A2'])
    expect(wrapper.vm.pool.length).toBeLessThan(all)
    wrapper.vm.toggleLevel('B1')
    expect(wrapper.vm.pool.length).toBe(all)
  })

  it('keeps at least one level on: an empty selection is no game', () => {
    const wrapper = mount(MeaningMazeView)
    for (const level of ['A2', 'B1', 'A1']) wrapper.vm.toggleLevel(level)
    expect(wrapper.vm.levels).toEqual(['A1'])
    wrapper.vm.toggleLevel('A1')
    expect(wrapper.vm.levels).toEqual(['A1'])
  })

  it('drops a board the chosen levels can no longer fill, rather than lying about it', async () => {
    const wrapper = mount(MeaningMazeView)
    expect(wrapper.vm.size).toBe(25)
    // A1 alone is a few hundred words — not the 625 a full board needs.
    wrapper.vm.toggleLevel('A2')
    wrapper.vm.toggleLevel('B1')
    expect(wrapper.vm.sizes).not.toContain(25)
    expect(wrapper.vm.sizes).toContain(wrapper.vm.size)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('the bigger boards are off the list')
    expect(wrapper.findAll('#maze-size option').map((o) => o.text())).toEqual(
      wrapper.vm.sizes.map((s) => `${s} × ${s}`),
    )
  })

  it('builds a board from the levels in play, and from no others', async () => {
    const wrapper = mount(MeaningMazeView)
    wrapper.vm.toggleLevel('A1')
    wrapper.vm.toggleLevel('A2')
    wrapper.vm.size = 13
    await wrapper.vm.$nextTick()
    await wrapper.find('button.primary').trigger('click')
    const keys = new Set(wrapper.vm.maze.cells.map((c) => c.key))
    const levelOf = new Map(state.words.map((w) => [w.key, w.cefr]))
    for (const key of keys) expect(levelOf.get(key)).toBe('B1')
  })

  it('turns a level on by tapping its chip', async () => {
    const wrapper = mount(MeaningMazeView)
    const chip = wrapper.findAll('.level').find((b) => b.text() === 'B1')
    expect(chip.attributes('aria-pressed')).toBe('true')
    await chip.trigger('click')
    expect(chip.attributes('aria-pressed')).toBe('false')
    expect(wrapper.vm.levels).toEqual(['A1', 'A2'])
  })

  it('waits for the dictionary rather than starting on an empty board', async () => {
    const words = state.words
    state.words = []
    const wrapper = mount(MeaningMazeView)
    expect(wrapper.text()).toContain('Loading the dictionary')
    expect(wrapper.find('button.primary').exists()).toBe(false)
    state.words = words
  })

  it('lays out a board with the line starting in the corner', async () => {
    const wrapper = await play()
    expect(wrapper.findAll('.board .cell')).toHaveLength(169)
    expect(wrapper.vm.maze.deadEnds).toBe(0)
    expect(wrapper.vm.path).toEqual([wrapper.vm.maze.start])
    expect(wrapper.vm.maze.start).toBe(0)
    expect(wrapper.find('.clock').text()).toMatch(/^\d+:\d\d$/)
  })

  it('draws a link to a correct translation, from the magnifier', async () => {
    const wrapper = await play()
    const next = wrapper.vm.maze.cells[wrapper.vm.maze.solution[1]]
    await tile(wrapper, next).trigger('click')
    expect(wrapper.vm.path).toEqual([wrapper.vm.maze.start, next.i])
    expect(wrapper.vm.mistakes).toBe(0)
  })

  it('saves a successfully translated word for a future batch', async () => {
    globalThis.indexedDB = new IDBFactory()
    idb._resetForTests()
    await progress.resetProgress()
    await progress.loadProgress()
    const wrapper = await play()
    const maze = wrapper.vm.maze
    const next = maze.cells[maze.solution[1]]
    const wordKey = maze.cells[maze.start].key
    await tile(wrapper, next).trigger('click')
    expect(wrapper.find('.translated-word').text()).toContain(next.text)
    await wrapper.find('.translated-word .next-batch').trigger('click')
    await new Promise((resolve) => setTimeout(resolve))
    await flushPromises()
    expect(progress.state.learningWishlist).toContain(wordKey)
    wrapper.unmount()
  })

  it('refuses a wrong translation, says which two words, and draws nothing', async () => {
    const wrapper = await play()
    const maze = wrapper.vm.maze
    const wrong = maze.cells[neighbours(maze.size, maze.start).find((k) => k !== maze.solution[1])]
    await tile(wrapper, wrong).trigger('click')
    expect(wrapper.vm.path).toEqual([maze.start])
    expect(wrapper.vm.mistakes).toBe(1)
    expect(plain(wrapper.text())).toContain(`«${maze.cells[maze.start].text}» does not mean`)
  })

  it('lights the refused cell on the board, and puts it out on its own', async () => {
    const wrapper = await play()
    const maze = wrapper.vm.maze
    const wrong = neighbours(maze.size, maze.start).find((k) => k !== maze.solution[1])
    vi.useFakeTimers()
    wrapper.vm.touch(wrong)
    expect(wrapper.vm.flash).toBe(wrong)
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()
    expect(wrapper.vm.flash).toBe(-1)
  })

  it('moves the line with the arrow keys', async () => {
    const wrapper = await play()
    const maze = wrapper.vm.maze
    // solution[1] is the cell one step from the corner: right or down.
    const key = maze.solution[1] === 1 ? 'ArrowRight' : 'ArrowDown'
    await wrapper.find('.maze-game').trigger('keydown', { key })
    expect(wrapper.vm.path).toEqual([maze.start, maze.solution[1]])
    await wrapper.find('.maze-game').trigger('keydown', { key: 'Backspace' })
    expect(wrapper.vm.path).toEqual([maze.start])
  })

  it('ignores an arrow that would leave the board', async () => {
    const wrapper = await play()
    await wrapper.find('.maze-game').trigger('keydown', { key: 'ArrowUp' })
    expect(wrapper.vm.path).toEqual([wrapper.vm.maze.start])
  })

  it('looks rather than plays when the touch is nowhere near the line', async () => {
    const wrapper = await play()
    const far = wrapper.vm.maze.size * 6 + 6
    wrapper.vm.touch(far)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.path).toEqual([wrapper.vm.maze.start])
    expect(wrapper.vm.mistakes).toBe(0)
    expect(wrapper.vm.lens.cells.map((c) => c.i)).toContain(far)
    // …and the magnifier can be sent back to where the line is.
    await wrapper.findAll('.lens button')[0].trigger('click')
    expect(wrapper.vm.lensCentre).toBe(wrapper.vm.maze.start)
  })

  it('retreats along the line when the player draws back over it', async () => {
    const wrapper = await play()
    const maze = wrapper.vm.maze
    maze.solution.slice(1, 4).forEach((i) => wrapper.vm.touch(i))
    expect(wrapper.vm.path).toHaveLength(4)
    wrapper.vm.touch(maze.solution[1])
    expect(wrapper.vm.path).toEqual(maze.solution.slice(0, 2))
  })

  it('draws by dragging a mouse across the board', async () => {
    const wrapper = await play()
    const maze = wrapper.vm.maze
    const cell = (i) => wrapper.findAll('.board .cell')[i]
    await cell(maze.start).trigger('pointerdown', { pointerType: 'mouse' })
    await cell(maze.solution[1]).trigger('pointermove', { pointerType: 'mouse' })
    expect(wrapper.vm.path).toEqual([maze.start, maze.solution[1]])
    await cell(maze.solution[1]).trigger('pointerup')
    await cell(maze.solution[2]).trigger('pointermove', { pointerType: 'mouse' })
    expect(wrapper.vm.path).toHaveLength(2)
  })

  it('leaves a touch drag to scroll the page', async () => {
    const wrapper = await play()
    const maze = wrapper.vm.maze
    const cell = (i) => wrapper.findAll('.board .cell')[i]
    await cell(maze.start).trigger('pointerdown', { pointerType: 'touch' })
    await cell(maze.solution[1]).trigger('pointermove', { pointerType: 'touch' })
    expect(wrapper.vm.path).toEqual([maze.start])
  })

  it('ignores a pointer that lands on no cell at all', async () => {
    const wrapper = await play()
    await wrapper.find('.board').trigger('pointerdown', { pointerType: 'mouse' })
    expect(wrapper.vm.path).toEqual([wrapper.vm.maze.start])
  })

  it('reports the time when the maze is solved, and remembers the best', async () => {
    const wrapper = await play()
    const maze = wrapper.vm.maze
    maze.solution.slice(1).forEach((i) => wrapper.vm.touch(i))
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.solved).toBe(true)
    expect(wrapper.text()).toContain('Solved in')
    expect(wrapper.vm.best[13]).toBeGreaterThanOrEqual(0)
    // Nothing more happens on a solved board.
    wrapper.vm.touch(maze.start)
    expect(wrapper.vm.path).toEqual(maze.solution)
  })

  it('shows the way through when the player gives up', async () => {
    const wrapper = await play()
    const maze = wrapper.vm.maze
    await wrapper.findAll('button').find((b) => b.text() === 'Give up').trigger('click')
    expect(wrapper.vm.path).toEqual(maze.solution)
    expect(wrapper.vm.solved).toBe(false)
    expect(wrapper.text()).toContain('The way through')
    expect(wrapper.vm.best[13]).toBeUndefined()
    // Nothing more happens on a revealed board — including giving up again.
    wrapper.vm.touch(maze.start)
    wrapper.vm.giveUp()
    expect(wrapper.vm.path).toEqual(maze.solution)
  })

  it('goes back to the menu when stopped', async () => {
    const wrapper = await play()
    await wrapper.findAll('button').find((b) => b.text() === 'Stop').trigger('click')
    expect(wrapper.vm.maze).toBe(null)
    expect(wrapper.text()).toContain('Meaning maze')
  })
})
