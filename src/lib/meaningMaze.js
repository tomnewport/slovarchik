// Meaning maze minigame (#752).
//
// A grid of words, Russian and English alternating like a chessboard, with one
// path of adjacent translation pairs running from the start to the end. The
// player draws that path. Everything that decides what a maze *is* and what a
// move *does* lives here — pure, seedable, framework free. The view owns the
// clock, the drawing and the lens, and nothing else.
//
// Three ideas carry the whole model:
//
//   - THE CHESSBOARD. `(r + c) % 2 === 0` is Russian, everything else English,
//     so every orthogonal neighbour of a Russian word is an English one. The
//     alternation is a property of the coordinates rather than something the
//     generator has to police.
//
//   - THE HALF-RESOLUTION LATTICE. The solution is carved over the even/even
//     cells ("nodes") and expanded: node → midpoint → node. Both the nodes and
//     the midpoint between them fall out of that one carve, which makes two
//     awkward things free. A midpoint is on the path only when both of its end
//     nodes are consecutive on it, so the solution can never run alongside
//     itself and offer a shortcut; and every node is Russian while every
//     midpoint is English, which is exactly the shape the rules want — the
//     graded half-step is always node → midpoint.
//
//   - NO UNINTENDED VALID ADJACENCY. Every word is placed by rejection
//     sampling against its already-placed neighbours, so the only Russian →
//     English links on the board are the ones the generator meant to put there.
//     That invariant is what makes the solution unique, the dead ends really
//     dead, and a refusal always fair: no correct answer is ever turned down,
//     because a correct answer nobody intended was never placed.
//
// The asymmetry of the two half-steps is the game. From a Russian word you may
// move only to its English translation; from an English word you may move to
// any adjacent Russian word, free. So the branching sits on the English cells
// and the knowledge sits on the Russian ones, and a Russian word whose
// translation is not among its neighbours is a dead end — finding that out is
// the exercise.
import { shuffle } from './quiz.js'
import { foldYo, stripStress } from './text.js'

/**
 * @typedef {object} PoolWord
 * @property {string} key       the corpus key, so a cell can be traced back
 * @property {string} ru        the accented headword, as displayed
 * @property {string} en        the gloss chosen for display (the shortest usable one)
 * @property {string[]} glosses every accepted gloss, as `glossKey` normalises it
 */

/**
 * @typedef {object} Cell
 * @property {number} i       index into `maze.cells` (`r * size + c`)
 * @property {number} r
 * @property {number} c
 * @property {'ru'|'en'} side
 * @property {string} text    what the cell shows
 * @property {string} key     the corpus key of the word it shows, or ''
 * @property {string} norm    `glossKey(text)` on an English cell, '' on a Russian one
 * @property {string[]} glosses  every accepted gloss of a Russian cell's word, else []
 */

/**
 * @typedef {object} Maze
 * @property {number} size
 * @property {Cell[]} cells
 * @property {number} start       index of the entrance (a Russian cell)
 * @property {number} goal        index of the exit (a Russian cell)
 * @property {number[]} solution  the whole path, entrance to exit, midpoints included
 */

/** The levels a maze draws on. The whole of A1–B1 is fair game. */
export const LEVELS = ['A1', 'A2', 'B1']
/** Offered board sizes. Odd only: both corners have to be Russian nodes. */
export const SIZES = [13, 17, 25]
export const DEFAULT_SIZE = 25

/**
 * Length caps on what may go in a cell. A 25-wide board gives each word about
 * 4% of the grid's width, so a long word is unreadable even hyphenated — and an
 * unreadable cell is not a decision, it is a trip to the lens. Measured on the
 * unstressed form, since a combining acute adds a code unit and no width.
 */
const MAX_RU_CHARS = 13
const MAX_EN_CHARS = 16

/**
 * Normalise a gloss for comparison. Deliberately loose: it folds case,
 * punctuation and a leading article or infinitive `to`, so "to go" and "go" are
 * one and the same answer.
 *
 * It is used for *both* jobs — deciding whether a link is valid and deciding
 * whether a filler may be placed — and using one function for both is the
 * point. A looser match accepts more answers, and because placement rejects on
 * the same key, every extra answer it accepts is one the generator has already
 * guaranteed is not on the board by accident.
 * @param {string} text
 * @returns {string}
 */
export function glossKey(text) {
  const base = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return base.replace(/^(?:to|a|an|the)\s+/u, '')
}

/** The Russian identity of a headword: unstressed, ё folded, lower case. */
const ruKeyOf = (ru) => foldYo(stripStress(String(ru ?? ''))).toLowerCase()

/**
 * The words a maze may draw on, from shaped vocabulary (`stores/vocab`'s
 * `vocab` computed: `{ id, ru, en: string[], cefr }`).
 *
 * Two entries showing the same thing would make a cell ambiguous to read and a
 * link ambiguous to grade, so the pool is deduplicated on both sides: one entry
 * per Russian headword, one per displayed gloss.
 * @param {{id: string, ru: string, en: string[], cefr: string|null}[]} words
 * @param {{levels?: string[], maxRu?: number, maxEn?: number}} [opts]
 * @returns {PoolWord[]}
 */
export function mazeWordPool(words, opts = {}) {
  const levels = opts.levels ?? LEVELS
  const maxRu = opts.maxRu ?? MAX_RU_CHARS
  const maxEn = opts.maxEn ?? MAX_EN_CHARS
  /** @type {PoolWord[]} */
  const pool = []
  const seenRu = new Set()
  const seenEn = new Set()
  for (const w of words ?? []) {
    if (!levels.includes(String(w?.cefr))) continue
    const ru = String(w.ru ?? '').trim()
    if (!ru || stripStress(ru).length > maxRu) continue
    const glosses = (w.en ?? []).map((g) => String(g ?? '').trim()).filter(Boolean)
    // A gloss carrying a clarification — "bow (of a ship)", "spring; source" —
    // is a sentence, not a tile. Drop those rather than truncate them.
    const usable = glosses.filter((g) => g.length <= maxEn && !/[;/(]/.test(g))
    if (!usable.length) continue
    const en = usable.slice().sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
    const rk = ruKeyOf(ru)
    const ek = glossKey(en)
    if (!rk || !ek || seenRu.has(rk) || seenEn.has(ek)) continue
    seenRu.add(rk)
    seenEn.add(ek)
    pool.push({ key: String(w.id), ru, en, glosses: [...new Set(glosses.map(glossKey))] })
  }
  return pool
}

/** Which language a cell speaks, from its coordinates alone. */
export const sideAt = (r, c) => ((r + c) % 2 === 0 ? 'ru' : 'en')

/** Whether a cell is a lattice node — one of the even/even cells the path turns on. */
export const isNode = (r, c) => r % 2 === 0 && c % 2 === 0

/** The largest offered board a pool of this many words can fill. */
export function largestSize(poolSize) {
  const fits = SIZES.filter((s) => s * s <= poolSize)
  return fits.length ? fits[fits.length - 1] : 0
}

/**
 * The orthogonal neighbours of a cell, as indices.
 * @param {number} size
 * @param {number} i
 * @returns {number[]}
 */
export function neighbours(size, i) {
  const r = Math.floor(i / size)
  const c = i % size
  const out = []
  if (r > 0) out.push(i - size)
  if (r < size - 1) out.push(i + size)
  if (c > 0) out.push(i - 1)
  if (c < size - 1) out.push(i + 1)
  return out
}

/** Whether two cell indices are orthogonally adjacent. */
export function adjacent(size, a, b) {
  const dr = Math.abs(Math.floor(a / size) - Math.floor(b / size))
  const dc = Math.abs((a % size) - (b % size))
  return dr + dc === 1
}

/**
 * One randomised-DFS spanning tree of the node lattice, reduced to the path
 * from node 0 (top left) to node n²−1 (bottom right).
 * @param {number} n
 * @param {() => number} rng
 * @returns {number[]}
 */
function spanningTreePath(n, rng) {
  const total = n * n
  const visited = new Uint8Array(total)
  const parent = new Int32Array(total).fill(-1)
  const stack = [0]
  visited[0] = 1
  while (stack.length) {
    const cur = stack[stack.length - 1]
    const open = neighbours(n, cur).filter((k) => !visited[k])
    if (!open.length) {
      stack.pop()
      continue
    }
    const next = open[Math.floor(rng() * open.length)]
    visited[next] = 1
    parent[next] = cur
    stack.push(next)
  }
  const rev = []
  for (let k = total - 1; k !== -1; k = parent[k]) rev.push(k)
  return rev.reverse()
}

/**
 * Carve the solution over the node lattice: a randomised-DFS spanning tree of
 * the `n × n` nodes, then the tree's own path from one corner to the other.
 *
 * A spanning tree rather than a search *for the goal*, because the tree cannot
 * fail. A search that marks nodes visited and never unmarks them can wall the
 * goal off and come back empty; a recursive backtracker visits every node, so
 * the goal always has a parent chain and the path always exists. What it does
 * not give is a length — the raw median on a 13-node lattice is around 73 nodes
 * — so a band is asked for and the best of a few trees is kept. Too short is a
 * board the player walks through; too long is one they stop enjoying. A tree
 * costs microseconds and roughly one in five lands in the band, so the default
 * number of tries is high enough (32) that missing it is a one-in-three-hundred
 * board rather than a one-in-fourteen one.
 * @param {number} n  nodes per side
 * @param {() => number} [rng]
 * @param {{minNodes?: number, maxNodes?: number, tries?: number}} [opts]
 * @returns {number[]} node indices (`nr * n + nc`), corner to corner
 */
export function carveNodePath(n, rng = Math.random, opts = {}) {
  const min = opts.minNodes ?? 2 * n + 4
  const max = opts.maxNodes ?? 4 * n
  const tries = opts.tries ?? 32
  // Only ever asked about a length already known to be outside the band, so
  // one comparison settles which side it missed on.
  const miss = (len) => (len < min ? min - len : len - max)
  /** @type {number[]} */
  let best = []
  for (let t = 0; t < tries; t++) {
    const path = spanningTreePath(n, rng)
    if (path.length >= min && path.length <= max) return path
    if (!best.length || miss(path.length) < miss(best.length)) best = path
  }
  return best
}

/**
 * Expand a node path into the cells it runs through: node, midpoint, node, …
 * @param {number[]} nodePath node indices on an `n × n` lattice
 * @param {number} n
 * @param {number} size  cells per side (`2n − 1`)
 * @returns {number[]} cell indices
 */
export function solutionCells(nodePath, n, size) {
  const out = []
  for (let k = 0; k < nodePath.length; k++) {
    const r = 2 * Math.floor(nodePath[k] / n)
    const c = 2 * (nodePath[k] % n)
    if (k > 0) {
      const pr = 2 * Math.floor(nodePath[k - 1] / n)
      const pc = 2 * (nodePath[k - 1] % n)
      out.push(((r + pr) / 2) * size + (c + pc) / 2)
    }
    out.push(r * size + c)
  }
  return out
}

/**
 * Build a maze.
 * @param {PoolWord[]} pool
 * @param {{size?: number, rng?: () => number, decoyChance?: number, decoyDepth?: number}} [opts]
 * @returns {Maze}
 */
export function generateMaze(pool, opts = {}) {
  const size = opts.size ?? DEFAULT_SIZE
  const rng = opts.rng ?? Math.random
  const decoyChance = opts.decoyChance ?? 0.4
  const decoyDepth = opts.decoyDepth ?? 3
  if (size < 5 || size % 2 === 0) throw new Error(`maze size must be odd and at least 5: ${size}`)
  const n = (size + 1) / 2

  /** @type {Cell[]} */
  const cells = Array.from({ length: size * size }, (_, i) => ({
    i,
    r: Math.floor(i / size),
    c: i % size,
    side: sideAt(Math.floor(i / size), i % size),
    text: '',
    key: '',
    norm: '',
    glosses: [],
  }))

  const bag = shuffle(pool ?? [], rng)
  const used = new Uint8Array(bag.length)
  let cursor = 0
  /**
   * Draw the first unused word the board will accept, falling back to any
   * unused word when none will do. The fallback is all but unreachable with a
   * real pool — a filler is asked to avoid at most four specific meanings out
   * of hundreds — but a board one link looser beats a game that throws.
   * @param {(w: PoolWord) => boolean} ok
   * @returns {PoolWord|null}
   */
  const draw = (ok) => {
    let fallback = -1
    for (let k = cursor; k < bag.length; k++) {
      if (used[k]) continue
      if (fallback === -1) fallback = k
      if (!ok(bag[k])) continue
      used[k] = 1
      while (cursor < bag.length && used[cursor]) cursor++
      return bag[k]
    }
    if (fallback === -1) return null
    used[fallback] = 1
    while (cursor < bag.length && used[cursor]) cursor++
    return bag[fallback]
  }

  const assigned = new Uint8Array(cells.length)
  /** Put a word's Russian side in a cell. */
  const placeRu = (i, w) => {
    cells[i].text = w.ru
    cells[i].key = w.key
    cells[i].glosses = w.glosses
    assigned[i] = 1
  }
  /** Put a word's English side in a cell. */
  const placeEn = (i, w) => {
    cells[i].text = w.en
    cells[i].key = w.key
    cells[i].norm = glossKey(w.en)
    assigned[i] = 1
  }
  /** Whether a Russian word may go here: no placed neighbour already glosses it. */
  const ruFits = (i, w) =>
    neighbours(size, i).every((k) => !assigned[k] || !w.glosses.includes(cells[k].norm))
  /** Whether a gloss may go here: no placed neighbour is a word it translates. */
  const enFits = (i, w) => {
    const norm = glossKey(w.en)
    return neighbours(size, i).every((k) => !assigned[k] || !cells[k].glosses.includes(norm))
  }

  const nodePath = carveNodePath(n, rng)
  const solution = solutionCells(nodePath, n, size)
  const onPath = new Uint8Array(cells.length)
  for (const i of solution) onPath[i] = 1

  // The path, in order. Even positions are nodes (Russian), odd ones midpoints
  // (English), and node `k` is glossed by the midpoint *after* it, so the only
  // valid link out of a path node runs forwards. The last node has no midpoint
  // after it: that is the exit, and nothing leads out of it.
  for (let p = 0; p < solution.length; p += 2) {
    const w = draw((cand) => ruFits(solution[p], cand))
    if (!w) throw new Error('not enough words to build a maze')
    placeRu(solution[p], w)
    if (p + 1 < solution.length) placeEn(solution[p + 1], w)
  }

  // False routes: real translation pairs hanging off the path, so that a valid
  // link is not by itself proof of being on it. A decoy's English cell may not
  // touch a path node, or the player could step off the decoy straight back
  // onto the solution further along and skip whatever lay between.
  const touchesPath = (i) => neighbours(size, i).some((k) => cells[k].side === 'ru' && onPath[k])
  const pick = (list) => list[Math.floor(rng() * list.length)]
  for (let p = 1; p < solution.length; p += 2) {
    if (rng() >= decoyChance) continue
    let from = solution[p]
    const depth = 1 + Math.floor(rng() * decoyDepth)
    for (let d = 0; d < depth; d++) {
      const ruOpts = neighbours(size, from).filter(
        (k) => cells[k].side === 'ru' && !assigned[k] && !onPath[k],
      )
      if (!ruOpts.length) break
      const ru = pick(ruOpts)
      const enOpts = neighbours(size, ru).filter(
        (k) => cells[k].side === 'en' && !assigned[k] && !onPath[k] && !touchesPath(k),
      )
      if (!enOpts.length) break
      const en = pick(enOpts)
      const w = draw((cand) => ruFits(ru, cand) && enFits(en, cand))
      if (!w) break
      placeRu(ru, w)
      placeEn(en, w)
      from = en
    }
  }

  // Fillers. Russian first, so that by the time a gloss is placed, every
  // Russian neighbour it has to avoid is already on the board.
  for (const cell of cells) {
    if (assigned[cell.i] || cell.side !== 'ru') continue
    const w = draw((cand) => ruFits(cell.i, cand))
    if (!w) throw new Error('not enough words to build a maze')
    placeRu(cell.i, w)
  }
  for (const cell of cells) {
    if (assigned[cell.i] || cell.side !== 'en') continue
    const w = draw((cand) => enFits(cell.i, cand))
    if (!w) throw new Error('not enough words to build a maze')
    placeEn(cell.i, w)
  }

  return { size, cells, start: solution[0], goal: solution[solution.length - 1], solution }
}

/**
 * Whether a link may be drawn from `from` to `to` — the graded half-step.
 * @param {Cell} from
 * @param {Cell} to
 */
export function linkOk(from, to) {
  return from.side === 'ru' && to.side === 'en' && from.glosses.includes(to.norm)
}

/**
 * What tapping `target` does to the drawn path.
 *
 * `backtrack` covers any cell already on the line, not just the one before the
 * head: dragging back across the line retreats along it, which is how a player
 * abandons a false route.
 * @param {Maze} maze
 * @param {number[]} path  cell indices, starting at `maze.start`
 * @param {number} target
 * @returns {{kind: 'extend'|'backtrack'|'refused'|'ignored', to?: number, reason?: string}}
 */
export function moveOutcome(maze, path, target) {
  if (!path.length) return { kind: 'ignored', reason: 'no-path' }
  const head = path[path.length - 1]
  if (target === head) return { kind: 'ignored', reason: 'head' }
  const seen = path.indexOf(target)
  if (seen !== -1) return { kind: 'backtrack', to: seen }
  if (!adjacent(maze.size, head, target)) return { kind: 'ignored', reason: 'not-adjacent' }
  const from = maze.cells[head]
  const to = maze.cells[target]
  // English → any adjacent Russian is free; Russian → English has to be the
  // translation. There is no third case: the chessboard rules it out.
  if (from.side === 'ru' && !linkOk(from, to)) return { kind: 'refused', reason: 'wrong-meaning' }
  return { kind: 'extend' }
}

/**
 * Apply a move, returning the path as it now stands.
 * @param {Maze} maze
 * @param {number[]} path
 * @param {number} target
 * @returns {{kind: string, reason?: string, path: number[], solved: boolean}}
 */
export function advance(maze, path, target) {
  const out = moveOutcome(maze, path, target)
  if (out.kind === 'backtrack') {
    return { kind: out.kind, path: path.slice(0, (out.to ?? 0) + 1), solved: false }
  }
  if (out.kind === 'extend') {
    return { kind: out.kind, path: [...path, target], solved: target === maze.goal }
  }
  return { kind: out.kind, reason: out.reason, path, solved: path[path.length - 1] === maze.goal }
}

/**
 * The cell one step from the head in a direction, or −1 if there is none.
 * Arrow keys are the precise input a 25-wide grid of 15px cells cannot be.
 * @param {Maze} maze
 * @param {number[]} path
 * @param {number} dr
 * @param {number} dc
 */
export function step(maze, path, dr, dc) {
  if (!path.length) return -1
  const head = path[path.length - 1]
  const r = Math.floor(head / maze.size) + dr
  const c = (head % maze.size) + dc
  if (r < 0 || c < 0 || r >= maze.size || c >= maze.size) return -1
  return r * maze.size + c
}

/**
 * The window the lens shows: `span × span` cells around `centre`, clamped to
 * stay on the board so the lens never shows empty space.
 * @param {Maze} maze
 * @param {number} centre  cell index
 * @param {number} span
 * @returns {{r0: number, c0: number, span: number, cells: Cell[]}}
 */
export function lensView(maze, centre, span) {
  const width = Math.min(span, maze.size)
  const reach = Math.floor(width / 2)
  const limit = maze.size - width
  const r0 = Math.min(limit, Math.max(0, Math.floor(centre / maze.size) - reach))
  const c0 = Math.min(limit, Math.max(0, (centre % maze.size) - reach))
  const out = []
  for (let r = r0; r < r0 + width; r++) {
    for (let c = c0; c < c0 + width; c++) out.push(maze.cells[r * maze.size + c])
  }
  return { r0, c0, span: width, cells: out }
}

// ── Fitting a word in a cell ─────────────────────────────────────────────
// A cell on a 25-wide board is a few characters across, so a word that is not
// broken is a word that is not shown. `hyphens: auto` would do this, but only
// where the browser has a hyphenation dictionary for the language — Chromium
// gets Russian from the operating system and often does not have it at all —
// and the fallback, breaking anywhere with no hyphen, leaves the reader unable
// to tell a break from a word boundary. So the breaks are put in as soft
// hyphens here, where they can be tested, and the CSS only has to honour them.
//
// Neither rule is a hyphenation *dictionary*: they are the school rules, which
// are nearly always right on the short words a cell can hold, and wrong in the
// harmless direction — a break in a defensible-but-unusual place — rather than
// producing an unreadable cell.

/** U+00AD: invisible until the line breaks there, and then it is a hyphen. */
const SHY = '\u00ad'
/** Shorter than this and a word fits, or nearly does, so leave it alone. */
const MIN_HYPHENATED = 6
/** Never strand fewer than this many letters on either side of a break. */
const MIN_PIECE = 2

const RU_VOWELS = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ'
/** ь, ъ and й never start a syllable, so they go with the letter before them. */
const RU_STICKY = 'ьъйЬЪЙ'
const EN_VOWELS = 'aeiouyAEIOUY'
/** Two letters that spell one sound: a break between them would mislead. */
const EN_DIGRAPHS = ['ch', 'sh', 'th', 'ph', 'wh', 'gh', 'ck', 'qu']

const isMark = (ch) => ch === '\u0301'

/**
 * Russian: break after a vowel — but close the syllable first. A run of two or
 * more consonants gives one of them to the syllable ending (ком-на-та, not
 * ко-мната), and ь, ъ and й go with the letter before them whatever else
 * happens (боль-ни-ца, never бо-льница).
 */
function ruBreaks(word) {
  const vowel = (k) => k < word.length && RU_VOWELS.includes(word[k])
  const out = []
  for (let i = 0; i < word.length; i++) {
    if (!vowel(i)) continue
    let j = i
    while (j + 1 < word.length && isMark(word[j + 1])) j++
    let run = 0
    while (j + 1 + run < word.length && !vowel(j + 1 + run) && !isMark(word[j + 1 + run])) run++
    if (run >= 2) j++
    while (j + 1 < word.length && (isMark(word[j + 1]) || RU_STICKY.includes(word[j + 1]))) j++
    const rest = word.slice(j + 1)
    if (j + 1 < MIN_PIECE || rest.length < MIN_PIECE) continue
    // A tail with no vowel is not a syllable and cannot be carried over.
    if (![...rest].some((ch) => RU_VOWELS.includes(ch))) continue
    out.push(j + 1)
  }
  return out
}

/** English: split a consonant pair between two vowels, else open the syllable. */
function enBreaks(word) {
  const lower = word.toLowerCase()
  const vowel = (k) => k >= 0 && k < word.length && EN_VOWELS.includes(word[k])
  const out = []
  for (let i = 0; i < word.length - 1; i++) {
    if (!vowel(i) || vowel(i + 1)) continue
    // vowel, then one or two consonants, then a vowel.
    let at = -1
    if (vowel(i + 2)) at = i + 1
    else if (vowel(i + 3) && !EN_DIGRAPHS.includes(lower.slice(i + 1, i + 3))) at = i + 2
    else if (vowel(i + 3)) at = i + 1
    if (at < MIN_PIECE || word.length - at < MIN_PIECE) continue
    // A silent final `e` is not a syllable: participate, not participa-te.
    if (word.length - at === 2 && lower.endsWith('e')) continue
    if (out[out.length - 1] === at) continue
    out.push(at)
  }
  return out
}

/**
 * The word as a cell should show it: the same letters, with soft hyphens where
 * it may be broken. Words are hyphenated one at a time, so a gloss of several
 * words still prefers to break at its spaces.
 * @param {string} text
 * @param {'ru'|'en'} side
 * @returns {string}
 */
export function hyphenate(text, side) {
  return String(text ?? '')
    .split(' ')
    .map((word) => {
      if (word.length < MIN_HYPHENATED) return word
      const breaks = side === 'ru' ? ruBreaks(word) : enBreaks(word)
      if (!breaks.length) return word
      let out = ''
      let from = 0
      for (const at of breaks) {
        out += word.slice(from, at) + SHY
        from = at
      }
      return out + word.slice(from)
    })
    .join(' ')
}

/**
 * What to say when a link is refused. Naming both words is the whole feedback:
 * the player has just asserted that they mean the same thing, and the
 * correction is to see the assertion written out.
 * @param {Cell} from
 * @param {Cell} to
 */
export function refusal(from, to) {
  return `«${from.text}» does not mean “${to.text}”.`
}

/** A run's clock, as `m:ss`. */
export function formatTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
