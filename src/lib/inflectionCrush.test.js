import { describe, it, expect } from 'vitest'

import {
  CHASE_MS_PER_FEATURE,
  CHASE_SCORE,
  ELIGIBLE_CEFR,
  FEATURES,
  FEATURE_LABELS,
  MAX_FORM_LENGTH,
  MODES,
  TILE_SCORE,
  adjacent,
  at,
  buildTilePool,
  cardFor,
  chaseScore,
  chaseTargets,
  chaseWindowMs,
  collapse,
  createDealer,
  eligibleWords,
  featuresOf,
  findMatches,
  firedFeatures,
  generateGrid,
  hasLegalMove,
  isChaseHit,
  matchedCells,
  nextStep,
  queueCards,
  stepScore,
  swapped,
  tilesForWord,
} from './inflectionCrush.js'
import { buildWords } from './vocabBuild.js'

// A deterministic RNG, so a board that fails once fails the same way twice.
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

/** A bare tile with the features stated outright — the grid tests want no corpus. */
function tile(id, gender, kase) {
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

/**
 * A dealer handing out a fixed sequence, so a refill is something a test can
 * state rather than something it has to work back from a seed.
 */
function sequenceDealer(tiles) {
  let n = 0
  return { deal: () => ({ ...tiles[n % tiles.length], id: `f${++n}` }) }
}

/** Lay a grid out from a table of tiles, rows outermost. */
function gridOf(rows, mode = 'case') {
  return { rows: rows.length, cols: rows[0].length, mode, cells: rows.flat() }
}

describe('tilesForWord', () => {
  it('reads a noun cell as its case plus the word gender, and pl in the plural', () => {
    const tiles = tilesForWord(noun())
    const nomSg = tiles.find((t) => t.form === 'кни́га')
    expect(nomSg.features).toEqual({ gender: ['f'], case: ['nom'] })
    const insPl = tiles.find((t) => t.form === 'кни́гами')
    expect(insPl.features).toEqual({ gender: ['pl'], case: ['ins'] })
  })

  it('gives one tile every reading its form could have', () => {
    // кни́ги is genitive singular, nominative plural and accusative plural at
    // once — so it is feminine *and* plural, and three cases.
    const kniqi = tilesForWord(noun()).find((t) => t.form === 'кни́ги')
    expect(kniqi.features.case).toEqual(['nom', 'gen', 'acc'])
    expect(kniqi.features.gender).toEqual(['f', 'pl'])
  })

  it('merges the cells a form shares without merging across a stress difference', () => {
    const tiles = tilesForWord(noun())
    // кни́ге is dative and prepositional singular: one tile, two cases.
    const knige = tiles.filter((t) => t.form === 'кни́ге')
    expect(knige).toHaveLength(1)
    expect(knige[0].features.case).toEqual(['dat', 'pre'])
  })

  it('reads an adjective column as its gender', () => {
    const tiles = tilesForWord(adjective())
    const novogo = tiles.find((t) => t.form === 'но́вого')
    expect(novogo.features.gender).toEqual(['m', 'n'])
    // Genitive by storage, accusative by the derived animate row (ви́жу но́вого).
    expect(novogo.features.case).toEqual(['gen', 'acc'])
  })

  it('drops a form too long to read on a tile', () => {
    const tiles = tilesForWord(adjective())
    expect(tiles.every((t) => t.form.replace(/\u0301/g, '').length <= MAX_FORM_LENGTH)).toBe(true)
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

describe('createDealer', () => {
  it('gives every tile its own identity', () => {
    const dealer = createDealer([tile('a', ['m'], ['nom'])], seeded(2))
    const [one, two] = [dealer.deal(), dealer.deal()]
    expect(one.form).toBe(two.form)
    expect(one.id).not.toBe(two.id)
  })

  it('honours a veto, and deals anyway when every candidate is vetoed', () => {
    const pool = [tile('a', ['m'], ['nom']), tile('b', ['f'], ['gen'])]
    const dealer = createDealer(pool, seeded(4))
    expect(dealer.deal((t) => t.form === 'a').form).toBe('b')
    expect(dealer.deal(() => true).form).toMatch(/[ab]/)
  })
})

describe('findMatches', () => {
  it('finds a run of three sharing a case, in a row and in a column', () => {
    const g = gridOf([
      [tile('1', ['m'], ['gen']), tile('2', ['f'], ['gen']), tile('3', ['n'], ['gen'])],
      [tile('4', ['m'], ['nom']), tile('5', ['f'], ['gen']), tile('6', ['n'], ['dat'])],
      [tile('7', ['m'], ['acc']), tile('8', ['f'], ['gen']), tile('9', ['n'], ['ins'])],
    ])
    const rows = findMatches(g, 'case').filter((m) => m.dir === 'row')
    const cols = findMatches(g, 'case').filter((m) => m.dir === 'col')
    expect(rows).toHaveLength(1)
    expect(rows[0].cells).toEqual([
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 0, c: 2 },
    ])
    expect(cols).toHaveLength(1)
    expect(cols[0].cells.map((c) => c.r)).toEqual([0, 1, 2])
  })

  it('reports the same run once per feature it fires on', () => {
    const both = ['gen', 'acc']
    const g = gridOf([[tile('1', ['m'], both), tile('2', ['m'], both), tile('3', ['m'], both)]])
    expect(findMatches(g, 'case').map((m) => m.feature)).toEqual(['gen', 'acc'])
    expect(firedFeatures(findMatches(g, 'case'), 'case')).toEqual(['gen', 'acc'])
  })

  it('matches on the mode it is asked about and not the other', () => {
    const g = gridOf([[tile('1', ['m'], ['nom']), tile('2', ['m'], ['gen']), tile('3', ['m'], ['dat'])]])
    expect(findMatches(g, 'case')).toEqual([])
    expect(findMatches(g, 'gender')).toHaveLength(1)
    expect(MODES).toEqual(['gender', 'case'])
  })

  it('ignores a run of two', () => {
    const g = gridOf([[tile('1', ['m'], ['gen']), tile('2', ['f'], ['gen']), tile('3', ['n'], ['dat'])]])
    expect(findMatches(g, 'case')).toEqual([])
  })

  it('counts a run that ends at the far edge', () => {
    const g = gridOf([
      [tile('1', ['m'], ['dat']), tile('2', ['f'], ['gen']), tile('3', ['n'], ['gen']), tile('4', ['n'], ['gen'])],
    ])
    expect(findMatches(g, 'case')[0].cells).toHaveLength(3)
  })
})

describe('matchedCells', () => {
  it('counts a cell shared by a row and a column once', () => {
    const g = gridOf([
      [tile('1', ['m'], ['gen']), tile('2', ['f'], ['gen']), tile('3', ['n'], ['gen'])],
      [tile('4', ['m'], ['nom']), tile('5', ['f'], ['gen']), tile('6', ['n'], ['dat'])],
      [tile('7', ['m'], ['acc']), tile('8', ['f'], ['gen']), tile('9', ['n'], ['ins'])],
    ])
    expect(matchedCells(findMatches(g, 'case')).size).toBe(5)
  })
})

describe('swapped, adjacent and at', () => {
  const g = gridOf([
    [tile('1', ['m'], ['nom']), tile('2', ['f'], ['gen'])],
    [tile('3', ['n'], ['dat']), tile('4', ['pl'], ['acc'])],
  ])

  it('exchanges two cells without touching the original', () => {
    const next = swapped(g, { r: 0, c: 0 }, { r: 1, c: 1 })
    expect(at(next, 0, 0).form).toBe('4')
    expect(at(next, 1, 1).form).toBe('1')
    expect(at(g, 0, 0).form).toBe('1')
  })

  it('reads nothing off the board', () => {
    expect(at(g, -1, 0)).toBeUndefined()
    expect(at(g, 0, 5)).toBeUndefined()
  })

  it('calls only orthogonal neighbours adjacent', () => {
    expect(adjacent({ r: 0, c: 0 }, { r: 0, c: 1 })).toBe(true)
    expect(adjacent({ r: 0, c: 0 }, { r: 1, c: 1 })).toBe(false)
    expect(adjacent({ r: 0, c: 0 }, { r: 0, c: 0 })).toBe(false)
  })
})

describe('hasLegalMove', () => {
  it('finds the swap that would make a line', () => {
    const g = gridOf([
      [tile('1', ['m'], ['gen']), tile('2', ['f'], ['gen']), tile('3', ['n'], ['dat'])],
      [tile('4', ['m'], ['nom']), tile('5', ['f'], ['acc']), tile('6', ['n'], ['gen'])],
    ])
    expect(hasLegalMove(g, 'case')).toBe(true)
  })

  it('says so when no swap helps', () => {
    const g = gridOf([
      [tile('1', ['m'], ['nom']), tile('2', ['f'], ['gen'])],
      [tile('3', ['n'], ['dat']), tile('4', ['pl'], ['acc'])],
    ])
    expect(hasLegalMove(g, 'case')).toBe(false)
  })
})

describe('collapse', () => {
  it('drops the survivors and deals into the gaps from above', () => {
    const g = gridOf([
      [tile('a', ['m'], ['nom'])],
      [tile('b', ['f'], ['gen'])],
      [tile('c', ['n'], ['dat'])],
    ])
    const dealer = createDealer([tile('new', ['pl'], ['ins'])], seeded(5))
    const next = collapse(g, new Set(['1,0']), dealer)
    expect(next.cells.map((t) => t.form)).toEqual(['new', 'a', 'c'])
  })

  it('clears a whole column', () => {
    const g = gridOf([[tile('a', ['m'], ['nom'])], [tile('b', ['f'], ['gen'])]])
    const dealer = createDealer([tile('new', ['pl'], ['ins'])], seeded(5))
    const next = collapse(g, new Set(['0,0', '1,0']), dealer)
    expect(next.cells.every((t) => t.form === 'new')).toBe(true)
  })
})

describe('nextStep', () => {
  // The refills, in the order collapse() asks for them: three instrumentals
  // (which land as a row and cascade), then three that settle the board.
  const refills = () =>
    sequenceDealer([
      tile('x1', ['m'], ['ins']),
      tile('x2', ['f'], ['ins']),
      tile('x3', ['n'], ['ins']),
      tile('y1', ['m'], ['nom']),
      tile('y2', ['f'], ['gen']),
      tile('y3', ['n'], ['dat']),
    ])

  it('clears the matched cells and reports what they were', () => {
    const g = gridOf([
      [tile('1', ['m'], ['gen']), tile('2', ['f'], ['gen']), tile('3', ['n'], ['gen'])],
      [tile('4', ['m'], ['nom']), tile('5', ['f'], ['acc']), tile('6', ['n'], ['dat'])],
    ])
    const step = nextStep(g, sequenceDealer([tile('y1', ['m'], ['nom'])]), 'case')
    expect(step.cleared.map((t) => t.form).sort()).toEqual(['1', '2', '3'])
    expect(step.features).toEqual(['gen'])
    expect(step.grid.cells.slice(3).map((t) => t.form)).toEqual(['4', '5', '6'])
  })

  it('returns null on a settled board, which is what ends a cascade', () => {
    const g = gridOf([[tile('1', ['m'], ['nom']), tile('2', ['f'], ['gen']), tile('3', ['n'], ['dat'])]])
    expect(nextStep(g, refills(), 'case')).toBeNull()
  })

  it('cascades: a refill that lands in a line clears in its turn', () => {
    const g = gridOf([
      [tile('1', ['m'], ['gen']), tile('2', ['f'], ['gen']), tile('3', ['n'], ['gen'])],
      [tile('4', ['m'], ['nom']), tile('5', ['f'], ['acc']), tile('6', ['n'], ['dat'])],
      [tile('7', ['m'], ['ins']), tile('8', ['f'], ['pre']), tile('9', ['n'], ['nom'])],
    ])
    const d = refills()
    const fired = []
    let current = g
    for (let i = 0; i < 10; i++) {
      const step = nextStep(current, d, 'case')
      if (!step) break
      fired.push(step.features.join('+'))
      current = step.grid
    }
    expect(fired).toEqual(['gen', 'ins'])
    expect(findMatches(current, 'case')).toEqual([])
  })
})

describe('collapse refills', () => {
  it('refuses a replacement that would land already three in a line', () => {
    // The gap opens at the top of the middle column, between two genitives —
    // so a genitive refill would be a row on arrival, and the two survivors
    // falling under it are both nominative, so a nominative would be a column.
    // The dealer offers one of each and the veto has to take the dative.
    const g = gridOf([
      [tile('a', ['m'], ['gen']), tile('b', ['f'], ['acc']), tile('c', ['n'], ['gen'])],
      [tile('d', ['m'], ['dat']), tile('e', ['f'], ['nom']), tile('f', ['n'], ['ins'])],
      [tile('g', ['m'], ['ins']), tile('h', ['f'], ['nom']), tile('i', ['n'], ['dat'])],
    ])
    const dealer = createDealer(
      [tile('gen', ['pl'], ['gen']), tile('nom', ['pl'], ['nom']), tile('dat', ['pl'], ['dat'])],
      seeded(21),
    )
    const next = collapse(g, new Set(['0,1']), dealer)
    expect(next.cells[1].form).toBe('dat')
    expect(findMatches(next, 'case')).toEqual([])
  })

  it('fills the gap anyway when every candidate would match', () => {
    const g = gridOf([
      [tile('a', ['m'], ['gen']), tile('b', ['f'], ['acc']), tile('c', ['n'], ['gen'])],
      [tile('d', ['m'], ['dat']), tile('e', ['f'], ['nom']), tile('f', ['n'], ['ins'])],
    ])
    const dealer = createDealer([tile('gen', ['pl'], ['gen'])], seeded(23))
    const next = collapse(g, new Set(['0,1']), dealer)
    expect(next.cells.every(Boolean)).toBe(true)
    expect(next.cells[1].form).toBe('gen')
  })
})

describe('generateGrid', () => {
  it('deals a board with no line already on it and a move available', () => {
    const pool = tilesForWord(noun()).concat(tilesForWord(adjective()))
    for (const mode of MODES) {
      const grid = generateGrid(createDealer(pool, seeded(11)), { rows: 6, cols: 5, mode })
      expect(grid.cells).toHaveLength(30)
      expect(findMatches(grid, mode)).toEqual([])
      expect(hasLegalMove(grid, mode)).toBe(true)
    }
  })

  it('still returns a board when it cannot find a playable one', () => {
    // One tile, so every cell is identical: no deal can avoid a line.
    const grid = generateGrid(createDealer([tile('a', ['m'], ['nom'])], seeded(13)), {
      rows: 3,
      cols: 3,
      mode: 'case',
      attempts: 2,
    })
    expect(grid.cells).toHaveLength(9)
  })
})

describe('the chase window', () => {
  const g = gridOf([
    [tile('1', ['m'], ['gen']), tile('2', ['f'], ['dat'])],
    [tile('3', ['n'], ['acc']), tile('4', ['pl'], ['nom'])],
  ])

  it('is worth a second per feature the line fired on', () => {
    expect(chaseWindowMs(['gen'])).toBe(CHASE_MS_PER_FEATURE)
    expect(chaseWindowMs(['gen', 'acc'])).toBe(2 * CHASE_MS_PER_FEATURE)
    expect(chaseWindowMs([])).toBe(0)
  })

  it('opens every cell carrying one of its features', () => {
    expect(chaseTargets(g, ['gen', 'acc'], 'case')).toEqual([
      { r: 0, c: 0 },
      { r: 1, c: 0 },
    ])
  })

  it('grades a tap by whether the tile carries a feature', () => {
    expect(isChaseHit(g, ['gen'], 0, 0, 'case')).toBe(true)
    expect(isChaseHit(g, ['gen'], 0, 1, 'case')).toBe(false)
    expect(isChaseHit(g, ['gen'], 9, 9, 'case')).toBe(false)
  })
})

describe('scoring', () => {
  it('pays a cascade one more multiple per step', () => {
    expect(stepScore(3, 0)).toBe(3 * TILE_SCORE)
    expect(stepScore(3, 2)).toBe(9 * TILE_SCORE)
  })

  it('pays a chase tap by its place in the streak', () => {
    expect(chaseScore(1)).toBe(CHASE_SCORE)
    expect(chaseScore(3)).toBe(3 * CHASE_SCORE)
  })
})

describe('word cards', () => {
  it('names the word rather than the slot the grid was testing', () => {
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

describe('feature vocabulary', () => {
  it('labels every feature of both modes', () => {
    for (const mode of MODES) {
      for (const f of FEATURES[mode]) expect(FEATURE_LABELS[f]).toBeTruthy()
    }
  })

  it('reads a missing feature set as empty', () => {
    expect(featuresOf(null, 'case')).toEqual([])
    expect(featuresOf({}, 'case')).toEqual([])
  })
})
