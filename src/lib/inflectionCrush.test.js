import { describe, it, expect } from 'vitest'

import {
  CHASE_MS_PER_FEATURE,
  CHASE_SCORE,
  CLEARS_PER_LEVEL,
  COLUMNS,
  ELIGIBLE_CEFR,
  FEATURES,
  FEATURE_LABELS,
  FEATURE_SHORT,
  LEVEL_CATEGORIES,
  MAX_FORM_LENGTH,
  MODES,
  ROWS,
  RUN,
  TILE_SCORE,
  adjacentColumns,
  buildTilePool,
  cardFor,
  chaseScore,
  chaseTargets,
  chaseWindowMs,
  createBoard,
  createDealer,
  dropMsFor,
  eligibleWords,
  featuresOf,
  findRuns,
  firedCategories,
  heightOf,
  isChaseHit,
  isToppedOut,
  landTile,
  levelDeck,
  levelFor,
  nextClear,
  pickCategories,
  queueCards,
  removeCells,
  removeOne,
  stepScore,
  swapColumns,
  tallest,
  tilesForWord,
} from './inflectionCrush.js'
import { buildWords } from './vocabBuild.js'

/** A deterministic RNG, so a board that fails once fails the same way twice. */
function seeded(seed = 1) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** A word record as buildWords() hands one over. */
function noun(overrides = {}) {
  const [word] = buildWords([
    {
      pos: 'noun',
      doc: {
        words: {
          'книга=book': {
            cefr_level: 'A1',
            gender: 'f',
            animacy: 'i',
            number: ['sg', 'pl'],
            en_gb: { standard: 'book' },
            declension: {
              sg_nom: 'кни́га',
              sg_gen: 'кни́ги',
              sg_dat: 'кни́ге',
              sg_acc: 'кни́гу',
              sg_ins: 'кни́гой',
              sg_pre: 'кни́ге',
              pl_nom: 'кни́ги',
              pl_gen: 'книг',
              pl_dat: 'кни́гам',
              pl_acc: 'кни́ги',
              pl_ins: 'кни́гами',
              pl_pre: 'кни́гах',
            },
            ...overrides,
          },
        },
      },
    },
  ])
  return word
}

function adjective(overrides = {}) {
  const [word] = buildWords([
    {
      pos: 'adjective',
      doc: {
        words: {
          'новый=new': {
            cefr_level: 'A1',
            accented: 'но́вый',
            en_gb: { standard: 'new' },
            forms: { m: 'но́вый', f: 'но́вая', n: 'но́вое', pl: 'но́вые' },
            declension: {
              m_nom: 'но́вый',
              m_gen: 'но́вого',
              m_dat: 'но́вому',
              m_acc: 'но́вый',
              m_ins: 'но́вым',
              m_pre: 'но́вом',
              n_nom: 'но́вое',
              n_gen: 'но́вого',
              n_dat: 'но́вому',
              n_acc: 'но́вое',
              n_ins: 'но́вым',
              n_pre: 'но́вом',
              f_nom: 'но́вая',
              f_gen: 'но́вой',
              f_dat: 'но́вой',
              f_acc: 'но́вую',
              f_ins: 'но́вой',
              f_pre: 'но́вой',
              pl_nom: 'но́вые',
              pl_gen: 'но́вых',
              pl_dat: 'но́вым',
              pl_acc: 'но́вые',
              pl_ins: 'но́выми',
              pl_pre: 'но́вых',
            },
            ...overrides,
          },
        },
      },
    },
  ])
  return word
}

/** A bare tile with its categories stated outright — the board tests want no corpus. */
function tile(id, kase, gender = ['m']) {
  return {
    id,
    key: `k${id}`,
    lemma: 'сло́во',
    en: 'word',
    pos: 'noun',
    form: id,
    features: { gender, case: kase },
  }
}

/** A board whose columns are given bottom-first. */
function boardOf(cols, categories = ['nom', 'gen', 'dat', 'acc'], opts = {}) {
  return { rows: 9, run: RUN, mode: 'case', categories, cols, ...opts }
}

describe('tilesForWord', () => {
  it('reads a noun cell as its case plus the word gender, and pl in the plural', () => {
    const tiles = tilesForWord(noun())
    expect(tiles.find((t) => t.form === 'кни́га').features).toEqual({ gender: ['f'], case: ['nom'] })
    expect(tiles.find((t) => t.form === 'кни́гами').features).toEqual({
      gender: ['pl'],
      case: ['ins'],
    })
  })

  it('gives one tile every reading its form could have', () => {
    // кни́ги is genitive singular, nominative plural and accusative plural at
    // once — so it is feminine *and* plural, and three cases.
    const knigi = tilesForWord(noun()).find((t) => t.form === 'кни́ги')
    expect(knigi.features.case).toEqual(['nom', 'gen', 'acc'])
    expect(knigi.features.gender).toEqual(['f', 'pl'])
  })

  it('merges the cells a form shares without merging across a stress difference', () => {
    // кни́ге is dative and prepositional singular: one tile, two cases.
    const knige = tilesForWord(noun()).filter((t) => t.form === 'кни́ге')
    expect(knige).toHaveLength(1)
    expect(knige[0].features.case).toEqual(['dat', 'pre'])
  })

  it('reads an adjective column as its gender', () => {
    const novogo = tilesForWord(adjective()).find((t) => t.form === 'но́вого')
    expect(novogo.features.gender).toEqual(['m', 'n'])
    // Genitive by storage, accusative by the derived animate row (ви́жу но́вого).
    expect(novogo.features.case).toEqual(['gen', 'acc'])
  })

  it('drops a form too long to read on a tile', () => {
    const tiles = tilesForWord(adjective())
    expect(tiles.every((t) => t.form.replace(/́/g, '').length <= MAX_FORM_LENGTH)).toBe(true)
  })

  it('refuses a noun whose gender the corpus does not give', () => {
    expect(tilesForWord(noun({ gender: null }))).toEqual([])
  })

  it('returns nothing for a word with no usable table', () => {
    const [word] = buildWords([
      { pos: 'adverb', doc: { words: { 'быстро=quickly': { cefr_level: 'A1' } } } },
    ])
    expect(tilesForWord(word)).toEqual([])
  })
})

describe('eligibleWords and buildTilePool', () => {
  const words = [noun(), adjective(), noun({ cefr_level: 'C1' })]

  it('keeps only declinable A1–B1 nouns and adjectives', () => {
    expect(ELIGIBLE_CEFR).toEqual(['A1', 'A2', 'B1'])
    expect(eligibleWords(words).map((w) => w.cefr)).toEqual(['A1', 'A1'])
    expect(eligibleWords(undefined)).toEqual([])
  })

  it('leaves a gloss-only entry out', () => {
    expect(eligibleWords([noun({ learn: false })])).toEqual([])
  })

  it('samples a bounded number of words and flattens them to tiles', () => {
    const pool = buildTilePool(words, { rng: seeded(7), maxWords: 1 })
    expect(pool.length).toBeGreaterThan(3)
    expect(new Set(pool.map((t) => t.key)).size).toBe(1)
  })

  it('is empty when nothing is eligible', () => {
    expect(buildTilePool([noun({ cefr_level: 'C2' })], { rng: seeded(3) })).toEqual([])
  })
})

describe('levels', () => {
  it('plays gender on all four genders, every level', () => {
    expect(pickCategories('gender', seeded(5))).toEqual(['m', 'f', 'n', 'pl'])
    expect(LEVEL_CATEGORIES).toBe(4)
  })

  it('picks four of the six cases, in canonical order', () => {
    const rng = seeded(11)
    for (let i = 0; i < 20; i++) {
      const picked = pickCategories('case', rng)
      expect(picked).toHaveLength(4)
      expect(new Set(picked).size).toBe(4)
      expect(picked.every((c) => FEATURES.case.includes(c))).toBe(true)
      // Canonical order, so the header reads the same way every level.
      expect(picked).toEqual(FEATURES.case.filter((c) => picked.includes(c)))
    }
  })

  it('varies the four across levels rather than dealing one fixed set', () => {
    const rng = seeded(13)
    const seen = new Set(Array.from({ length: 12 }, () => pickCategories('case', rng).join()))
    expect(seen.size).toBeGreaterThan(1)
  })

  it('speeds the fall up level by level, down to a floor', () => {
    expect(dropMsFor(1)).toBeGreaterThan(dropMsFor(2))
    expect(dropMsFor(2)).toBeGreaterThan(dropMsFor(5))
    expect(dropMsFor(99)).toBe(260)
  })

  it('counts a level per batch of cleared tiles', () => {
    expect(levelFor(0)).toBe(1)
    expect(levelFor(CLEARS_PER_LEVEL - 1)).toBe(1)
    expect(levelFor(CLEARS_PER_LEVEL)).toBe(2)
  })
})

describe('levelDeck', () => {
  const pool = tilesForWord(noun()).concat(tilesForWord(adjective()))

  it('deals only tiles that carry one of the level categories', () => {
    const deck = levelDeck(pool, 'case', ['gen', 'dat'], { rng: seeded(3) })
    expect(deck.length).toBeGreaterThan(0)
    expect(
      deck.every((t) => featuresOf(t, 'case').some((f) => ['gen', 'dat'].includes(f))),
    ).toBe(true)
  })

  it('gives each category about the same weight', () => {
    const cats = ['m', 'f', 'n', 'pl']
    const deck = levelDeck(pool, 'gender', cats, { rng: seeded(4) })
    const counts = cats.map((c) => deck.filter((t) => featuresOf(t, 'gender').includes(c)).length)
    expect(Math.min(...counts)).toBeGreaterThan(0)
    // Round-robin to the smallest bucket, so nothing runs away with the deck.
    expect(Math.max(...counts) / Math.min(...counts)).toBeLessThan(3)
  })

  it('is empty when no tile carries any of the categories', () => {
    expect(levelDeck([tile('a', ['nom'])], 'case', ['gen'], { rng: seeded(5) })).toEqual([])
  })
})

describe('the board', () => {
  it('starts empty, one column per category', () => {
    const board = createBoard('case', ['nom', 'gen', 'dat', 'acc'])
    expect(board.cols).toHaveLength(COLUMNS)
    expect(board.rows).toBe(ROWS)
    expect(tallest(board)).toBe(0)
    expect(isToppedOut(board)).toBe(false)
  })

  it('stacks a landed tile on top of its column, leaving the others alone', () => {
    let board = createBoard('case', ['nom', 'gen', 'dat', 'acc'])
    board = landTile(board, 1, tile('a', ['nom']))
    board = landTile(board, 1, tile('b', ['gen']))
    expect(heightOf(board, 1)).toBe(2)
    expect(heightOf(board, 0)).toBe(0)
    // Bottom-first: the first tile landed is index 0.
    expect(board.cols[1].map((t) => t.form)).toEqual(['a', 'b'])
  })

  it('tops out when a column reaches the ceiling', () => {
    let board = createBoard('case', ['nom'], { rows: 2 })
    board = landTile(board, 0, tile('a', ['nom']))
    expect(isToppedOut(board)).toBe(false)
    board = landTile(board, 0, tile('b', ['gen']))
    expect(isToppedOut(board)).toBe(true)
  })
})

describe('swapColumns', () => {
  it('exchanges two whole stacks without touching the original', () => {
    const board = boardOf([[tile('a', ['nom'])], [tile('b', ['gen']), tile('c', ['dat'])], [], []])
    const next = swapColumns(board, 0, 1)
    expect(next.cols[0].map((t) => t.form)).toEqual(['b', 'c'])
    expect(next.cols[1].map((t) => t.form)).toEqual(['a'])
    expect(board.cols[0].map((t) => t.form)).toEqual(['a'])
  })

  it('is a no-op on a column that is not there, or on itself', () => {
    const board = boardOf([[tile('a', ['nom'])], [], [], []])
    expect(swapColumns(board, 0, 0)).toBe(board)
    expect(swapColumns(board, 0, 9)).toBe(board)
  })

  it('calls only side-by-side columns adjacent', () => {
    expect(adjacentColumns(0, 1)).toBe(true)
    expect(adjacentColumns(2, 1)).toBe(true)
    expect(adjacentColumns(0, 2)).toBe(false)
    expect(adjacentColumns(1, 1)).toBe(false)
  })
})

describe('findRuns', () => {
  it('finds two stacked tiles sharing a category', () => {
    expect(RUN).toBe(2)
    const board = boardOf([[tile('a', ['gen']), tile('b', ['gen'])], [], [], []])
    expect(findRuns(board)).toEqual([{ col: 0, from: 0, to: 1, category: 'gen' }])
  })

  it('leaves a stack whose neighbours share nothing', () => {
    const board = boardOf([[tile('a', ['gen']), tile('b', ['dat'])], [], [], []])
    expect(findRuns(board)).toEqual([])
  })

  it('reports a run once per category it fires on', () => {
    const both = ['gen', 'acc']
    const board = boardOf([[tile('a', both), tile('b', both)], [], [], []])
    expect(findRuns(board).map((r) => r.category)).toEqual(['gen', 'acc'])
    expect(firedCategories(findRuns(board), 'case')).toEqual(['gen', 'acc'])
  })

  it('takes the whole run, not just the first two', () => {
    const board = boardOf([
      [tile('a', ['gen']), tile('b', ['gen']), tile('c', ['gen']), tile('d', ['dat'])],
      [],
      [],
      [],
    ])
    expect(findRuns(board)).toEqual([{ col: 0, from: 0, to: 2, category: 'gen' }])
  })

  it('ignores a category the level is not playing with', () => {
    const board = boardOf([[tile('a', ['pre']), tile('b', ['pre'])], [], [], []], [
      'nom',
      'gen',
      'dat',
      'acc',
    ])
    expect(findRuns(board)).toEqual([])
  })

  it('matches on the mode the board is playing', () => {
    const board = boardOf([[tile('a', ['nom'], ['m']), tile('b', ['gen'], ['m'])], [], [], []], [
      'm',
      'f',
      'n',
      'pl',
    ])
    expect(findRuns(board)).toEqual([])
    expect(findRuns({ ...board, mode: 'gender' })).toHaveLength(1)
  })

  it('honours a board built with a longer run', () => {
    const cols = [[tile('a', ['gen']), tile('b', ['gen'])], [], [], []]
    expect(findRuns(boardOf(cols, undefined, { run: 3 }))).toEqual([])
    cols[0].push(tile('c', ['gen']))
    expect(findRuns(boardOf(cols, undefined, { run: 3 }))).toHaveLength(1)
  })
})

describe('nextClear', () => {
  it('takes the run out and closes the column up', () => {
    const board = boardOf([
      [tile('floor', ['dat']), tile('a', ['gen']), tile('b', ['gen']), tile('roof', ['nom'])],
      [],
      [],
      [],
    ])
    const step = nextClear(board)
    expect(step.cleared.map((t) => t.form).sort()).toEqual(['a', 'b'])
    expect(step.categories).toEqual(['gen'])
    expect(step.board.cols[0].map((t) => t.form)).toEqual(['floor', 'roof'])
  })

  it('returns null on a settled board, which is what ends a cascade', () => {
    const board = boardOf([[tile('a', ['gen']), tile('b', ['dat'])], [], [], []])
    expect(nextClear(board)).toBeNull()
  })

  it('cascades: what closes up behind a clear can clear in its turn', () => {
    // Removing the two datives leaves the two genitives stacked.
    const board = boardOf([
      [tile('a', ['gen']), tile('x', ['dat']), tile('y', ['dat']), tile('b', ['gen'])],
      [],
      [],
      [],
    ])
    let current = board
    const fired = []
    for (let i = 0; i < 8; i++) {
      const step = nextClear(current)
      if (!step) break
      fired.push(step.categories.join('+'))
      current = step.board
    }
    expect(fired).toEqual(['dat', 'gen'])
    expect(current.cols[0]).toEqual([])
  })

  it('clears two columns in one step', () => {
    const board = boardOf([
      [tile('a', ['gen']), tile('b', ['gen'])],
      [tile('c', ['dat']), tile('d', ['dat'])],
      [],
      [],
    ])
    const step = nextClear(board)
    expect(step.cleared).toHaveLength(4)
    expect(step.categories).toEqual(['gen', 'dat'])
  })
})

describe('removeCells and removeOne', () => {
  it('takes one tile out of the middle and closes the stack up', () => {
    const board = boardOf([
      [tile('a', ['nom']), tile('b', ['gen']), tile('c', ['dat'])],
      [],
      [],
      [],
    ])
    expect(removeOne(board, 0, 1).cols[0].map((t) => t.form)).toEqual(['a', 'c'])
  })

  it('leaves a column it was given nothing for', () => {
    const board = boardOf([[tile('a', ['nom'])], [tile('b', ['gen'])], [], []])
    const next = removeCells(board, new Map([[0, new Set([0])]]))
    expect(next.cols[0]).toEqual([])
    expect(next.cols[1].map((t) => t.form)).toEqual(['b'])
  })
})

describe('the chase window', () => {
  const board = boardOf([
    [tile('a', ['gen']), tile('b', ['dat'])],
    [tile('c', ['acc'])],
    [],
    [],
  ])

  it('is worth a second per category the clear fired on', () => {
    expect(chaseWindowMs(['gen'])).toBe(CHASE_MS_PER_FEATURE)
    expect(chaseWindowMs(['gen', 'acc'])).toBe(2 * CHASE_MS_PER_FEATURE)
    expect(chaseWindowMs([])).toBe(0)
  })

  it('opens every stacked tile carrying one of its categories', () => {
    expect(chaseTargets(board, ['gen', 'acc'])).toEqual([
      { col: 0, i: 0 },
      { col: 1, i: 0 },
    ])
  })

  it('grades a tap by whether the tile carries a category', () => {
    expect(isChaseHit(board, ['gen'], 0, 0)).toBe(true)
    expect(isChaseHit(board, ['gen'], 0, 1)).toBe(false)
    expect(isChaseHit(board, ['gen'], 9, 9)).toBe(false)
  })
})

describe('scoring', () => {
  it('pays a cascade one more multiple per step', () => {
    expect(stepScore(2, 0)).toBe(2 * TILE_SCORE)
    expect(stepScore(2, 2)).toBe(6 * TILE_SCORE)
  })

  it('pays a chase tap by its place in the streak', () => {
    expect(chaseScore(1)).toBe(CHASE_SCORE)
    expect(chaseScore(3)).toBe(3 * CHASE_SCORE)
  })
})

describe('word cards', () => {
  it('names the word rather than the slot the board was testing', () => {
    const t = tilesForWord(noun()).find((x) => x.form === 'кни́гами')
    expect(cardFor(t)).toEqual({
      key: 'книга=book',
      lemma: 'кни́га',
      en: 'book',
      pos: 'noun',
      form: 'кни́гами',
    })
  })

  it('queues one card per word, skipping what is already waiting', () => {
    const tiles = tilesForWord(noun())
    const queue = queueCards(queueCards([], tiles), tiles)
    expect(queue).toHaveLength(1)
    expect(queue[0].lemma).toBe('кни́га')
  })

  it('keeps distinct words, in the order they were cleared', () => {
    const [a] = tilesForWord(noun())
    const [b] = tilesForWord(adjective())
    expect(queueCards([], [a, b, null]).map((c) => c.lemma)).toEqual(['кни́га', 'но́вый'])
  })
})

describe('createDealer', () => {
  it('gives every tile its own identity', () => {
    const dealer = createDealer([tile('a', ['nom'])], seeded(2))
    const [one, two] = [dealer.deal(), dealer.deal()]
    expect(one.form).toBe(two.form)
    expect(one.id).not.toBe(two.id)
  })

  it('honours a veto, and deals anyway when every candidate is vetoed', () => {
    const pool = [tile('a', ['nom']), tile('b', ['gen'])]
    const dealer = createDealer(pool, seeded(4))
    expect(dealer.deal((t) => t.form === 'a').form).toBe('b')
    expect(dealer.deal(() => true).form).toMatch(/[ab]/)
  })
})

describe('category vocabulary', () => {
  it('labels every category of both modes, long and short', () => {
    for (const mode of MODES) {
      for (const f of FEATURES[mode]) {
        expect(FEATURE_LABELS[f]).toBeTruthy()
        expect(FEATURE_SHORT[f]).toBeTruthy()
      }
    }
  })

  it('reads a missing feature set as empty', () => {
    expect(featuresOf(null, 'case')).toEqual([])
    expect(featuresOf({}, 'case')).toEqual([])
  })
})

describe('a whole game', () => {
  // The balance argument in RUN's doc, held to by a test: a player who places
  // every tile as well as a swap could must be able to hold a board, and a
  // player dropping them anywhere must not.
  const pool = () => {
    const words = []
    for (const [gender, forms] of Object.entries({
      m: ['стол', 'стола', 'столу', 'столом'],
      f: ['книга', 'книги', 'книге', 'книгой'],
      n: ['окно', 'окна', 'окну', 'окном'],
    })) {
      forms.forEach((form, i) => {
        words.push(tile(`${gender}${i}`, [FEATURES.case[i]], [gender]))
      })
    }
    return words
  }

  function play({ skilled, rng, drops = 200 }) {
    const categories = ['nom', 'gen', 'dat', 'acc']
    const dealer = createDealer(levelDeck(pool(), 'case', categories, { rng }), rng)
    let board = createBoard('case', categories)
    let dropped = 0
    for (; dropped < drops; dropped++) {
      const next = dealer.deal()
      let column = Math.floor(rng() * COLUMNS)
      if (skilled) {
        // A swap can put any stack under the falling tile, so choosing the
        // column is exactly the reach the real move has.
        let best = -Infinity
        for (let c = 0; c < COLUMNS; c++) {
          if (heightOf(board, c) >= board.rows) continue
          const landed = landTile(board, c, next)
          const gain = (nextClear(landed)?.cleared.length ?? 0) * 100 - heightOf(board, c)
          if (gain > best) [best, column] = [gain, c]
        }
      }
      if (heightOf(board, column) >= board.rows) break
      board = landTile(board, column, next)
      for (let i = 0; i < 20; i++) {
        const step = nextClear(board)
        if (!step) break
        board = step.board
      }
      if (isToppedOut(board)) break
    }
    return dropped
  }

  it('can be held indefinitely by a player who places well', () => {
    expect(play({ skilled: true, rng: seeded(21) })).toBe(200)
  })

  it('tops out on a player who does not', () => {
    expect(play({ skilled: false, rng: seeded(21) })).toBeLessThan(200)
  })
})
