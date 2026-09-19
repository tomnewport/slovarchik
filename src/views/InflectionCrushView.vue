<script setup>
// Inflection crush minigame (#751). Yoshi with grammar: inflected forms fall
// into four columns, the player swaps whole columns underneath them, and two
// stacked forms sharing one of the level's four categories collapse.
//
// Everything that decides what a tile could be, what clears and what falls
// lives in src/lib/inflectionCrush.js. This view owns the clock, the taps, the
// animation, and the word cards the clears queue up.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { state } from '../stores/vocab.js'
import {
  CLEARS_PER_LEVEL,
  COLUMNS,
  FEATURE_LABELS,
  FEATURE_SHORT,
  RUN,
  buildTilePool,
  colorFor,
  chaseScore,
  chaseWindowMs,
  createBoard,
  createDealer,
  dropMsFor,
  heightOf,
  isChaseHit,
  isToppedOut,
  landTile,
  levelDeck,
  levelFor,
  nextClear,
  pickCategories,
  queueCards,
  removeOne,
  stepScore,
  swapColumns,
} from '../lib/inflectionCrush.js'
import { loadSettings, playCelebration, playFeedback } from '../stores/settings.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'
import NextBatchButton from '../components/NextBatchButton.vue'
import WordFacts from '../components/WordFacts.vue'

// How long a collapse is left on screen before the stack closes up. Long enough
// for the reveal animation below to play out — the colour is the point of it.
const CLEAR_MS = 340
// A card steps aside this fast once another is waiting behind it.
const CARD_MS = 2000
// The chase bar is read off a deadline rather than counted down, so a
// backgrounded tab can't hand the player back the time it spent asleep.
const TICK_MS = 50
// A cascade cannot run forever; this only stops a pathological board hanging.
const MAX_CASCADE = 20

const MODES = [
  {
    id: 'case',
    label: 'Cases',
    icon: '🎯',
    blurb:
      'Each level picks four of the six cases. Stack two forms in the same case to clear them — and a form that could be two cases, like кни́ги, counts as both.',
  },
  {
    id: 'gender',
    label: 'Genders',
    icon: '🔤',
    blurb:
      'Masculine, feminine, neuter and plural. Stack two forms that agree the same way — an adjective oblique is often two at once, like но́вого.',
  },
]

const phase = ref('idle') // idle | playing | over
const mode = ref('case')
const board = ref(null)
const falling = ref(null) // { tile, col, row } — row counts down from the ceiling
const selected = ref(null) // a column picked up, waiting for its neighbour
// "col:i" → the category its run fired on, for the colour a collapse reveals.
const clearing = ref({})
const score = ref(0)
const clearedCount = ref(0)
const best = ref({ gender: 0, case: 0 })
const busy = ref(false)
// Which level the board on screen was dealt for. When the running level moves
// past it, the board is swept and re-decked — see openLevel.
const levelOpen = ref(1)

// The chase window: the categories that bought it, and how deep the streak is.
const chase = ref(null)
const chaseLeft = ref(0)

const cards = ref([])
const readLater = ref([])

let pool = []
let dealer = null
let dropTimer = null
let cascadeTimer = null
let chaseTicker = null

const level = computed(() => levelFor(clearedCount.value))
const categories = computed(() => board.value?.categories ?? [])
const card = computed(() => cards.value[0] ?? null)
const waiting = computed(() => Math.max(0, cards.value.length - 1))
const chaseSeconds = computed(() => Math.max(0, chaseLeft.value / 1000))
const chaseFraction = computed(() =>
  chase.value ? Math.max(0, chaseLeft.value / chaseWindowMs(chase.value.categories)) : 0,
)
const chaseNames = computed(() =>
  chase.value ? chase.value.categories.map((c) => FEATURE_SHORT[c]).join(' / ') : '',
)
/** How close the tallest column is to the ceiling, for the danger tint. */
const crowded = computed(() =>
  board.value ? Math.max(...board.value.cols.map((c) => c.length)) >= board.value.rows - 2 : false,
)

function clearTimers() {
  clearTimeout(dropTimer)
  clearTimeout(cascadeTimer)
  clearInterval(chaseTicker)
  dropTimer = null
  cascadeTimer = null
  chaseTicker = null
}

// ── Word cards ───────────────────────────────────────────────────────────
// Every word the board clears earns a card saying what it actually means, in
// the dictionary form rather than the slot the level was testing. They queue:
// the one in front steps aside after two seconds *if something is waiting
// behind it*, and otherwise stays until the player is done with it. Anything
// sent to "read later" comes back in the summary.

let cardTimer = null

function armCardTimer() {
  clearTimeout(cardTimer)
  cardTimer = null
  if (cards.value.length > 1) cardTimer = setTimeout(dismissCard, CARD_MS)
}

watch(() => `${cards.value.length}:${cards.value[0]?.key ?? ''}`, armCardTimer)

function dismissCard() {
  cards.value = cards.value.slice(1)
}

function keepCard() {
  const held = card.value
  if (held && !readLater.value.some((c) => c.key === held.key)) {
    readLater.value = [...readLater.value, held]
  }
  dismissCard()
}

function meet(tiles) {
  cards.value = queueCards(cards.value, tiles)
}

// ── The level ────────────────────────────────────────────────────────────

/**
 * Open a level: pick its four categories, deck only the tiles that carry one of
 * them, and start on an empty board.
 *
 * Empty, rather than carrying the stacks over, because the four categories
 * change: a tile left from the last level might carry none of the new four, and
 * a tile that can never clear is a column the player cannot dig out of. The
 * sweep is the reward for surviving — no points, just a clean board, so
 * clearing tiles yourself before the level turns is still worth more.
 */
function openLevel() {
  const cats = pickCategories(mode.value)
  dealer = createDealer(levelDeck(pool, mode.value, cats))
  board.value = createBoard(mode.value, cats)
  levelOpen.value = level.value
  selected.value = null
}

function start(which) {
  clearTimers()
  mode.value = which
  pool = buildTilePool(state.words)
  score.value = 0
  clearedCount.value = 0
  selected.value = null
  clearing.value = {}
  chase.value = null
  chaseLeft.value = 0
  cards.value = []
  readLater.value = []
  busy.value = false
  board.value = null
  levelOpen.value = 1
  openLevel()
  phase.value = 'playing'
  spawn()
}

function stop() {
  clearTimers()
  clearTimeout(cardTimer)
  chase.value = null
  falling.value = null
  phase.value = 'idle'
}

function finish() {
  clearTimers()
  clearTimeout(cardTimer)
  chase.value = null
  chaseLeft.value = 0
  falling.value = null
  phase.value = 'over'
  best.value = { ...best.value, [mode.value]: Math.max(best.value[mode.value], score.value) }
  if (score.value > 0) playCelebration()
}

// ── The falling tile ─────────────────────────────────────────────────────

/** The display row a tile in column `c` would come to rest on. */
function restRow(c) {
  return board.value.rows - heightOf(board.value, c) - 1
}

function spawn() {
  if (phase.value !== 'playing') return
  syncLevel()
  if (isToppedOut(board.value)) return finish()
  const col = Math.floor(Math.random() * COLUMNS)
  // A column already at the ceiling would spawn a tile with nowhere to go.
  if (restRow(col) < 0) return finish()
  falling.value = { tile: dealer.deal(), col, row: 0 }
  armDrop()
}

function armDrop() {
  clearTimeout(dropTimer)
  dropTimer = setTimeout(tick, dropMsFor(level.value))
}

function tick() {
  if (phase.value !== 'playing' || !falling.value) return
  const { col, row } = falling.value
  if (row >= restRow(col)) return land()
  falling.value = { ...falling.value, row: row + 1 }
  armDrop()
}

/** Send the falling tile straight down — the player's only way to hurry. */
function slam() {
  if (phase.value !== 'playing' || !falling.value || busy.value) return
  falling.value = { ...falling.value, row: Math.max(0, restRow(falling.value.col)) }
  clearTimeout(dropTimer)
  land()
}

function land() {
  clearTimeout(dropTimer)
  const { tile, col } = falling.value
  falling.value = null
  board.value = landTile(board.value, col, tile)
  cascade()
}

// ── Clearing ─────────────────────────────────────────────────────────────

/**
 * Collapse the board one run at a time, pausing on each so the player can see
 * what went.
 *
 * Only the *first* step's categories carry through to the chase window: that
 * step is the stack the player built, and the window is what that stack is
 * worth. A cascade underneath it still scores, but pooling its categories would
 * open a window on most of the level, which is no longer a chase.
 */
function cascade(depth = 0, fired = []) {
  const step = depth < MAX_CASCADE ? nextClear(board.value) : null
  if (!step) return settle(fired)

  busy.value = true
  // A tile in two runs at once takes the first run's colour — one collapse can
  // only be one colour, and the categories are reported in axis order.
  const revealed = {}
  for (const r of step.runs) {
    for (let k = r.from; k <= r.to; k++) revealed[`${r.col}:${k}`] ??= r.category
  }
  clearing.value = revealed
  score.value += stepScore(step.cleared.length, depth)
  clearedCount.value += step.cleared.length
  meet(step.cleared)
  playFeedback(true)
  const paid = depth === 0 ? step.categories : fired
  cascadeTimer = setTimeout(() => {
    clearing.value = {}
    board.value = step.board
    cascade(depth + 1, paid)
  }, CLEAR_MS)
}

/** The board has stopped moving: open the chase window, or drop the next tile. */
function settle(fired) {
  busy.value = false
  if (isToppedOut(board.value)) return finish()
  if (fired.length) return openChase(fired)
  spawn()
}

/**
 * Sweep and re-deck if the running level has moved past the board on screen.
 *
 * Checked here rather than as the clears are counted, because a clear can be
 * credited mid-cascade and mid-chase, and a board that changed its categories
 * underneath either would be pulling the rug out. A settle point is the one
 * moment nothing is in the air.
 */
function syncLevel() {
  if (level.value !== levelOpen.value) openLevel()
}

// ── The chase window ─────────────────────────────────────────────────────
// A clear pays out in seconds: one per category it fired on, so a stack that
// was both genitive and accusative is worth two. While the window is open the
// next tile waits and a tap takes any stacked tile carrying one of those
// categories off the board — a reprieve when the columns are high, and the only
// way to reach a tile the swaps cannot help.

function openChase(cats) {
  chase.value = { categories: cats, streak: 0 }
  grantChase()
}

function grantChase() {
  const deadline = Date.now() + chaseWindowMs(chase.value.categories)
  chaseLeft.value = deadline - Date.now()
  clearInterval(chaseTicker)
  chaseTicker = setInterval(() => {
    chaseLeft.value = Math.max(0, deadline - Date.now())
    if (chaseLeft.value <= 0) endChase()
  }, TICK_MS)
}

function endChase() {
  clearInterval(chaseTicker)
  chaseTicker = null
  chase.value = null
  chaseLeft.value = 0
  if (phase.value === 'playing') spawn()
}

function chaseTap(c, i) {
  if (!isChaseHit(board.value, chase.value.categories, c, i)) {
    // A tile with none of the window's categories closes it. The window pays
    // for the reading you have already shown, not for guessing.
    playFeedback(false)
    endChase()
    return
  }
  const streak = chase.value.streak + 1
  score.value += chaseScore(streak)
  clearedCount.value += 1
  meet([board.value.cols[c][i]])
  playFeedback(true)

  // The board catches up at once rather than step by step: the window is still
  // running, and an animation the player has to sit through would spend it.
  board.value = removeOne(board.value, c, i)
  for (let k = 0; k < MAX_CASCADE; k++) {
    const step = nextClear(board.value)
    if (!step) break
    score.value += stepScore(step.cleared.length, k)
    clearedCount.value += step.cleared.length
    meet(step.cleared)
    board.value = step.board
  }
  chase.value = { ...chase.value, streak }
  grantChase()
}

// ── Taps ─────────────────────────────────────────────────────────────────

/**
 * Tapping a stacked tile only means something while a chase window is open.
 *
 * Outside one the tile is inert and the tap falls through to the column strip
 * behind it, because the column swap is the move: a board where the top of a
 * full column did one thing and the gap above it did another would be a board
 * you have to aim at.
 */
function tapTile(c, i) {
  if (phase.value === 'playing' && chase.value) chaseTap(c, i)
}

/**
 * Yoshi's move. Tap a column, then its neighbour, and the two stacks trade
 * places — free and unlimited, because what is scarce here is time. Tapping the
 * same column again puts it down; tapping a column that is not a neighbour
 * picks that one up instead.
 */
function tapColumn(c) {
  if (phase.value !== 'playing' || busy.value || chase.value) return
  if (selected.value === null) {
    selected.value = c
    return
  }
  if (selected.value === c || Math.abs(selected.value - c) !== 1) {
    selected.value = selected.value === c ? null : c
    return
  }
  board.value = swapColumns(board.value, selected.value, c)
  selected.value = null
  playFeedback(true)
  // A swap can drop a stack under the falling tile; if that closes the gap, the
  // tile is already resting and should land now rather than through the floor.
  if (falling.value && falling.value.row >= restRow(falling.value.col)) land()
}

/** Whether a stacked tile is one the open window would pay for. */
const isTarget = (c, i) => !!chase.value && isChaseHit(board.value, chase.value.categories, c, i)

/** The category a collapsing tile fired on, or null if it is not collapsing. */
const clearingCategory = (c, i) => clearing.value[`${c}:${i}`] ?? null

/**
 * The colour a tile shows: the category it is collapsing under, or — during a
 * chase — the window category it matches. Neutral the rest of the time, because
 * a coloured tile on the board would answer the question before it was asked.
 */
function tileColor(c, i) {
  const revealing = clearingCategory(c, i)
  if (revealing) return colorFor(revealing)
  if (!chase.value) return null
  const hit = chase.value.categories.find((cat) =>
    (board.value.cols[c][i]?.features?.[board.value.mode] ?? []).includes(cat),
  )
  return hit ? colorFor(hit) : null
}

/** Display row of the tile at stack position `i` in column `c`. */
const rowOf = (c, i) => board.value.rows - heightOf(board.value, c) + i

onMounted(() => {
  loadSettings()
})

onUnmounted(() => {
  clearTimers()
  clearTimeout(cardTimer)
})
</script>

<template>
  <section v-if="phase === 'idle'" class="grid">
    <h2 style="margin: 0">Inflection crush 💠</h2>
    <p class="muted" style="margin: 0">
      Russian forms fall into four columns. Tap two neighbouring columns to trade their whole
      stacks — free, and as often as you like — and land {{ RUN }} forms on top of each other that
      share one of the level's four categories to clear them. Let a column reach the top and the
      game is over.
    </p>
    <div class="grid games">
      <button v-for="m in MODES" :key="m.id" class="game" @click="start(m.id)">
        <span class="game-icon" aria-hidden="true">{{ m.icon }}</span>
        <span class="game-text">
          <strong>{{ m.label }}</strong>
          <span class="muted">{{ m.blurb }}</span>
          <span v-if="best[m.id]" class="muted">Best: {{ best[m.id] }}</span>
        </span>
      </button>
    </div>
    <p v-if="!state.words.length" class="muted" style="margin: 0">
      Waiting for the vocabulary to load…
    </p>
  </section>

  <section v-else class="grid crush" style="gap: 0.6rem; position: relative">
    <CelebrationBurst :show="phase === 'over' && score > 0" />

    <div class="row" style="justify-content: space-between">
      <span class="pill">Level {{ level }}</span>
      <span class="muted"
        >{{ score }} points<template v-if="best[mode]"> · best {{ best[mode] }}</template></span
      >
    </div>

    <!-- What this level is playing with. Named in full: the whole game is
         holding four categories in your head while you read. -->
    <!-- The legend. Each category owns a colour, and this is where the two are
         put side by side: the colour only ever appears on a collapse, so it has
         to be readable back to a name somewhere. -->
    <div class="cats">
      <span
        v-for="c in categories"
        :key="c"
        class="cat"
        :style="{ '--hue': colorFor(c) }"
        >{{ FEATURE_LABELS[c] }}</span
      >
    </div>

    <div
      v-if="chase"
      class="chase"
      :class="{ urgent: chaseSeconds <= 0.5 }"
      :style="{ '--hue': colorFor(chase.categories[0]) }"
    >
      <div class="chase-bar" :style="{ width: `${chaseFraction * 100}%` }" />
      <span class="chase-text">
        Chase {{ chaseNames }} · {{ chaseSeconds.toFixed(1) }}s<template v-if="chase.streak">
          · ×{{ chase.streak }}</template
        >
      </span>
    </div>
    <p v-else class="muted chase-idle" style="margin: 0">
      {{ clearedCount }} cleared · next level at
      {{ level * CLEARS_PER_LEVEL }}
    </p>

    <div
      class="board"
      :class="{ crowded, chasing: !!chase, dead: phase === 'over' }"
      :style="{ '--rows': board.rows, '--cols': board.cols.length }"
    >
      <!-- One tap strip per column, behind the tiles: the whole column is the
           hit target for a swap, so a stack three high is as easy to pick up as
           one nine high. -->
      <button
        v-for="(col, c) in board.cols"
        :key="`strip-${c}`"
        type="button"
        class="strip"
        :class="{ picked: selected === c, neighbour: selected !== null && Math.abs(selected - c) === 1 }"
        :style="{ gridColumn: c + 1 }"
        :disabled="phase !== 'playing' || busy || !!chase"
        :aria-label="`Column ${c + 1}, ${col.length} tiles`"
        @click="tapColumn(c)"
      />

      <template v-for="(col, c) in board.cols" :key="`col-${c}`">
        <button
          v-for="(t, i) in col"
          :key="t.id"
          type="button"
          class="tile"
          lang="ru"
          :class="{ clearing: !!clearingCategory(c, i), target: isTarget(c, i) }"
          :style="{
            gridColumn: c + 1,
            gridRow: rowOf(c, i) + 1,
            '--hue': tileColor(c, i) ?? 'transparent',
          }"
          :disabled="phase !== 'playing' || !chase"
          @click.stop="tapTile(c, i)"
        >
          {{ t.form }}
        </button>
      </template>

      <div
        v-if="falling"
        class="tile falling"
        lang="ru"
        :style="{ gridColumn: falling.col + 1, gridRow: falling.row + 1 }"
      >
        {{ falling.tile.form }}
      </div>
    </div>

    <div class="row" style="gap: 0.5rem">
      <button :disabled="!falling || busy || !!chase" @click="slam">⤓ Drop</button>
      <span v-if="selected !== null" class="muted" style="font-size: 0.85rem">
        Tap a neighbouring column to swap.
      </span>
    </div>

    <!-- The word cards the clears queue up. Below the board rather than over
         it: the next tile is always falling, and a card that covered the
         columns would make the game unplayable. -->
    <div v-if="card" class="card word-card">
      <div class="row" style="justify-content: space-between; align-items: flex-start">
        <div>
          <strong lang="ru" style="font-size: 1.1rem">{{ card.lemma }}</strong>
          <span class="muted"> — {{ card.en }}</span>
          <div class="muted" style="font-size: 0.85rem">
            on the board as <span lang="ru">{{ card.form }}</span>
          </div>
        </div>
        <span v-if="waiting" class="pill">{{ waiting }} waiting</span>
      </div>
      <WordFacts :word-key="card.key" />
      <div class="row" style="gap: 0.5rem">
        <button @click="dismissCard">Got it</button>
        <button @click="keepCard">🔖 Read later</button>
        <NextBatchButton :word-key="card.key" />
      </div>
    </div>

    <template v-if="phase === 'over'">
      <p class="feedback bad" style="margin: 0">
        Topped out on level {{ level }} — {{ score }} point{{ score === 1 ? '' : 's' }}.
      </p>
      <div v-if="readLater.length" class="card">
        <h3 style="margin: 0 0 0.5rem">Saved to read 🔖</h3>
        <div v-for="w in readLater" :key="w.key" class="saved">
          <div>
            <strong lang="ru">{{ w.lemma }}</strong>
            <span class="muted"> — {{ w.en }}</span>
          </div>
          <WordFacts :word-key="w.key" />
          <NextBatchButton :word-key="w.key" />
        </div>
      </div>
      <div class="row">
        <button class="primary" @click="start(mode)">Again</button>
        <button @click="stop">Stop</button>
      </div>
    </template>
    <button v-else style="justify-self: start" @click="stop">Stop</button>
  </section>
</template>

<style scoped>
/* The mode picker on the start screen — the same shape as Home's game rows. */
.games {
  gap: 0.6rem;
}

.game {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  text-align: left;
  padding: 0.75rem;
}

.game-icon {
  font-size: 1.4rem;
  line-height: 1.2;
}

.game-text {
  display: grid;
  gap: 0.2rem;
}

.cats {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.cat {
  flex: 1;
  text-align: center;
  font-size: 0.72rem;
  padding: 0.15rem 0.2rem;
  border-radius: 6px;
  border: 1px solid var(--hue);
  /* A wash of the hue rather than the hue itself: the chip is a legend, and a
     solid block of four bright colours above the board would out-shout it. */
  background: color-mix(in srgb, var(--hue) 18%, var(--bg-soft));
  color: var(--text);
}

.board {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  /* Rows are a fixed height rather than a share of a square board. A square
     cell a quarter of a phone wide is ~90px tall for a word that needs 90x20,
     and eight of them is a board you have to scroll; wide, short cells fit the
     shape of a Russian form and keep the whole column on screen with the word
     card under it. */
  grid-template-rows: repeat(var(--rows), clamp(30px, 5.4vh, 46px));
  gap: 0.2rem;
  padding: 0.2rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgb(0 0 0 / 18%);
}

/* The ceiling is close: tint the board rather than only the top row, because
   the player is watching the falling tile, not the gap above it. */
.board.crowded {
  background: rgb(255 92 92 / 12%);
}

.board.dead {
  filter: grayscale(0.7);
}

.strip {
  grid-row: 1 / -1;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
}

.strip.picked {
  border-color: var(--primary);
  background: rgb(79 125 255 / 16%);
}

.strip.neighbour {
  border-color: var(--primary);
  border-style: dashed;
}

.tile {
  display: grid;
  place-items: center;
  padding: 0.1rem;
  /* Obliques run long and a column is a quarter of a phone; let the form wrap
     rather than shrink the whole board to fit its worst word. */
  font-size: clamp(0.55rem, 2.6vw, 0.85rem);
  line-height: 1.1;
  overflow-wrap: anywhere;
  hyphens: none;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  /* Inert by default so the tap reaches the column strip behind it; a chase
     window is the one time a tile is a target in its own right. */
  pointer-events: none;
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.tile:disabled {
  opacity: 1; /* a settling board is not a dead one */
  cursor: default;
}

.board.chasing .tile:not(:disabled) {
  pointer-events: auto;
}

.tile.clearing {
  /* The category's colour is revealed here and nowhere else: the tile flashes
     it, then goes. Kept as one animation rather than a transition so the colour
     is on screen for a beat at full strength before the fade takes it. */
  animation: reveal 320ms ease-out forwards;
  color: #0b1021;
  border-color: var(--hue);
}

/* During a chase every stacked tile is tappable, so the ones that would score
   say so — ringed in the colour of the category they match, which is the same
   colour their collapse will reveal. Not a colour alone: the ring itself is
   what a player who cannot tell the hues apart reads. */
.tile.target {
  border-color: var(--hue);
  box-shadow: inset 0 0 0 2px var(--hue);
}

.tile.falling {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
  pointer-events: none;
}

.chase {
  position: relative;
  height: 1.5rem;
  border-radius: 999px;
  overflow: hidden;
  background: rgb(127 127 127 / 25%);
}

.chase-bar {
  height: 100%;
  background: var(--hue);
  transition: width 50ms linear;
}

.chase.urgent .chase-bar {
  background: var(--bad);
}

.chase-text {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  color: var(--bg);
  font-weight: 600;
}

/* Stands in for the chase bar when no window is open, at exactly its height:
   the board must not jump the moment a stack clears. */
.chase-idle {
  height: 1.5rem;
  display: grid;
  align-items: center;
  overflow: hidden;
  font-size: 0.78rem;
}

.word-card {
  padding: 0.75rem;
  display: grid;
  gap: 0.5rem;
}

.saved + .saved {
  margin-top: 0.75rem;
  border-top: 1px solid var(--border);
  padding-top: 0.75rem;
}

@keyframes reveal {
  0% {
    background: var(--hue);
    transform: scale(1.06);
    opacity: 1;
  }
  55% {
    background: var(--hue);
    transform: scale(1);
    opacity: 1;
  }
  100% {
    background: var(--hue);
    transform: scale(0.72);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tile,
  .chase-bar {
    transition: none;
  }

  /* Still reveal the colour — that is information, not decoration — but hold it
     still and let it fade rather than pop. */
  .tile.clearing {
    animation: none;
    background: var(--hue);
    opacity: 0;
    transition: opacity 320ms ease-out;
  }
}
</style>
