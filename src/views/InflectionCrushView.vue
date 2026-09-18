<script setup>
// Inflection crush minigame (#751). Swap two adjacent forms; three in a line
// sharing a gender — or a case — clear, and the features they fired on buy a
// second each to chase the same feature anywhere else on the board.
//
// Everything that decides what a tile could be, what clears and what falls
// lives in src/lib/inflectionCrush.js. This view owns the clock, the taps, the
// animation, and the word cards the clears queue up.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { state } from '../stores/vocab.js'
import {
  FEATURE_SHORT,
  MOVES_PER_GAME,
  adjacent,
  at,
  balancedDeck,
  buildTilePool,
  chaseScore,
  chaseWindowMs,
  collapse,
  createDealer,
  findMatches,
  generateGrid,
  hasLegalMove,
  isChaseHit,
  nextStep,
  queueCards,
  stepScore,
  swapped,
} from '../lib/inflectionCrush.js'
import { loadSettings, playCelebration, playFeedback } from '../stores/settings.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'
import WordFacts from '../components/WordFacts.vue'
import NextBatchButton from '../components/NextBatchButton.vue'

const ROWS = 6
const COLS = 5
// How long a clear is left on screen before the survivors fall into it.
const CLEAR_MS = 260
// How long a refused swap shows that it was refused.
const REJECT_MS = 400
// A card steps aside this fast once another is waiting behind it.
const CARD_MS = 2000
// The chase bar is read off a deadline rather than counted down, so a
// backgrounded tab can't hand the player back the time it spent asleep.
const TICK_MS = 50
// A cascade cannot run forever, but a refill landing in a line can keep one
// going a while; this only stops a pathological board from hanging the tab.
const MAX_CASCADE = 16

const MODES = [
  {
    id: 'case',
    label: 'Cases',
    icon: '🎯',
    blurb:
      'Three in a line in the same case. A form that could be two cases — кни́ги is genitive singular and nominative plural — counts as both.',
  },
  {
    id: 'gender',
    label: 'Genders',
    icon: '🔤',
    blurb:
      'Three in a line that agree the same way: masculine, feminine, neuter or plural. An adjective oblique is often two at once — но́вого is masculine and neuter.',
  },
]

const phase = ref('idle') // idle | playing | over
const mode = ref('case')
const grid = ref(null)
const selected = ref(null)
const rejected = ref(null) // the pair that just refused to swap, for the shake
const clearing = ref(new Set()) // "r,c" keys mid-clear, so they fade before falling
const moves = ref(0)
const score = ref(0)
const best = ref({ gender: 0, case: 0 })
const busy = ref(false)
const reshuffled = ref(false)

// The chase window: the features that bought it, and how many taps deep the
// player is into it.
const chase = ref(null)
const chaseLeft = ref(0)

const cards = ref([])
const readLater = ref([])

let dealer = null
let cascadeTimer = null
let rejectTimer = null
let cardTimer = null
let chaseTicker = null

const modeCopy = computed(() => MODES.find((m) => m.id === mode.value) ?? MODES[0])
const card = computed(() => cards.value[0] ?? null)
const waiting = computed(() => Math.max(0, cards.value.length - 1))
const chaseSeconds = computed(() => Math.max(0, chaseLeft.value / 1000))
const chaseFraction = computed(() =>
  chase.value ? Math.max(0, chaseLeft.value / chaseWindowMs(chase.value.features)) : 0,
)
// Abbreviated: the bar is one line with a countdown already in it.
const chaseNames = computed(() =>
  chase.value ? chase.value.features.map((f) => FEATURE_SHORT[f]).join(' / ') : '',
)
function clearTimers() {
  clearTimeout(cascadeTimer)
  clearTimeout(rejectTimer)
  clearTimeout(cardTimer)
  clearInterval(chaseTicker)
  cascadeTimer = null
  rejectTimer = null
  cardTimer = null
  chaseTicker = null
}

// ── Word cards ───────────────────────────────────────────────────────────
// Every word a clear touches earns a card saying what it actually means, in the
// dictionary form rather than the slot the grid was testing. They queue: the
// one in front steps aside after two seconds *if something is waiting behind
// it*, and otherwise stays until the player is done with it. Anything sent to
// "read later" comes back in the summary.

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

// ── The board ────────────────────────────────────────────────────────────

function deal() {
  dealer = createDealer(balancedDeck(buildTilePool(state.words), mode.value))
  grid.value = generateGrid(dealer, { rows: ROWS, cols: COLS, mode: mode.value })
}

function start(which) {
  clearTimers()
  mode.value = which
  score.value = 0
  moves.value = MOVES_PER_GAME
  selected.value = null
  rejected.value = null
  clearing.value = new Set()
  chase.value = null
  chaseLeft.value = 0
  cards.value = []
  readLater.value = []
  reshuffled.value = false
  busy.value = false
  deal()
  phase.value = 'playing'
}

function stop() {
  clearTimers()
  chase.value = null
  phase.value = 'idle'
}

function finish() {
  clearTimers()
  chase.value = null
  chaseLeft.value = 0
  phase.value = 'over'
  best.value = { ...best.value, [mode.value]: Math.max(best.value[mode.value], score.value) }
  if (score.value > 0) playCelebration()
}

const isSelected = (r, c) => selected.value?.r === r && selected.value?.c === c
const isClearing = (r, c) => clearing.value.has(`${r},${c}`)
const isRejected = (r, c) => !!rejected.value?.some((cell) => cell.r === r && cell.c === c)
const isTarget = (r, c) => !!chase.value && isChaseHit(grid.value, chase.value.features, r, c)

function tap(r, c) {
  if (phase.value !== 'playing' || busy.value) return
  if (chase.value) return chaseTap(r, c)

  const cell = { r, c }
  if (!selected.value || !adjacent(selected.value, cell)) {
    // Picking a tile up is an interaction with the word on it, so it earns a
    // card like any other: knowing what you are moving is half the game.
    selected.value = isSelected(r, c) ? null : cell
    if (selected.value) meet([at(grid.value, r, c)])
    return
  }
  trySwap(selected.value, cell)
}

function trySwap(a, b) {
  const next = swapped(grid.value, a, b)
  selected.value = null
  if (!findMatches(next, mode.value).length) {
    // A swap that makes nothing costs nothing — it just refuses, visibly.
    rejected.value = [a, b]
    playFeedback(false)
    rejectTimer = setTimeout(() => {
      rejected.value = null
    }, REJECT_MS)
    return
  }
  grid.value = next
  moves.value -= 1
  reshuffled.value = false
  cascade()
}

/**
 * Resolve the board one clear at a time, pausing on each so the player can see
 * what went.
 *
 * Only the *first* step's features carry through to the chase window: that step
 * is the line the player made, and the window is what that line is worth. A
 * cascade underneath it still scores, but pooling its features too would open a
 * window on four or five of the six cases, which is no longer a chase.
 */
function cascade(depth = 0, fired = []) {
  const step = depth < MAX_CASCADE ? nextStep(grid.value, dealer, mode.value) : null
  if (!step) return settle(fired)

  busy.value = true
  clearing.value = step.keys
  score.value += stepScore(step.cleared.length, depth)
  meet(step.cleared)
  playFeedback(true)
  const paid = depth === 0 ? step.features : fired
  cascadeTimer = setTimeout(() => {
    clearing.value = new Set()
    grid.value = step.grid
    cascade(depth + 1, paid)
  }, CLEAR_MS)
}

/** The board has stopped moving: open the chase window, or end the game. */
function settle(fired) {
  busy.value = false
  if (!hasLegalMove(grid.value, mode.value)) {
    // Nothing left to swap. Re-dealing is not a punishment — there was no move
    // to find — so it costs neither a move nor a point.
    deal()
    reshuffled.value = true
  }
  if (fired.length) return openChase(fired)
  if (moves.value <= 0) finish()
}

// ── The chase window ─────────────────────────────────────────────────────
// A line pays out in seconds: one per feature it fired on, so a line that was
// both genitive and accusative is worth two. While the window is open the board
// takes single taps rather than swaps — hit a tile carrying one of those
// features and it goes, and the window re-opens for the next.

function openChase(features) {
  chase.value = { features, streak: 0 }
  grantChase()
}

function grantChase() {
  const deadline = Date.now() + chaseWindowMs(chase.value.features)
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
  if (phase.value === 'playing' && moves.value <= 0) finish()
}

function chaseTap(r, c) {
  if (!isChaseHit(grid.value, chase.value.features, r, c)) {
    // A tile with none of the window's features closes it. The window pays for
    // the reading you have already shown, not for guessing.
    playFeedback(false)
    endChase()
    return
  }
  const streak = chase.value.streak + 1
  score.value += chaseScore(streak)
  meet([at(grid.value, r, c)])
  playFeedback(true)

  // The board catches up at once rather than step by step: the window is still
  // running, and an animation the player has to sit through would spend it.
  grid.value = collapse(grid.value, new Set([`${r},${c}`]), dealer)
  for (let i = 0; i < MAX_CASCADE; i++) {
    const step = nextStep(grid.value, dealer, mode.value)
    if (!step) break
    score.value += stepScore(step.cleared.length, i)
    meet(step.cleared)
    grid.value = step.grid
  }
  if (!hasLegalMove(grid.value, mode.value)) {
    deal()
    reshuffled.value = true
  }
  chase.value = { ...chase.value, streak }
  grantChase()
}

onMounted(() => {
  loadSettings()
})

onUnmounted(clearTimers)
</script>

<template>
  <section v-if="phase === 'idle'" class="grid">
    <h2 style="margin: 0">Inflection crush 💠</h2>
    <p class="muted" style="margin: 0">
      A grid of inflected nouns and adjectives. Swap two neighbours to line up three that share a
      grammatical feature; they clear, and every feature the line fired on buys you one second to
      tap the same thing anywhere else on the board. {{ MOVES_PER_GAME }} swaps a game.
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

  <section v-else class="grid crush" style="gap: 0.75rem; position: relative">
    <CelebrationBurst :show="phase === 'over' && score > 0" />

    <div class="row" style="justify-content: space-between">
      <span class="pill">{{ modeCopy.label }} · {{ moves }} swap{{ moves === 1 ? '' : 's' }} left</span>
      <span class="muted">{{ score }} points<template v-if="best[mode]"> · best {{ best[mode] }}</template></span>
    </div>

    <div v-if="chase" class="chase" :class="{ urgent: chaseSeconds <= 0.5 }">
      <div class="chase-bar" :style="{ width: `${chaseFraction * 100}%` }" />
      <span class="chase-text">
        Chase {{ chaseNames }} · {{ chaseSeconds.toFixed(1) }}s<template v-if="chase.streak">
          · ×{{ chase.streak }}</template>
      </span>
    </div>
    <p v-else class="muted chase-idle" style="margin: 0">
      {{ mode === 'case' ? 'Line up three in the same case.' : 'Line up three that agree.' }}
    </p>

    <div
      class="board"
      :class="{ chasing: !!chase }"
      :style="{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }"
    >
      <template v-for="r in grid.rows" :key="r">
        <button
          v-for="c in grid.cols"
          :key="at(grid, r - 1, c - 1).id"
          type="button"
          class="tile"
          lang="ru"
          :class="{
            selected: isSelected(r - 1, c - 1),
            clearing: isClearing(r - 1, c - 1),
            rejected: isRejected(r - 1, c - 1),
            target: isTarget(r - 1, c - 1),
          }"
          :disabled="phase !== 'playing' || busy"
          @click="tap(r - 1, c - 1)"
        >
          {{ at(grid, r - 1, c - 1).form }}
        </button>
      </template>
    </div>

    <p v-if="reshuffled" class="muted" style="margin: 0">
      No swap left on that board, so it was re-dealt. It cost you nothing.
    </p>

    <!-- The word cards the clears queue up. Below the board rather than over
         it: during a chase the player needs to keep looking at the grid, and a
         card that covered it would make the window unplayable. -->
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
      <p class="feedback good" style="margin: 0">
        Out of swaps — {{ score }} point{{ score === 1 ? '' : 's' }}.
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

.board {
  display: grid;
  gap: 0.3rem;
}

.tile {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  padding: 0.15rem;
  /* Obliques run long and the tile is a fifth of a phone; let the form wrap
     rather than shrink the whole board to fit its worst word. */
  font-size: clamp(0.55rem, 2.5vw, 0.85rem);
  line-height: 1.15;
  overflow-wrap: anywhere;
  hyphens: none;
  border-radius: 8px;
  transition:
    opacity 200ms ease,
    transform 200ms ease,
    border-color 120ms ease,
    background 120ms ease;
}

.tile:disabled {
  opacity: 1; /* a settling board is not a dead one */
  cursor: default;
}

.tile.selected {
  border-color: var(--primary);
  background: rgb(79 125 255 / 22%);
}

.tile.clearing {
  opacity: 0;
  transform: scale(0.75);
}

.tile.rejected {
  border-color: var(--bad);
  animation: shake 300ms ease;
}

/* During a chase every tile is tappable, so the ones that would score say so.
   Not a colour alone: the ring is what a colour-blind player reads. */
.board.chasing .tile.target {
  border-color: var(--gold);
  box-shadow: inset 0 0 0 2px var(--gold);
}

.chase {
  position: relative;
  height: 1.6rem;
  border-radius: 999px;
  overflow: hidden;
  background: rgb(127 127 127 / 25%);
}

.chase-bar {
  height: 100%;
  background: var(--gold);
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
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  color: var(--bg);
  font-weight: 600;
}

/* Stands in for the chase bar when no window is open, at exactly its height:
   the board must not jump up the moment a line clears. */
.chase-idle {
  height: 1.6rem;
  display: grid;
  align-items: center;
  overflow: hidden;
  font-size: 0.8rem;
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

@keyframes shake {
  25% {
    transform: translateX(-3px);
  }
  75% {
    transform: translateX(3px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tile,
  .chase-bar {
    transition: none;
  }

  .tile.rejected {
    animation: none;
  }
}
</style>
