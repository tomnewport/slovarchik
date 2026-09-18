// Inflection crush minigame (#751).
//
// Candy Crush with grammar: the tiles are inflected Russian forms and a line
// matches on a *feature* — a gender in one mode, a case in the other — rather
// than on a colour. Everything that decides what a tile could be, what clears,
// what falls and what the chase window is worth lives here, pure and seedable;
// the view owns the clock and the animation and nothing else.
//
// Three ideas carry the whole thing:
//
//   - A TILE is one surface form plus the features it *could* carry. A form is
//     rarely one slot: кни́ги is genitive singular and nominative plural, но́вого
//     is masculine and neuter, and an animate accusative wears the genitive's
//     clothes. Reading a form as everything it might be is the skill the game
//     drills, so a tile holds a *set* of features and a line under either
//     reading is legitimate.
//   - A MATCH is a maximal run of three or more consecutive tiles that all
//     carry one feature. Per feature rather than per run, because the same run
//     can fire twice — three tiles that are all both genitive and accusative
//     are two matches, and the chase window below is paid per feature fired.
//   - The CHASE window is what the fired features buy: one second each, to tap
//     any other tile in the grid carrying one of them.
//
// Why features are derived from `buildParadigm` rather than read out of the
// YAML: nouns are stored as case × number and adjectives as case × gender, and
// the paradigm model already reconciles the two into one { rows, cols, cells }
// shape — including the derived animate-accusative row. Deriving here would be
// a second opinion on the corpus, and two opinions drift.

import { ACC_ANIMATE, CASES, CASE_LABELS } from './declension.js'
import { buildParadigm } from './paradigm.js'
import { shuffle } from './quiz.js'

/** The two axes a grid can match on. */
export const MODES = Object.freeze(['gender', 'case'])

/** Agreement features: the three genders in the singular, plus the plural. */
export const GENDERS = Object.freeze(['m', 'f', 'n', 'pl'])

/** The features each mode matches on, in display order. */
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
 * The same features abbreviated, for the chase bar — which is one line on a
 * phone with a countdown already in it, and «dative or nominative or
 * accusative» does not fit on one line.
 */
export const FEATURE_SHORT = Object.freeze({
  m: 'masc',
  f: 'fem',
  n: 'neut',
  pl: 'plur',
  ...Object.fromEntries(CASES.map((c) => [c, c])),
})

/** The levels a minigame may draw on — the ones a learner here is working in. */
export const ELIGIBLE_CEFR = Object.freeze(['A1', 'A2', 'B1'])

/**
 * Longest form that still reads on a phone-width tile. Russian obliques run
 * long (кори́чневыми is eleven letters before the stress mark), and a grid cell
 * that has to shrink to 8px to fit its word is a cell nobody reads.
 */
export const MAX_FORM_LENGTH = 10

/** Points for a tile cleared by a swap, before the cascade multiplier. */
export const TILE_SCORE = 10
/** Points for a tile cleared by a chase tap. */
export const CHASE_SCORE = 25
/** How long one fired feature keeps the chase window open. */
export const CHASE_MS_PER_FEATURE = 1000

/** Swaps a run allows before the summary. The chase window is the pressure. */
export const MOVES_PER_GAME = 20

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
 * Re-weight a pool so each of the mode's features is about as likely as the
 * others.
 *
 * Taken raw, the corpus is lopsided in a way that would spoil the gender game:
 * half of a noun's cells are plural and every gender collapses into `pl` there,
 * so `pl` is a third of the pool and neuter a seventh. A board where nearly
 * every triple is a plural triple asks nothing.
 *
 * The fix is a deck rather than a filter: one bucket per feature, shuffled, and
 * drawn round-robin to the depth of the *smallest* bucket. A tile carrying two
 * features (но́вым is masculine and plural) sits in both buckets and is
 * correspondingly likelier — which is right, since it is likelier to be useful.
 *
 * @returns {Array<PlainObject>} the deck a dealer should draw from
 */
export function balancedDeck(pool, mode, { rng = Math.random } = {}) {
  const buckets = FEATURES[mode]
    .map((feature) => pool.filter((tile) => featuresOf(tile, mode).includes(feature)))
    .filter((bucket) => bucket.length)
  if (!buckets.length) return pool.slice()
  const shuffled = buckets.map((bucket) => shuffle(bucket, rng))
  const depth = Math.min(...shuffled.map((bucket) => bucket.length))
  const deck = []
  for (let i = 0; i < depth; i++) for (const bucket of shuffled) deck.push(bucket[i])
  return deck
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

/** The tile at (r, c), or undefined off the board. */
export function at(grid, r, c) {
  if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) return undefined
  return grid.cells[r * grid.cols + c]
}

const cellKey = (r, c) => `${r},${c}`

/** A grid with two cells exchanged. Neither argument is mutated. */
export function swapped(grid, a, b) {
  const cells = grid.cells.slice()
  const i = a.r * grid.cols + a.c
  const j = b.r * grid.cols + b.c
  ;[cells[i], cells[j]] = [cells[j], cells[i]]
  return { ...grid, cells }
}

/** Whether two cells are orthogonally adjacent. */
export function adjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1
}

/**
 * Every maximal run of three or more in a row or column whose tiles all carry
 * one feature, reported once per feature.
 *
 * @returns {Array<{feature: string, dir: 'row'|'col', cells: Array<{r: number, c: number}>}>}
 */
export function findMatches(grid, mode = grid.mode) {
  const out = []
  // One pass per (feature, line): walk the line and close a run whenever the
  // feature stops. The trailing index runs one past the end so a run finishing
  // at the edge is closed by the same branch as any other.
  const scan = (dir, lines, length, cellOf) => {
    for (const feature of FEATURES[mode]) {
      for (let line = 0; line < lines; line++) {
        let run = []
        for (let i = 0; i <= length; i++) {
          const cell = i < length ? cellOf(line, i) : null
          const tile = cell && at(grid, cell.r, cell.c)
          if (tile && featuresOf(tile, mode).includes(feature)) {
            run.push(cell)
          } else {
            if (run.length >= 3) out.push({ feature, dir, cells: run })
            run = []
          }
        }
      }
    }
  }
  scan('row', grid.rows, grid.cols, (r, c) => ({ r, c }))
  scan('col', grid.cols, grid.rows, (c, r) => ({ r, c }))
  return out
}

/** The distinct cells covered by `matches`, as "r,c" keys. */
export function matchedCells(matches) {
  const keys = new Set()
  for (const m of matches) for (const cell of m.cells) keys.add(cellKey(cell.r, cell.c))
  return keys
}

/** The distinct features `matches` fired on — what the chase window is paid in. */
export function firedFeatures(matches, mode) {
  return orderFeatures(
    matches.map((m) => m.feature),
    mode,
  )
}

/** Whether any single adjacent swap would produce a match. */
export function hasLegalMove(grid, mode = grid.mode) {
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      for (const b of [
        { r, c: c + 1 },
        { r: r + 1, c },
      ]) {
        if (!at(grid, b.r, b.c)) continue
        if (findMatches(swapped(grid, { r, c }, b), mode).length) return true
      }
    }
  }
  return false
}

/**
 * Clear `keys`, let the survivors fall and deal replacements into the gaps.
 * Column by column, so a tile only ever falls straight down.
 *
 * The replacements are held to the same rule as the opening deal: a fresh tile
 * that would land already three in a line is refused. Without it the board
 * cascades on nearly every move — the corpus puts an average of 1.4 case
 * readings on a tile, which makes a random triple far likelier to match than a
 * Candy Crush colour — and a board that scores itself is not being played. What
 * survives is the cascade the player actually earned: survivors that line up on
 * the way down.
 *
 * The gaps are filled bottom-up so each new tile sees as many settled
 * neighbours as it can; the dealer's veto is advisory, so an impossible corner
 * still gets a tile rather than a hole.
 */
export function collapse(grid, keys, dealer) {
  const cells = new Array(grid.rows * grid.cols).fill(null)
  const gaps = []
  for (let c = 0; c < grid.cols; c++) {
    const kept = []
    for (let r = 0; r < grid.rows; r++) {
      if (!keys.has(cellKey(r, c))) kept.push(at(grid, r, c))
    }
    const drop = grid.rows - kept.length
    for (let r = 0; r < grid.rows; r++) {
      if (r < drop) gaps.push({ r, c })
      else cells[r * grid.cols + c] = kept[r - drop]
    }
  }
  const next = { ...grid, cells }
  gaps.sort((a, b) => b.r - a.r || a.c - b.c)
  for (const { r, c } of gaps) {
    cells[r * grid.cols + c] = dealer.deal((tile) => completesRun(next, r, c, tile))
  }
  return next
}

/**
 * Resolve one round of matching, or null when the board is settled.
 *
 * One step rather than the whole cascade so the view can show each clear
 * landing before the next one starts; the caller loops until it gets null.
 *
 * @returns {?{matches: Array, keys: Set<string>, cleared: Array, features: string[], grid: PlainObject}}
 */
export function nextStep(grid, dealer, mode = grid.mode) {
  const matches = findMatches(grid, mode)
  if (!matches.length) return null
  const keys = matchedCells(matches)
  const cleared = [...keys].map((k) => {
    const [r, c] = k.split(',').map(Number)
    return at(grid, r, c)
  })
  return {
    matches,
    keys,
    cleared,
    features: firedFeatures(matches, mode),
    grid: collapse(grid, keys, dealer),
  }
}

/**
 * Would putting `tile` at (r, c) finish a run of three?
 *
 * Checks the six pairs a third tile can complete — two to a side and one either
 * side, in both directions — and ignores any pair with a cell that is empty or
 * off the board, so the same test serves a board being dealt (where everything
 * ahead is still empty) and a gap being refilled (where most of it is settled).
 */
export function completesRun(grid, r, c, tile, mode = grid.mode) {
  const features = featuresOf(tile, mode)
  if (!features.length) return false
  const pairs = [
    [[r, c - 1], [r, c - 2]],
    [[r, c - 1], [r, c + 1]],
    [[r, c + 1], [r, c + 2]],
    [[r - 1, c], [r - 2, c]],
    [[r - 1, c], [r + 1, c]],
    [[r + 1, c], [r + 2, c]],
  ]
  return pairs.some((pair) => {
    const neighbours = pair.map(([rr, cc]) => at(grid, rr, cc))
    if (neighbours.some((t) => !t)) return false
    return features.some((f) => neighbours.every((t) => featuresOf(t, mode).includes(f)))
  })
}

/**
 * Deal a board that is stable and playable: no line of three already on it, and
 * at least one swap that would make one.
 *
 * Stability is enforced as the board is dealt — a candidate that would complete
 * a run with the two cells already to its left or above it is refused — rather
 * than by dealing and re-dealing whole boards, which at 5×6 fails far too often
 * to converge. Playability can only be checked once the board is whole, so that
 * one *is* a retry; `attempts` bounds it, and the last board is returned either
 * way. A board with no legal move is not a broken board — the view offers a
 * reshuffle, which is this same call again.
 */
export function generateGrid(dealer, { rows = 6, cols = 5, mode = 'case', attempts = 12 } = {}) {
  let grid = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    const cells = new Array(rows * cols).fill(null)
    const partial = { rows, cols, mode, cells }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells[r * cols + c] = dealer.deal((tile) => completesRun(partial, r, c, tile))
      }
    }
    grid = partial
    if (!findMatches(grid, mode).length && hasLegalMove(grid, mode)) return grid
  }
  return grid
}

/** How long a chase window paid for by `features` stays open. */
export function chaseWindowMs(features) {
  return features.length * CHASE_MS_PER_FEATURE
}

/** Every cell carrying one of `features` — what a chase tap may legally hit. */
export function chaseTargets(grid, features, mode = grid.mode) {
  const out = []
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const tile = at(grid, r, c)
      if (tile && featuresOf(tile, mode).some((f) => features.includes(f))) out.push({ r, c })
    }
  }
  return out
}

/** Whether the tile at (r, c) carries one of the window's features. */
export function isChaseHit(grid, features, r, c, mode = grid.mode) {
  const tile = at(grid, r, c)
  return !!tile && featuresOf(tile, mode).some((f) => features.includes(f))
}

/**
 * What a cascade step is worth. Depth 0 is the swap's own clear; each further
 * step it sets off is worth one more multiple, because a cascade the player set
 * up is the thing worth setting up.
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

/**
 * The card a tile earns: what the word *is*, as opposed to the slot the grid
 * was testing. The uninflected headword and its English, plus the form that was
 * actually on the board so the player can connect the two.
 */
export function cardFor(tile) {
  return { key: tile.key, lemma: tile.lemma, en: tile.en, pos: tile.pos, form: tile.form }
}

/**
 * Append cards for `tiles` to `queue`, one per word.
 *
 * Deduplicated against the queue rather than against the whole game: clearing
 * a line of five нового/новому/новом should say "но́вый" once, but meeting the
 * word again ten moves later is a fresh occasion to be told.
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
