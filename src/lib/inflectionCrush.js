// Inflection crush minigame (#751).
//
// Yoshi with grammar. Inflected Russian forms fall one at a time into four
// columns; the player swaps whole columns underneath them; two stacked in one
// column that share a grammatical CATEGORY collapse, revealing that category's
// colour as they go. Everything that decides what a tile could be, what clears,
// what falls and what a clear is worth lives here, pure and seedable; the view
// owns the clock, the taps and the animation and nothing else.
//
// Four ideas carry the whole thing:
//
//   - A TILE is one surface form plus the categories it *could* carry. A form
//     is rarely one slot: кни́ги is genitive singular and nominative plural,
//     но́вого is masculine and neuter, and an animate accusative wears the
//     genitive's clothes. Reading a form as everything it might be is the skill
//     the game drills, so a tile holds a *set* of categories and a stack under
//     either reading is legitimate.
//   - A LEVEL fixes four categories up front — all four genders, or four of the
//     six cases — and deals only tiles that carry one of them. Four is what
//     makes the board readable: with all six cases in play the stacks are a
//     soup, and the player cannot hold what they are hunting for in their head.
//   - The SWAP is Yoshi's: two adjacent columns exchange their whole stacks, as
//     often as the player likes and at no cost. What is scarce is time, not
//     moves — the next tile is always falling.
//   - A CLEAR is a run of `RUN` or more tiles stacked in one column that all
//     carry one of the level's categories, reported once per category, because
//     the same run can fire twice: two tiles that are both genitive *and*
//     accusative are two clears, and the chase window below is paid per
//     category fired. The run names the category it fired on, which is what the
//     view colours the collapse with.
//
// Why categories are derived from `buildParadigm` rather than read out of the
// YAML: nouns are stored as case × number and adjectives as case × gender, and
// the paradigm model already reconciles the two into one { rows, cols, cells }
// shape — including the derived animate-accusative row. Deriving here would be
// a second opinion on the corpus, and two opinions drift.

import { ACC_ANIMATE, CASES, CASE_LABELS } from './declension.js'
import { buildParadigm } from './paradigm.js'
import { shuffle } from './quiz.js'

/** The two axes a level can be played on. */
export const MODES = Object.freeze(['gender', 'case'])

/** Agreement features: the three genders in the singular, plus the plural. */
export const GENDERS = Object.freeze(['m', 'f', 'n', 'pl'])

/** The categories each mode draws its four from, in display order. */
export const FEATURES = Object.freeze({ gender: GENDERS, case: CASES })

/** Human labels, for the summary and anywhere there is room to spell it out. */
export const FEATURE_LABELS = Object.freeze({
  m: 'masculine',
  f: 'feminine',
  n: 'neuter',
  pl: 'plural',
  ...Object.fromEntries(CASES.map((c) => [c, CASE_LABELS[c].toLowerCase()])),
})

/**
 * The same categories abbreviated, for the column of level categories and the
 * chase bar — both of which are one line on a phone, and «dative or nominative
 * or accusative» does not fit on one.
 */
export const FEATURE_SHORT = Object.freeze({
  m: 'masc',
  f: 'fem',
  n: 'neut',
  pl: 'plur',
  ...Object.fromEntries(CASES.map((c) => [c, c])),
})

/**
 * A bright colour per category, and the ink that reads on it.
 *
 * Keyed on the category itself rather than on which of a level's four slots it
 * landed in, so the colour is learnable: the genitive is this red in every
 * level it turns up in, and by the tenth level the colour is a second name for
 * the case. A mode only ever plays one of the two groups, so the genders are
 * free to reuse the cases' hues.
 *
 * Colour is never the only channel. The tiles are neutral while they are on the
 * board — reading the form is the exercise, and a coloured tile would answer
 * the question before it was asked — and the colour appears only as a run
 * collapses, next to the category's name in the header. A player who cannot
 * tell the hues apart loses a flourish, not the game.
 */
export const CATEGORY_COLORS = Object.freeze({
  nom: '#4cc3ff',
  gen: '#ff6b6b',
  dat: '#ffd166',
  acc: '#57e06a',
  ins: '#c58cff',
  pre: '#ff9f43',
  m: '#4cc3ff',
  f: '#ff7ab8',
  n: '#ffd166',
  pl: '#57e06a',
})

/** The colour a category reveals, or a neutral grey for anything unknown. */
export function colorFor(category) {
  return CATEGORY_COLORS[category] ?? '#9aa4c7'
}

/** The levels a minigame may draw on — the ones a learner here is working in. */
export const ELIGIBLE_CEFR = Object.freeze(['A1', 'A2', 'B1'])

/**
 * Longest form that still reads on a phone-width tile. Russian obliques run
 * long (кори́чневыми is eleven letters before the stress mark), and a grid cell
 * that has to shrink to 8px to fit its word is a cell nobody reads.
 */
export const MAX_FORM_LENGTH = 10

/** Points for a tile cleared by a stack, before the cascade multiplier. */
export const TILE_SCORE = 10
/** Points for a tile cleared by a chase tap. */
export const CHASE_SCORE = 25
/** How long one fired category keeps the chase window open. */
export const CHASE_MS_PER_FEATURE = 1000

/** Columns on the board — one per category the level deals from. */
export const COLUMNS = 4
/** How tall a column may get before the board is topped out. */
export const ROWS = 8
/**
 * How many stacked tiles sharing a category it takes to clear them.
 *
 * Two, as in Yoshi. Three is playable too — simulating a bot that places every
 * tile as well as a swap could, both lengths hold a board indefinitely — so the
 * choice is about how much slack a mistake gets, and the measurement is what
 * settled it: dropping tiles at random, a board survives ~64 drops at two and
 * ~36 at three. Two, because the difficulty here is meant to be *reading the
 * form*, not the puzzle around it; a learner who is still working out whether
 * кни́ги could be a nominative should not also be on a thirty-drop clock.
 */
export const RUN = 2
/** How many categories a level plays with. */
export const LEVEL_CATEGORIES = 4
/** Tiles cleared before the level ticks over (faster, and new categories). */
export const CLEARS_PER_LEVEL = 12

const ACUTE = '́'

/**
 * Identity of a surface form, for deciding which paradigm cells a tile covers.
 *
 * Stress is *kept*: ру́ки (nominative plural) and руки́ (genitive singular) are
 * different tiles, and the grid shows the accent, so merging them would credit
 * a reading the player can see is wrong. Only case and Unicode composition are
 * folded away.
 */
const formId = (form) => String(form ?? '').normalize('NFC').toLowerCase()

/** Letters in a form, ignoring the combining accent — what decides if it fits. */
const formLength = (form) => [...String(form ?? '').normalize('NFC')].filter((c) => c !== ACUTE).length

/** The features of `tile` on the given axis. */
export function featuresOf(tile, mode) {
  return tile?.features?.[mode] ?? []
}

/** Keep `list` in the canonical order of `mode`'s axis, deduplicated. */
function orderFeatures(list, mode) {
  return FEATURES[mode].filter((f) => list.includes(f))
}

/**
 * Every distinct surface form of one word, as a tile carrying the features that
 * form could stand for.
 *
 * Both parts of speech reach the same shape through `buildParadigm`:
 *   - a noun's columns are numbers, so its gender is the word's own in the
 *     singular and `pl` in the plural;
 *   - an adjective's columns *are* the genders;
 *   - the derived animate-accusative row (ви́жу но́вого дру́га) reports as `acc`,
 *     which is the whole point of it: that form really is an accusative, and a
 *     player who only reads it as a genitive is missing half of it.
 *
 * The second locative (в лесу́) is dropped. It is not one of the six cases the
 * rest of the app teaches, and it only ever differs from another cell by its
 * stress — a tile the player could not tell from its neighbour.
 *
 * @param {PlainObject} word a record from buildWords()
 * @returns {Array<PlainObject>} one tile per distinct form
 */
export function tilesForWord(word) {
  const paradigm = buildParadigm(word)
  if (!paradigm) return []
  if (word.pos === 'noun' && !GENDERS.includes(word.gender)) return []

  /** @type {Map<string, {form: string, gender: string[], case: string[]}>} */
  const byForm = new Map()
  for (const cell of paradigm.cells) {
    const kase = cell.row === ACC_ANIMATE ? 'acc' : cell.row
    if (!CASES.includes(kase)) continue
    const gender = word.pos === 'noun' ? (cell.col === 'pl' ? 'pl' : word.gender) : cell.col
    if (!GENDERS.includes(gender)) continue
    if (/\s/.test(cell.form) || formLength(cell.form) > MAX_FORM_LENGTH) continue

    const id = formId(cell.form)
    const slot = byForm.get(id) ?? { form: cell.form, gender: [], case: [] }
    if (!slot.gender.includes(gender)) slot.gender.push(gender)
    if (!slot.case.includes(kase)) slot.case.push(kase)
    byForm.set(id, slot)
  }

  return [...byForm.values()].map((slot) => ({
    key: word.key,
    lemma: paradigm.lemma,
    en: paradigm.en,
    pos: word.pos,
    form: slot.form,
    features: {
      gender: orderFeatures(slot.gender, 'gender'),
      case: orderFeatures(slot.case, 'case'),
    },
  }))
}

/** The nouns and adjectives a game may draw on. */
export function eligibleWords(words) {
  return (words ?? []).filter(
    (w) =>
      w.learnable !== false &&
      (w.pos === 'noun' || w.pos === 'adjective') &&
      ELIGIBLE_CEFR.includes(w.cefr),
  )
}

/**
 * Tiles for a random handful of eligible words.
 *
 * A handful rather than the whole corpus for two reasons. Building every A1–B1
 * paradigm costs real time on a phone, and a board drawn from ninety words
 * rather than a thousand shows the same word in two cases often enough that
 * noticing the pair is part of playing.
 *
 * @param {Array<PlainObject>} words records from buildWords()
 * @param {{rng?: () => number, maxWords?: number}} [opts]
 */
export function buildTilePool(words, { rng = Math.random, maxWords = 90 } = {}) {
  const pool = eligibleWords(words)
  const picked = []
  const seen = new Set()
  // Sampled by index rather than by shuffling the list: the eligible set is
  // thousands of records and a game wants ninety of them.
  for (let i = 0; i < maxWords * 12 && picked.length < maxWords; i++) {
    const word = pool[Math.floor(rng() * pool.length)]
    if (!word || seen.has(word.key)) continue
    seen.add(word.key)
    picked.push(word)
  }
  return picked.flatMap(tilesForWord)
}

/**
 * A source of fresh tile instances.
 *
 * Instances rather than the pool entries themselves: two cells can hold the
 * same form, and Vue needs a stable identity per cell to animate a fall rather
 * than re-render the column. The counter lives in the closure so a dealer is
 * deterministic given its `rng`, and tests can hold two independent ones.
 */
export function createDealer(pool, rng = Math.random) {
  let n = 0
  const pick = () => pool[Math.floor(rng() * pool.length)]
  return {
    /**
     * One fresh tile. `reject` vetoes candidates (used to keep a freshly dealt
     * board free of ready-made lines); it is advisory — after enough refusals
     * any tile beats a hole in the grid.
     */
    deal(reject = null) {
      for (let i = 0; i < 30; i++) {
        const tile = pick()
        if (tile && !(reject && reject(tile))) return { ...tile, id: `c${++n}` }
      }
      return { ...pick(), id: `c${++n}` }
    },
  }
}


// ── Levels ───────────────────────────────────────────────────────────────

/**
 * The four categories a level plays with.
 *
 * Gender mode has exactly four to begin with, so every level is m/f/n/pl; case
 * mode picks four of the six, which is what keeps successive levels from being
 * the same game — and what stops the board being a soup of all six at once.
 *
 * @param {'gender'|'case'} mode
 * @param {() => number} [rng]
 * @returns {string[]} four categories, in the axis's canonical order
 */
export function pickCategories(mode, rng = Math.random) {
  const all = FEATURES[mode]
  if (all.length <= LEVEL_CATEGORIES) return [...all]
  return orderFeatures(shuffle([...all], rng).slice(0, LEVEL_CATEGORIES), mode)
}

/**
 * How long a tile takes to fall one row at `level`.
 *
 * Geometric rather than linear, and floored: the first levels want to be
 * readable — a learner has to actually parse the form, which is the whole
 * exercise — and the last want to be faster than comfortable. Level one crosses
 * the board in about six seconds and the floor in about two, and the floor is
 * far enough above a frame that the fall is always something the eye follows.
 */
export function dropMsFor(level) {
  return Math.max(260, Math.round(800 * 0.88 ** (level - 1)))
}

/**
 * Tiles from `pool` that carry at least one of `categories`, re-weighted so
 * each of the four is about as likely as the others.
 *
 * Both halves matter. The filter is what makes a level's four categories real
 * rather than decorative — a tile with none of them could never clear and would
 * silently fill a column. The weighting is what the gender mode needs: taken
 * raw, half a noun's cells are plural and every gender collapses into `pl`
 * there, so a board where nearly every stack is a plural stack asks nothing.
 */
export function levelDeck(pool, mode, categories, { rng = Math.random } = {}) {
  const buckets = categories
    .map((category) => pool.filter((tile) => featuresOf(tile, mode).includes(category)))
    .filter((bucket) => bucket.length)
  if (!buckets.length) return []
  const shuffled = buckets.map((bucket) => shuffle(bucket, rng))
  const depth = Math.min(...shuffled.map((bucket) => bucket.length))
  const deck = []
  for (let i = 0; i < depth; i++) for (const bucket of shuffled) deck.push(bucket[i])
  return deck
}

// ── The board ────────────────────────────────────────────────────────────
// A board is `cols`, one array per column, ordered BOTTOM FIRST: index 0 rests
// on the floor. Bottom-first because gravity is then a `push`/`splice` rather
// than an index flip on every read, and every rule here is about what sits on
// what.

/** An empty board for a level. */
export function createBoard(mode, categories, { rows = ROWS, columns = COLUMNS, run = RUN } = {}) {
  return { rows, run, mode, categories, cols: Array.from({ length: columns }, () => []) }
}

/** How many tiles are stacked in column `c`. */
export function heightOf(board, c) {
  return board.cols[c]?.length ?? 0
}

/** The tallest column — what decides whether the board has topped out. */
export function tallest(board) {
  return Math.max(0, ...board.cols.map((col) => col.length))
}

/** Whether a column has reached the ceiling, which ends the game. */
export function isToppedOut(board) {
  return tallest(board) >= board.rows
}

/** A copy of `board` with `tile` dropped onto column `c`. */
export function landTile(board, c, tile) {
  const cols = board.cols.map((col, i) => (i === c ? [...col, tile] : col))
  return { ...board, cols }
}

/**
 * Yoshi's move: two adjacent columns exchange their whole stacks.
 *
 * Whole stacks rather than single tiles, because that is the move the game is
 * built on — it is how a tile at the bottom of one column ever meets its match,
 * and it makes a swap a decision about two futures rather than one pair. It is
 * free and unlimited; the pressure is the falling tile, not a move budget.
 */
export function swapColumns(board, a, b) {
  if (a === b || !board.cols[a] || !board.cols[b]) return board
  const cols = board.cols.slice()
  ;[cols[a], cols[b]] = [cols[b], cols[a]]
  return { ...board, cols }
}

/** Whether two columns are side by side. */
export function adjacentColumns(a, b) {
  return Math.abs(a - b) === 1
}

/**
 * Every run of `board.run` or more stacked tiles in one column that all carry
 * one of the level's categories, reported once per category.
 *
 * Per category rather than per run because the same run can fire twice: three
 * tiles that are all genitive *and* accusative are two clears, and the chase
 * window is paid per category fired.
 *
 * @returns {Array<{col: number, from: number, to: number, category: string}>}
 *   `from`/`to` are inclusive bottom-first indices into that column.
 */
export function findRuns(board) {
  const out = []
  for (let c = 0; c < board.cols.length; c++) {
    const col = board.cols[c]
    for (const category of board.categories) {
      let start = -1
      for (let i = 0; i <= col.length; i++) {
        const carries = i < col.length && featuresOf(col[i], board.mode).includes(category)
        if (carries) {
          if (start < 0) start = i
        } else {
          const run = board.run ?? RUN
          if (start >= 0 && i - start >= run) out.push({ col: c, from: start, to: i - 1, category })
          start = -1
        }
      }
    }
  }
  return out
}

/** The distinct categories `runs` fired on — what the chase window is paid in. */
export function firedCategories(runs, mode) {
  return orderFeatures(
    runs.map((r) => r.category),
    mode,
  )
}

/** Column index → the set of positions `runs` cover there. */
function runCells(runs) {
  const byCol = new Map()
  for (const run of runs) {
    const set = byCol.get(run.col) ?? new Set()
    for (let i = run.from; i <= run.to; i++) set.add(i)
    byCol.set(run.col, set)
  }
  return byCol
}

/** A copy of `board` with the given positions removed and the rest closed up. */
export function removeCells(board, byCol) {
  const cols = board.cols.map((col, c) => {
    const drop = byCol.get(c)
    return drop ? col.filter((_, i) => !drop.has(i)) : col
  })
  return { ...board, cols }
}

/**
 * Resolve one round of clearing, or null when the board is settled.
 *
 * One step rather than the whole cascade so the view can show each collapse
 * landing before the next one starts; the caller loops until it gets null.
 *
 * @returns {?{runs: Array, cleared: Array, categories: string[], board: PlainObject}}
 */
export function nextClear(board) {
  const runs = findRuns(board)
  if (!runs.length) return null
  const byCol = runCells(runs)
  const cleared = []
  for (const [c, positions] of byCol) for (const i of positions) cleared.push(board.cols[c][i])
  return {
    runs,
    cleared,
    categories: firedCategories(runs, board.mode),
    board: removeCells(board, byCol),
  }
}

// ── The chase window ─────────────────────────────────────────────────────
// A clear pays out in seconds: one per category it fired on. While the window
// is open a tap on any *other* tile carrying one of those categories takes it
// off the board — which is both a reprieve when the stacks are high and the
// only way to reach a tile the swaps cannot help.

/** How long a chase window paid for by `categories` stays open. */
export function chaseWindowMs(categories) {
  return categories.length * CHASE_MS_PER_FEATURE
}

/** Whether the tile at (col, i) carries one of the window's categories. */
export function isChaseHit(board, categories, c, i) {
  const tile = board.cols[c]?.[i]
  return !!tile && featuresOf(tile, board.mode).some((f) => categories.includes(f))
}

/** Every stacked tile a chase tap could legally take, as {col, i} pairs. */
export function chaseTargets(board, categories) {
  const out = []
  for (let c = 0; c < board.cols.length; c++) {
    for (let i = 0; i < board.cols[c].length; i++) {
      if (isChaseHit(board, categories, c, i)) out.push({ col: c, i })
    }
  }
  return out
}

/** A copy of `board` with one tile taken out of a column. */
export function removeOne(board, c, i) {
  return removeCells(board, new Map([[c, new Set([i])]]))
}

// ── Scoring ──────────────────────────────────────────────────────────────

/**
 * What a cascade step is worth. Depth 0 is the stack the player built; each
 * further collapse it sets off is worth one more multiple, because a cascade
 * the player set up is the thing worth setting up.
 */
export function stepScore(cleared, depth) {
  return cleared * TILE_SCORE * (depth + 1)
}

/**
 * What a chase tap is worth: the flat rate times how deep into this window's
 * streak it is (1-based), so a window ridden to four taps pays 1+2+3+4 times
 * the rate rather than four.
 */
export function chaseScore(streak) {
  return CHASE_SCORE * streak
}

/** Which level `cleared` tiles into a run the player is on (1-based). */
export function levelFor(cleared) {
  return Math.floor(cleared / CLEARS_PER_LEVEL) + 1
}

// ── Word cards ───────────────────────────────────────────────────────────

/**
 * The card a tile earns: what the word *is*, as opposed to the slot the board
 * was testing. The uninflected headword and its English, plus the form that was
 * actually on the board so the player can connect the two.
 */
export function cardFor(tile) {
  return { key: tile.key, lemma: tile.lemma, en: tile.en, pos: tile.pos, form: tile.form }
}

/**
 * Append cards for `tiles` to `queue`, one per word.
 *
 * Deduplicated against the queue rather than against the whole game: clearing a
 * stack of нового/новому/новом should say "но́вый" once, but meeting the word
 * again ten drops later is a fresh occasion to be told.
 */
export function queueCards(queue, tiles) {
  const seen = new Set(queue.map((card) => card.key))
  const out = queue.slice()
  for (const tile of tiles) {
    if (!tile || seen.has(tile.key)) continue
    seen.add(tile.key)
    out.push(cardFor(tile))
  }
  return out
}
