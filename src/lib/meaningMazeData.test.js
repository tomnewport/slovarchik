// Corpus guard for the meaning maze (#752).
//
// `meaningMaze.test.js` proves the generator against synthetic words. This one
// asks the question that only the real lexicon can answer: is there still
// enough of it, once the length caps and the two deduplications have had their
// say, to fill the 25×25 board the game offers by default — and does a board
// built from real glosses, where words genuinely do share meanings, still hold
// the one-link invariant the refusals depend on?
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

import { POS_BY_FILE, buildWords, shapeVocab } from './vocabBuild.js'
import { DEFAULT_SIZE, generateMaze, largestSize, linkOk, mazeWordPool, neighbours } from './meaningMaze.js'

const vocabDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/vocab')
const files = Object.keys(POS_BY_FILE).map((name) => ({
  pos: POS_BY_FILE[name],
  doc: yaml.load(readFileSync(resolve(vocabDir, `${name}.yml`), 'utf8')),
}))
const pool = mazeWordPool(shapeVocab(buildWords(files)))

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

describe('the maze word pool over the whole corpus', () => {
  it('can fill the default board', () => {
    expect(pool.length).toBeGreaterThanOrEqual(DEFAULT_SIZE * DEFAULT_SIZE)
    expect(largestSize(pool.length)).toBe(DEFAULT_SIZE)
  })

  it('draws only on A1–B1, and only on words the curriculum teaches', () => {
    // Gloss-only entries are `learn: false` and never reach `shapeVocab`, so a
    // maze cannot quiz a word that exists solely to gloss a phrase.
    expect(pool.every((w) => w.ru && w.en && w.glosses.length)).toBe(true)
  })
})

describe('a board built from the real lexicon', () => {
  // Several seeds, because a collision between two real glosses is a thing that
  // happens on some draws and not others.
  it.each([1, 2, 3])('holds the one-link invariant (seed %i)', (seed) => {
    const maze = generateMaze(pool, { size: DEFAULT_SIZE, rng: mulberry32(seed) })
    for (const cell of maze.cells) {
      if (cell.side !== 'ru') continue
      const valid = neighbours(maze.size, cell.i).filter((k) => linkOk(cell, maze.cells[k]))
      expect(valid.length).toBeLessThanOrEqual(1)
    }
  })

  it('is solvable along the path it carved', () => {
    const maze = generateMaze(pool, { size: DEFAULT_SIZE, rng: mulberry32(4) })
    maze.solution.forEach((i, p) => {
      if (p % 2 !== 0 || p + 1 >= maze.solution.length) return
      expect(linkOk(maze.cells[i], maze.cells[maze.solution[p + 1]])).toBe(true)
    })
  })
})
