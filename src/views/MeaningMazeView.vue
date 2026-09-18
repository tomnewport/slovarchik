<script setup>
// Meaning maze minigame (#752). A board of words, one path of translation
// pairs through it, and a clock.
//
// Everything that decides what the board is and what a move does lives in
// src/lib/meaningMaze.js; this view owns the clock, the drawing and the lens.
//
// Two decisions shape the interface, and both come from the same fact: a
// 25-wide board is about 15px a cell on a phone, which is too small to read and
// far too small to tap accurately.
//
//   - THE BOARD IS A MAP, THE LENS IS THE INSTRUMENT. Every move can be made on
//     a lens tile big enough to read and hit. The board is for seeing where you
//     are and deciding where to look next.
//   - ONE GESTURE, NO MODES. Touching the board plays if what you touched is
//     next to the head of the line (or on it), and otherwise moves the lens
//     there. `moveOutcome` already separates those two cases — a move it calls
//     `not-adjacent` is someone looking around, not someone playing — so the
//     rule needs no state of its own and there is no mode to be in the wrong
//     one of.
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'

import {
  DEFAULT_SIZE,
  LEVELS,
  SIZES,
  advance,
  formatTime,
  generateMaze,
  hyphenate,
  lensView,
  mazeWordPool,
  refusal,
  step,
} from '../lib/meaningMaze.js'
import { vocab } from '../stores/vocab.js'
import { loadSettings, playCelebration, playFeedback } from '../stores/settings.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'

/** How many cells across the magnifier shows. Odd, so it has a middle. */
const LENS_SPAN = 5
/** How long a refused link stays lit on the board. */
const FLASH_MS = 700
/** How often the clock is re-read. It is only ever shown to the second. */
const TICK_MS = 250

const size = ref(DEFAULT_SIZE)
/**
 * Which CEFR levels are in play. All three by default; A1 on its own is 458
 * words, which is not enough for a 25 × 25 board (625 cells), so the board
 * sizes on offer follow from this rather than the other way round.
 */
const levels = ref([...LEVELS])
const maze = ref(null)
const path = ref([])
const mistakes = ref(0)
const message = ref('')
const flash = ref(-1)
const lensCentre = ref(0)
const solved = ref(false)
const gaveUp = ref(false)
/** Best time per board size, for this visit. A game, not a record. */
const best = reactive({})

/** The game section, focused on start so the arrow keys work without a click. */
const gameEl = ref(null)

const startedAt = ref(0)
const finishedAt = ref(0)
const now = ref(0)
let ticker = null
let flashTimer = null

const vocabReady = computed(() => vocab.value.length > 0)
const pool = computed(() => mazeWordPool(vocab.value, { levels: levels.value }))
const sizes = computed(() => SIZES.filter((s) => s * s <= pool.value.length))
const ready = computed(() => sizes.value.length > 0)

/**
 * Turn a level on or off, keeping at least one on: an empty selection is not a
 * harder game, it is no game, and the only thing to do with it would be to
 * refuse to start.
 */
function toggleLevel(level) {
  if (!levels.value.includes(level)) levels.value = [...levels.value, level]
  else if (levels.value.length > 1) levels.value = levels.value.filter((l) => l !== level)
  // Narrowing the levels can take the chosen board off the list, and a select
  // showing a size it no longer offers is a select that lies about what Start
  // will do.
  if (sizes.value.length && !sizes.value.includes(size.value)) {
    size.value = sizes.value[sizes.value.length - 1]
  }
}

const elapsed = computed(() => (finishedAt.value || now.value) - startedAt.value)
const head = computed(() => (path.value.length ? path.value[path.value.length - 1] : -1))
const onPath = computed(() => new Set(path.value))
const over = computed(() => solved.value || gaveUp.value)

const lens = computed(() => (maze.value ? lensView(maze.value, lensCentre.value, LENS_SPAN) : null))

/**
 * Each cell's word with its break points marked, by cell index. Done once per
 * board rather than per render: it is the same 625 words all game, and a cell
 * that cannot break is a cell that shows one syllable and a clipped edge.
 */
const shown = computed(() =>
  maze.value ? maze.value.cells.map((c) => hyphenate(c.text, c.side)) : [],
)

/** The drawn line, as one polyline over a viewBox of one unit per cell. */
const line = computed(() => {
  if (!maze.value) return ''
  return path.value
    .map((i) => `${(i % maze.value.size) + 0.5},${Math.floor(i / maze.value.size) + 0.5}`)
    .join(' ')
})

function stopClock() {
  clearInterval(ticker)
  ticker = null
}

function start() {
  if (!ready.value) return
  stopClock()
  clearTimeout(flashTimer)
  if (!sizes.value.includes(size.value)) size.value = sizes.value[sizes.value.length - 1]
  maze.value = generateMaze(pool.value, { size: size.value })
  path.value = [maze.value.start]
  lensCentre.value = maze.value.start
  mistakes.value = 0
  message.value = ''
  flash.value = -1
  solved.value = false
  gaveUp.value = false
  startedAt.value = Date.now()
  finishedAt.value = 0
  now.value = startedAt.value
  ticker = setInterval(() => {
    now.value = Date.now()
  }, TICK_MS)
  nextTick(() => gameEl.value?.focus?.())
}

function stop() {
  stopClock()
  clearTimeout(flashTimer)
  maze.value = null
  path.value = []
}

function finish() {
  stopClock()
  finishedAt.value = Date.now()
  solved.value = true
  message.value = ''
  const time = finishedAt.value - startedAt.value
  if (!best[size.value] || time < best[size.value]) best[size.value] = time
  playCelebration()
}

/** Reveal the answer. The run is over either way, so the clock stops with it. */
function giveUp() {
  if (!maze.value || over.value) return
  stopClock()
  finishedAt.value = Date.now()
  gaveUp.value = true
  path.value = maze.value.solution
  lensCentre.value = maze.value.goal
  message.value = 'The way through, from start to finish.'
}

/**
 * Touch a cell: play if it is a move, look if it is not.
 *
 * `advance` returns `ignored / not-adjacent` for a cell nowhere near the head,
 * which is exactly the touch that means "show me over there" — so the two
 * behaviours fall out of one call rather than out of a mode.
 */
function touch(i) {
  if (!maze.value || over.value) return
  const from = maze.value.cells[head.value]
  const out = advance(maze.value, path.value, i)
  lensCentre.value = i
  if (out.kind === 'refused') {
    mistakes.value += 1
    message.value = refusal(from, maze.value.cells[i])
    lensCentre.value = head.value
    flash.value = i
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      flash.value = -1
    }, FLASH_MS)
    playFeedback(false)
    return
  }
  if (out.kind === 'ignored') return
  path.value = out.path
  message.value = ''
  // Only a translation is worth a ding. Stepping off an English word onto a
  // Russian one costs nothing and proves nothing.
  if (out.kind === 'extend' && from.side === 'ru') playFeedback(true)
  if (out.solved) finish()
}

/**
 * The cell a pointer event landed on, or −1.
 *
 * `event.target` rather than `elementFromPoint`: a pointer that is not captured
 * reports moves against whatever is under it, so the same one line reads both
 * the press and every move of a drag. The overlays — the drawn line and the
 * lens frame — take no pointer events, so the target is always the cell.
 */
function cellUnder(event) {
  const i = event.target?.closest?.('[data-cell]')?.dataset?.cell
  return i === undefined ? -1 : Number(i)
}

let drawing = false

function onBoardDown(event) {
  const i = cellUnder(event)
  if (i < 0) return
  touch(i)
  // Drag-drawing is for a mouse or a pen only. A touch drag would have to claim
  // the gesture from the page (`touch-action: none`) to work, and the board is
  // most of the screen on a phone — the cost of that is scrolling, for a
  // gesture nobody can aim at a 15px cell anyway.
  if (event.pointerType === 'touch') return
  drawing = true
}

function onBoardMove(event) {
  if (!drawing) return
  const i = cellUnder(event)
  if (i >= 0 && i !== head.value) touch(i)
}

function endDraw() {
  drawing = false
}

/** Arrow keys are the precise input a grid of 15px cells cannot be. */
const ARROWS = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

function onKey(event) {
  if (!maze.value || over.value) return
  const delta = ARROWS[event.key]
  if (delta) {
    const target = step(maze.value, path.value, delta[0], delta[1])
    if (target >= 0) touch(target)
    event.preventDefault()
    return
  }
  if (event.key === 'Backspace' && path.value.length > 1) {
    touch(path.value[path.value.length - 2])
    event.preventDefault()
  }
}

/** What a cell is, for a screen reader and for the lens tooltip. */
function cellLabel(cell) {
  const where = cell.i === maze.value.start ? ' (start)' : cell.i === maze.value.goal ? ' (exit)' : ''
  return `${cell.side === 'ru' ? 'Russian' : 'English'}: ${cell.text}${where}`
}

onMounted(() => {
  loadSettings()
})

onUnmounted(() => {
  stopClock()
  clearTimeout(flashTimer)
})
</script>

<template>
  <section v-if="!maze" class="grid">
    <h2 style="margin: 0">Meaning maze 🧭</h2>
    <p class="muted" style="margin: 0">
      A grid of words, Russian and English alternating. Draw a line of translations from the
      top-left corner to the bottom-right one, as fast as you can.
    </p>
    <ul class="muted rules">
      <li>From a <strong>Russian</strong> word you may move only to its English translation. Anything
        else is refused.</li>
      <li>From an <strong>English</strong> word you may move to any Russian word beside it, free.</li>
      <li>Every Russian word has its translation beside it — the exit is the only one that does not.
        The line may not cross itself, so wander too far and you will wall off your own way through;
        draw back over the line to retreat.</li>
    </ul>
    <p class="muted" style="margin: 0">
      The board is a map: touch it to move the magnifier. The magnifier is where you play — its tiles
      are big enough to read.
    </p>
    <template v-if="ready">
      <div class="row">
        <span class="muted">Vocabulary</span>
        <button
          v-for="level in LEVELS"
          :key="level"
          type="button"
          class="level"
          :class="{ on: levels.includes(level) }"
          :aria-pressed="levels.includes(level)"
          @click="toggleLevel(level)"
        >
          {{ level }}
        </button>
        <span class="muted">{{ pool.length }} words</span>
      </div>
      <div class="row">
        <label class="muted" for="maze-size">Board</label>
        <select id="maze-size" v-model.number="size">
          <option v-for="s in sizes" :key="s" :value="s">{{ s }} × {{ s }}</option>
        </select>
        <button class="primary" @click="start">Start</button>
      </div>
      <p v-if="!sizes.includes(DEFAULT_SIZE)" class="muted" style="margin: 0">
        A {{ DEFAULT_SIZE }} × {{ DEFAULT_SIZE }} board needs {{ DEFAULT_SIZE * DEFAULT_SIZE }}
        words and these levels have {{ pool.length }}, so the bigger boards are off the list.
      </p>
    </template>
    <p v-else class="muted" style="margin: 0">
      {{ vocabReady ? 'Not enough words at these levels to fill a board.' : 'Loading the dictionary…' }}
    </p>
    <p v-if="best[size]" class="muted" style="margin: 0">
      Best on {{ size }} × {{ size }}: {{ formatTime(best[size]) }}
    </p>
  </section>

  <section
    v-else
    ref="gameEl"
    class="grid maze-game"
    tabindex="-1"
    style="position: relative"
    @keydown="onKey"
  >
    <CelebrationBurst :show="solved" />

    <div class="row" style="justify-content: space-between">
      <span class="pill clock">{{ formatTime(elapsed) }}</span>
      <span class="muted">
        {{ path.length - 1 }} drawn · {{ mistakes }} refused
        <template v-if="best[size]"> · best {{ formatTime(best[size]) }}</template>
      </span>
    </div>

    <div class="play">
      <div
        class="board"
        :style="{ '--n': maze.size }"
        role="img"
        :aria-label="`A ${maze.size} by ${maze.size} grid of Russian and English words.`"
        @pointerdown="onBoardDown"
        @pointermove="onBoardMove"
        @pointerup="endDraw"
        @pointercancel="endDraw"
        @pointerleave="endDraw"
      >
        <div
          v-for="cell in maze.cells"
          :key="cell.i"
          class="cell"
          :class="[
            cell.side,
            {
              drawn: onPath.has(cell.i),
              head: cell.i === head,
              start: cell.i === maze.start,
              goal: cell.i === maze.goal,
              wrong: cell.i === flash,
            },
          ]"
          :data-cell="cell.i"
          :lang="cell.side === 'ru' ? 'ru' : 'en'"
        >
          {{ shown[cell.i] }}
        </div>
        <svg class="line" :viewBox="`0 0 ${maze.size} ${maze.size}`" aria-hidden="true">
          <polyline :points="line" />
        </svg>
        <div
          class="lens-frame"
          :style="{
            left: `${(lens.c0 / maze.size) * 100}%`,
            top: `${(lens.r0 / maze.size) * 100}%`,
            width: `${(lens.span / maze.size) * 100}%`,
            height: `${(lens.span / maze.size) * 100}%`,
          }"
        />
      </div>

      <div class="card lens">
        <div class="row" style="justify-content: space-between; gap: 0.5rem">
          <strong>🔍 Magnifier</strong>
          <button class="small" :disabled="over" @click="lensCentre = head">Back to the line</button>
        </div>
        <div class="lens-grid" :style="{ '--s': lens.span }">
          <button
            v-for="cell in lens.cells"
            :key="cell.i"
            type="button"
            class="lens-cell"
            :class="[
              cell.side,
              {
                drawn: onPath.has(cell.i),
                head: cell.i === head,
                start: cell.i === maze.start,
                goal: cell.i === maze.goal,
                wrong: cell.i === flash,
              },
            ]"
            :lang="cell.side === 'ru' ? 'ru' : 'en'"
            :aria-label="cellLabel(cell)"
            @click="touch(cell.i)"
          >
            {{ shown[cell.i] }}
          </button>
        </div>
        <!-- The refusal belongs beside the tiles it is about: on a phone the
             magnifier is where the player is looking, and on a wide screen the
             foot of the page is half a board away. -->
        <p class="feedback bad note" role="status">{{ message }}</p>
        <p class="muted legend">🚩 start · 🏁 exit · arrow keys move the line</p>
      </div>
    </div>

    <div class="row">
      <template v-if="solved">
        <span class="feedback good">
          ✓ Solved in {{ formatTime(elapsed) }} with {{ mistakes }} refused links.
        </span>
        <button class="primary" @click="start">Again</button>
        <button @click="stop">Stop</button>
      </template>
      <template v-else-if="gaveUp">
        <button class="primary" @click="start">Again</button>
        <button @click="stop">Stop</button>
      </template>
      <template v-else>
        <button @click="stop">Stop</button>
        <button @click="giveUp">Give up</button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.rules {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.25rem;
}

.clock {
  font-variant-numeric: tabular-nums;
  font-size: 1rem;
  color: var(--text);
}

.play {
  display: grid;
  gap: 0.75rem;
}

@media (min-width: 900px) {
  .play {
    grid-template-columns: minmax(0, 1fr) 17rem;
    align-items: start;
  }
}

/* The app column is 760px, which on a wide screen leaves the board smaller than
   the screen can easily show — and every pixel of it is legibility. Break out
   of the column for the game, and only for the game. */
@media (min-width: 1000px) {
  .maze-game {
    width: min(94vw, 1180px);
    left: 50%;
    transform: translateX(-50%);
  }
}

.board {
  position: relative;
  width: min(100%, 72vh);
  margin-inline: auto;
  aspect-ratio: 1;
  display: grid;
  grid-template-columns: repeat(var(--n), 1fr);
  /* The cell font is a fraction of the board's own width, so a 13-wide board
     reads comfortably and a 25-wide one still says something. */
  container-type: inline-size;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  user-select: none;
  touch-action: manipulation;
  cursor: crosshair;
}

.cell {
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 0 1px;
  text-align: center;
  line-height: 1.02;
  letter-spacing: -0.02em;
  font-size: max(5px, calc(100cqw / var(--n) / 3.4));
  /* Hyphenation where the browser has a dictionary for the language, and a hard
     break everywhere else — a word that overflows its cell is worse than one
     broken in an ugly place. */
  hyphens: auto;
  overflow-wrap: anywhere;
}

.cell.ru {
  background: #1b2340;
  color: #e7ecff;
}

.cell.en {
  background: #121a31;
  color: #a9bce0;
}

.cell.drawn {
  background: #33509c;
  color: #fff;
}

.cell.start,
.cell.goal {
  box-shadow: inset 0 0 0 1px var(--gold);
}

.cell.head {
  box-shadow: inset 0 0 0 1px #fff;
}

.cell.wrong {
  background: var(--bad);
  color: #1a0505;
}

.line {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.line polyline {
  fill: none;
  stroke: var(--gold);
  stroke-width: 0.26;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.85;
}

.lens-frame {
  position: absolute;
  border: 2px solid var(--gold);
  border-radius: 4px;
  pointer-events: none;
  transition: left 120ms ease-out, top 120ms ease-out;
}

.lens {
  padding: 0.75rem;
  display: grid;
  gap: 0.5rem;
}

.lens-grid {
  display: grid;
  grid-template-columns: repeat(var(--s), 1fr);
  gap: 3px;
}

.lens-cell {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  padding: 2px;
  overflow: hidden;
  text-align: center;
  line-height: 1.1;
  font-size: clamp(0.5rem, 2.6vw, 0.8rem);
  hyphens: auto;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.lens-cell.ru {
  background: #1b2340;
}

.lens-cell.en {
  background: #121a31;
  color: #a9bce0;
}

.lens-cell.drawn {
  background: #33509c;
  color: #fff;
}

.lens-cell.head {
  border-color: #fff;
}

.lens-cell.start::after {
  content: '🚩';
}

.lens-cell.goal::after {
  content: '🏁';
}

.lens-cell.start,
.lens-cell.goal {
  border-color: var(--gold);
}

.lens-cell.wrong {
  background: var(--bad);
  color: #1a0505;
}

.small {
  font-size: 0.8rem;
  padding: 0.25rem 0.5rem;
}

.level {
  min-width: 3rem;
  padding: 0.3rem 0.6rem;
  cursor: pointer;
  background: var(--bg-soft);
  color: var(--muted);
}

.level.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.legend {
  margin: 0;
  font-size: 0.75rem;
}

/* Kept in the layout whether or not it says anything, so that a refusal does
   not shove the board and the tiles around as it comes and goes. */
.note {
  margin: 0;
  min-height: 2.4em;
  font-size: 0.85rem;
}

.maze-game:focus {
  outline: none;
}

@media (prefers-reduced-motion: reduce) {
  .lens-frame {
    transition: none;
  }
}
</style>
