import { describe, it, expect } from 'vitest'

import {
  DEFAULT_SIZE,
  SIZES,
  adjacent,
  advance,
  carveNodePath,
  formatTime,
  generateMaze,
  hyphenate,
  glossKey,
  isNode,
  largestSize,
  lensView,
  linkOk,
  mazeWordPool,
  moveOutcome,
  neighbours,
  refusal,
  sideAt,
  solutionCells,
  step,
} from './meaningMaze.js'

/** A seedable RNG, so a failing board can be rebuilt from the seed alone. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A pool of distinct, mutually unrelated words — nothing can collide by accident. */
function pool(n) {
  return Array.from({ length: n }, (_, i) => ({
    key: `w${i}=g${i}`,
    ru: `сло${i}`,
    en: `gloss${i}`,
    glosses: [`gloss${i}`],
  }))
}

describe('glossKey', () => {
  it('folds case, punctuation and spacing', () => {
    expect(glossKey('  The   Table! ')).toBe('table')
    expect(glossKey('HOUSE')).toBe('house')
  })

  it('treats an infinitive and a bare verb as one answer', () => {
    expect(glossKey('to go')).toBe(glossKey('go'))
    expect(glossKey('a lot')).toBe(glossKey('lot'))
  })

  it('strips only a leading article, not one inside the gloss', () => {
    expect(glossKey('one of the boys')).toBe('one of the boys')
  })

  it('survives nothing at all', () => {
    expect(glossKey(undefined)).toBe('')
    expect(glossKey('!!!')).toBe('')
  })
})

describe('mazeWordPool', () => {
  const word = (over) => ({ id: 'к=k', ru: 'кот', en: ['cat'], cefr: 'A1', ...over })

  it('keeps A1–B1 and drops everything else', () => {
    const got = mazeWordPool([
      word({ id: 'a', ru: 'а', en: ['a'], cefr: 'A1' }),
      word({ id: 'b', ru: 'б', en: ['b'], cefr: 'B1' }),
      word({ id: 'c', ru: 'в', en: ['c'], cefr: 'B2' }),
      word({ id: 'd', ru: 'г', en: ['d'], cefr: null }),
    ])
    expect(got.map((w) => w.key)).toEqual(['a', 'b'])
  })

  it('drops words too long to read in a cell', () => {
    expect(mazeWordPool([word({ ru: 'достопримечательность' })])).toEqual([])
    expect(mazeWordPool([word({ en: ['a very long-winded gloss'] })])).toEqual([])
  })

  it('measures Russian length without the stress mark', () => {
    // 13 letters plus a combining acute — the acute must not cost a character.
    const got = mazeWordPool([word({ ru: 'преподава́тель', en: ['teacher'] })])
    expect(got).toHaveLength(1)
  })

  it('shows the shortest usable gloss but accepts them all', () => {
    const got = mazeWordPool([word({ en: ['feline animal', 'cat'] })])
    expect(got[0].en).toBe('cat')
    expect(got[0].glosses).toEqual(['feline animal', 'cat'])
  })

  it('refuses a gloss that is really a note, and the word with it when it has no other', () => {
    expect(mazeWordPool([word({ en: ['bow (of a ship)'] })])).toEqual([])
    expect(mazeWordPool([word({ en: ['bow (of a ship)', 'bow'] })])[0].en).toBe('bow')
  })

  it('keeps one entry per headword and one per displayed gloss', () => {
    const got = mazeWordPool([
      word({ id: 'a', ru: 'ко́т', en: ['cat'] }),
      word({ id: 'b', ru: 'кот', en: ['tomcat'] }),
      word({ id: 'c', ru: 'пёс', en: ['dog'] }),
      word({ id: 'd', ru: 'пес', en: ['hound'] }),
      word({ id: 'e', ru: 'соба́ка', en: ['dog'] }),
    ])
    expect(got.map((w) => w.key)).toEqual(['a', 'c'])
  })

  it('skips an entry with nothing to show', () => {
    expect(mazeWordPool([word({ ru: '  ' }), word({ en: [] }), word({ en: ['   '] })])).toEqual([])
    expect(mazeWordPool(null)).toEqual([])
  })
})

describe('the board geometry', () => {
  it('alternates languages like a chessboard', () => {
    expect(sideAt(0, 0)).toBe('ru')
    expect(sideAt(0, 1)).toBe('en')
    expect(sideAt(1, 1)).toBe('ru')
  })

  it('calls the even/even cells nodes', () => {
    expect(isNode(0, 0)).toBe(true)
    expect(isNode(2, 4)).toBe(true)
    expect(isNode(1, 1)).toBe(false)
  })

  it('gives a cell its orthogonal neighbours, and no more', () => {
    expect(neighbours(5, 0).sort((a, b) => a - b)).toEqual([1, 5])
    expect(neighbours(5, 12).sort((a, b) => a - b)).toEqual([7, 11, 13, 17])
    expect(neighbours(5, 24).sort((a, b) => a - b)).toEqual([19, 23])
  })

  it('does not wrap around the right-hand edge', () => {
    expect(adjacent(5, 4, 5)).toBe(false)
    expect(adjacent(5, 4, 9)).toBe(true)
    expect(adjacent(5, 0, 12)).toBe(false)
  })

  it('offers the largest board a pool can fill', () => {
    expect(largestSize(625)).toBe(25)
    expect(largestSize(624)).toBe(17)
    expect(largestSize(10)).toBe(0)
    expect(SIZES).toContain(DEFAULT_SIZE)
  })
})

describe('carveNodePath', () => {
  it('runs corner to corner over distinct nodes', () => {
    const path = carveNodePath(13, mulberry32(7))
    expect(path[0]).toBe(0)
    expect(path[path.length - 1]).toBe(168)
    expect(new Set(path).size).toBe(path.length)
  })

  it('steps one node at a time', () => {
    const path = carveNodePath(13, mulberry32(11))
    for (let k = 1; k < path.length; k++) expect(adjacent(13, path[k - 1], path[k])).toBe(true)
  })

  it('lands inside the requested length band', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const path = carveNodePath(13, mulberry32(seed))
      expect(path.length).toBeGreaterThanOrEqual(30)
      expect(path.length).toBeLessThanOrEqual(52)
    }
  })

  it('still returns the nearest path when no tree can meet the band', () => {
    // A 3×3 lattice holds nine nodes, so a band asking for twenty is impossible.
    const path = carveNodePath(3, mulberry32(3), { minNodes: 20, maxNodes: 30, tries: 4 })
    expect(path[0]).toBe(0)
    expect(path[path.length - 1]).toBe(8)
  })

  it('takes the shorter side of an unreachable band too', () => {
    const path = carveNodePath(5, mulberry32(3), { minNodes: 1, maxNodes: 2, tries: 4 })
    expect(path.length).toBeGreaterThan(2)
  })
})

describe('solutionCells', () => {
  it('lays a node path out as node, midpoint, node', () => {
    // Nodes 0 → 1 → 4 on a 3-node lattice is cells (0,0) → (0,2) → (2,2).
    expect(solutionCells([0, 1, 4], 3, 5)).toEqual([0, 1, 2, 7, 12])
  })
})

describe('generateMaze', () => {
  const maze = generateMaze(pool(900), { size: 25, rng: mulberry32(42) })
  const cellsOf = (m) => m.cells

  it('refuses a board that cannot carry a lattice', () => {
    expect(() => generateMaze(pool(100), { size: 24 })).toThrow(/odd/)
    expect(() => generateMaze(pool(100), { size: 3 })).toThrow(/at least 5/)
  })

  it('fills every cell with a word on the right side of the board', () => {
    for (const cell of cellsOf(maze)) {
      expect(cell.text).not.toBe('')
      expect(cell.side).toBe(sideAt(cell.r, cell.c))
      if (cell.side === 'ru') expect(cell.glosses.length).toBeGreaterThan(0)
      else expect(cell.norm).not.toBe('')
    }
  })

  it('shows no word twice', () => {
    const shown = cellsOf(maze).map((c) => c.text)
    expect(new Set(shown).size).toBe(shown.length)
  })

  it('runs from one corner to the other', () => {
    expect(maze.start).toBe(0)
    expect(maze.goal).toBe(624)
    expect(maze.solution[0]).toBe(maze.start)
    expect(maze.solution[maze.solution.length - 1]).toBe(maze.goal)
  })

  it('alternates Russian and English along the solution, starting and ending Russian', () => {
    maze.solution.forEach((i, p) => {
      expect(maze.cells[i].side).toBe(p % 2 === 0 ? 'ru' : 'en')
    })
    expect(maze.solution.length % 2).toBe(1)
  })

  it('never lets the solution touch itself', () => {
    const at = new Map(maze.solution.map((i, p) => [i, p]))
    for (const [i, p] of at) {
      for (const k of neighbours(maze.size, i)) {
        if (at.has(k)) expect(Math.abs(at.get(k) - p)).toBe(1)
      }
    }
  })

  it('can be walked end to end without a single refusal', () => {
    let path = [maze.start]
    let solved = false
    for (const target of maze.solution.slice(1)) {
      const out = advance(maze, path, target)
      expect(out.kind).toBe('extend')
      path = out.path
      solved = out.solved
    }
    expect(solved).toBe(true)
  })

  it('leaves exactly one way forward out of each Russian cell on the path', () => {
    maze.solution.forEach((i, p) => {
      if (p % 2 !== 0) return
      const valid = neighbours(maze.size, i).filter((k) => linkOk(maze.cells[i], maze.cells[k]))
      expect(valid).toEqual(p + 1 < maze.solution.length ? [maze.solution[p + 1]] : [])
    })
  })

  it('places no link it did not mean to: every Russian cell has at most one', () => {
    for (const cell of cellsOf(maze)) {
      if (cell.side !== 'ru') continue
      const valid = neighbours(maze.size, cell.i).filter((k) => linkOk(cell, maze.cells[k]))
      expect(valid.length).toBeLessThanOrEqual(1)
    }
  })

  it('hangs false routes off the path that lead nowhere', () => {
    const onPath = new Set(maze.solution)
    const decoys = cellsOf(maze).filter(
      (c) =>
        c.side === 'ru' &&
        !onPath.has(c.i) &&
        neighbours(maze.size, c.i).some((k) => linkOk(c, maze.cells[k])),
    )
    expect(decoys.length).toBeGreaterThan(0)
    // A false route must not hand the player back onto the solution: no decoy's
    // English cell may sit beside a Russian cell of the path.
    for (const decoy of decoys) {
      const en = neighbours(maze.size, decoy.i).filter((k) => linkOk(decoy, maze.cells[k]))
      for (const k of en) {
        for (const back of neighbours(maze.size, k)) {
          if (maze.cells[back].side === 'ru') expect(onPath.has(back)).toBe(false)
        }
      }
    }
  })

  it('leaves most Russian cells as dead ends', () => {
    const dead = cellsOf(maze).filter(
      (c) => c.side === 'ru' && !neighbours(maze.size, c.i).some((k) => linkOk(c, maze.cells[k])),
    )
    expect(dead.length).toBeGreaterThan(maze.cells.length / 4)
  })

  it('is reproducible from a seed, and different without one', () => {
    const again = generateMaze(pool(900), { size: 25, rng: mulberry32(42) })
    expect(again.cells.map((c) => c.text)).toEqual(maze.cells.map((c) => c.text))
    const other = generateMaze(pool(900), { size: 25, rng: mulberry32(43) })
    expect(other.cells.map((c) => c.text)).not.toEqual(maze.cells.map((c) => c.text))
  })

  it('builds every offered size', () => {
    for (const size of SIZES) {
      const m = generateMaze(pool(900), { size, rng: mulberry32(size) })
      expect(m.cells).toHaveLength(size * size)
      expect(m.goal).toBe(size * size - 1)
    }
  })

  it('says so when the pool cannot fill the board', () => {
    expect(() => generateMaze(pool(20), { size: 13, rng: mulberry32(1) })).toThrow(/not enough/)
  })

  it('still finishes a board when no word can be placed cleanly', () => {
    // Every word means the same thing, so the rejection sampler can never be
    // satisfied and the fallback has to carry the whole board.
    const flat = Array.from({ length: 60 }, (_, i) => ({
      key: `w${i}`,
      ru: `сло${i}`,
      en: 'same',
      glosses: ['same'],
    }))
    const m = generateMaze(flat, { size: 5, rng: mulberry32(9) })
    expect(m.cells.every((c) => c.text !== '')).toBe(true)
  })

  it('draws no decoys when it is told not to', () => {
    const plain = generateMaze(pool(900), { size: 13, rng: mulberry32(5), decoyChance: 0 })
    const onPath = new Set(plain.solution)
    const strays = plain.cells.filter(
      (c) =>
        c.side === 'ru' &&
        !onPath.has(c.i) &&
        neighbours(plain.size, c.i).some((k) => linkOk(c, plain.cells[k])),
    )
    expect(strays).toEqual([])
  })
})

describe('moving', () => {
  const maze = generateMaze(pool(900), { size: 13, rng: mulberry32(2) })
  const [start, first, second] = maze.solution

  it('extends along a correct translation', () => {
    expect(moveOutcome(maze, [start], first)).toEqual({ kind: 'extend' })
  })

  it('refuses a wrong translation and leaves the line where it was', () => {
    const wrong = neighbours(maze.size, start).find((k) => k !== first)
    const out = advance(maze, [start], wrong)
    expect(out.kind).toBe('refused')
    expect(out.reason).toBe('wrong-meaning')
    expect(out.path).toEqual([start])
  })

  it('lets an English cell reach any Russian neighbour, free', () => {
    for (const k of neighbours(maze.size, first)) {
      expect(moveOutcome(maze, [start, first], k).kind).toBe(
        k === start ? 'backtrack' : 'extend',
      )
    }
  })

  it('retreats to any cell already on the line', () => {
    const path = [start, first, second]
    const out = advance(maze, path, start)
    expect(out.kind).toBe('backtrack')
    expect(out.path).toEqual([start])
  })

  it('ignores the head, a cell that is not adjacent, and an empty line', () => {
    expect(moveOutcome(maze, [start], start).reason).toBe('head')
    expect(moveOutcome(maze, [start], maze.goal).reason).toBe('not-adjacent')
    expect(moveOutcome(maze, [], first).reason).toBe('no-path')
    expect(advance(maze, [start], maze.goal).path).toEqual([start])
  })

  it('reports the maze solved when the line reaches the exit', () => {
    const path = maze.solution.slice(0, -1)
    expect(advance(maze, path, maze.goal).solved).toBe(true)
    // …and keeps saying so once it is there.
    expect(advance(maze, maze.solution, maze.start).solved).toBe(false)
    expect(advance(maze, maze.solution, maze.goal).solved).toBe(true)
  })

  it('steps by direction, and off the board not at all', () => {
    expect(step(maze, [0], 0, 1)).toBe(1)
    expect(step(maze, [0], 1, 0)).toBe(maze.size)
    expect(step(maze, [0], -1, 0)).toBe(-1)
    expect(step(maze, [maze.size - 1], 0, 1)).toBe(-1)
    expect(step(maze, [], 0, 1)).toBe(-1)
    expect(step(maze, [maze.cells.length - 1], 1, 0)).toBe(-1)
  })
})

describe('linkOk', () => {
  const ru = { side: 'ru', glosses: ['house'], text: 'дом', norm: '' }
  const en = { side: 'en', glosses: [], text: 'house', norm: 'house' }

  it('accepts a translation and nothing else', () => {
    expect(linkOk(ru, en)).toBe(true)
    expect(linkOk(ru, { ...en, norm: 'table' })).toBe(false)
  })

  it('never links two cells on the same side', () => {
    expect(linkOk(en, ru)).toBe(false)
    expect(linkOk(ru, { ...ru })).toBe(false)
  })
})

describe('the lens', () => {
  const maze = generateMaze(pool(900), { size: 13, rng: mulberry32(4) })

  it('centres on a cell', () => {
    const view = lensView(maze, 7 * 13 + 7, 5)
    expect([view.r0, view.c0]).toEqual([5, 5])
    expect(view.cells).toHaveLength(25)
    expect(view.cells[12]).toBe(maze.cells[7 * 13 + 7])
  })

  it('stays on the board at the corners', () => {
    expect(lensView(maze, 0, 5)).toMatchObject({ r0: 0, c0: 0 })
    expect(lensView(maze, maze.cells.length - 1, 5)).toMatchObject({ r0: 8, c0: 8 })
  })

  it('shrinks to the board when asked for more than there is', () => {
    const view = lensView(maze, 0, 99)
    expect(view.span).toBe(13)
    expect(view.cells).toHaveLength(169)
  })
})

describe('hyphenate', () => {
  /** Soft hyphens are invisible; show them as real ones so a failure reads. */
  const breaks = (word, side) => hyphenate(word, side).replace(/\u00ad/g, '-')

  it('breaks Russian after a vowel, closing the syllable with a consonant', () => {
    expect(breaks('ко́мната', 'ru')).toBe('ко́м-на-та')
    expect(breaks('сестра́', 'ru')).toBe('сес-тра́')
    expect(breaks('зараба́тывать', 'ru')).toBe('за-ра-ба́-ты-вать')
  })

  it('never strands ь, ъ or й at the start of a line', () => {
    expect(breaks('больни́ца', 'ru')).toBe('боль-ни́-ца')
    expect(breaks('ма́льчик', 'ru')).toBe('ма́ль-чик')
    expect(breaks('объясни́ть', 'ru')).toBe('объ-яс-ни́ть')
    expect(breaks('по́льзоваться', 'ru')).toBe('по́ль-зо-вать-ся')
  })

  it('treats the stress mark as part of its vowel, not as a letter', () => {
    expect(breaks('мо́крый', 'ru')).toBe('мо́к-рый')
    expect(hyphenate('мо́крый', 'ru')).toContain('о\u0301')
  })

  it('leaves a tail that is not a syllable alone', () => {
    // There is no vowel after the last one, so nothing can be carried over.
    expect(breaks('преподава́тель', 'ru')).toBe('пре-по-да-ва́-тель')
  })

  it('splits an English consonant pair, and opens a single one', () => {
    expect(breaks('hospital', 'en')).toBe('hos-pi-tal')
    expect(breaks('discovery', 'en')).toBe('dis-co-ve-ry')
    expect(breaks('brilliant', 'en')).toBe('bril-liant')
  })

  it('keeps an English digraph whole', () => {
    expect(breaks('mosquito', 'en')).toBe('mos-qui-to')
  })

  it('does not carry a silent e over on its own', () => {
    expect(breaks('participate', 'en')).toBe('par-ti-ci-pate')
  })

  it('leaves a short word, and a word with nowhere to break, as it is', () => {
    expect(breaks('руль', 'ru')).toBe('руль')
    expect(breaks('twice', 'en')).toBe('twice')
    expect(breaks('change', 'en')).toBe('change')
    expect(hyphenate('', 'ru')).toBe('')
    expect(hyphenate(undefined, 'en')).toBe('')
  })

  it('hyphenates each word of a gloss on its own', () => {
    expect(breaks('steering wheel', 'en')).toBe('stee-ring wheel')
  })
})

describe('what the player is told', () => {
  it('writes the refused claim out in full', () => {
    expect(refusal({ text: 'дом' }, { text: 'table' })).toBe('«дом» does not mean “table”.')
  })

  it('reads the clock as minutes and seconds', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(9500)).toBe('0:10')
    expect(formatTime(61_000)).toBe('1:01')
    expect(formatTime(-5)).toBe('0:00')
  })
})
