<script setup>
// Firewatch minigame (#731). Fires spread through a 100 × 100 forest; the
// learner puts them out by typing where, as two Russian numbers.
//
// Everything that decides what happens lives in src/lib/firewatch.js. This
// view owns three things and nothing else: the clock, the canvas, and the
// typing.
//
// Why a canvas (open question 1 on #731): 10 000 cells as DOM nodes will not
// hold a frame rate, and pan/zoom would put the map's addressing at odds with
// the numbers being drilled. So the whole world is always on screen, drawn as
// one image — the terrain is painted once into an offscreen canvas and patched
// cell by cell as it changes, and each frame blits that and draws only what
// moves on top. At a phone's width a cell is three or four CSS pixels, which
// is too small to read an emoji but exactly right for seeing *where the fire
// is* — and the axis ticks and the tap-anywhere readout are what turn a place
// on the map into the number to type.
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue'

import {
  BURNED,
  DROP_AT,
  KERNEL,
  SIZE,
  cellGlyph,
  douse,
  generateForest,
  planePath,
  approachFrom,
  resolveGlyphs,
  stats,
  step,
} from '../lib/firewatch.js'
import { cardinalNominative, parseCardinals } from '../lib/numerals.js'
import { loadSettings, playCelebration, playFeedback } from '../stores/settings.js'

// A round is a break between practice, not a session of its own.
const ROUND_MS = 120_000
// The simulation runs on its own fixed tick so the fire spreads at the same
// rate on a 120Hz screen as on a throttled one; the frame loop only draws.
const TICK_S = 0.1
// A flight, end to end. #726 asks for "about a second" to the drop, which
// DROP_AT (0.55 of the way through) puts at 1.2s.
const FLIGHT_MS = 2200
const WATER_MS = 800
// Every tenth line gets a tick label — the ruler the learner reads off.
const TICKS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
const GROUND = '#2b3826'
const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif'

const phase = ref('idle') // idle | playing | over
const msLeft = ref(ROUND_MS)
const burning = ref(0)
const saved = ref(1)
const housesLost = ref(0)
const sent = ref(0)
const doused = ref(0)
const best = ref(0)
const entry = ref('')
const marker = ref(/** @type {{x: number, y: number}|null} */ (null))
const showWords = ref(false)
const mapPx = ref(320)
const wrapEl = useTemplateRef('wrapEl')
const canvasEl = useTemplateRef('canvasEl')

// Not reactive, deliberately: the world is three typed arrays of 10 000 cells
// and a Vue proxy over them would cost more than the simulation does. Anything
// the template needs is mirrored onto the refs above, once per tick.
let world = null
let planes = []
let drops = []
let raf = null
let deadline = 0
let lastFrame = 0
let carry = 0

// Canvas scratch, all in device pixels.
let ctx = null
let base = null // the terrain, painted once and patched as cells change
let baseCtx = null
let cell = 4
// Keyed by the glyph itself, not by its slot: two slots may resolve to the
// same character once a fallback kicks in, and a cell's look is a glyph.
let sprites = {}
let fireSprite = null
let waterSprite = null
let planeSprite = null
let glowSprite = null
let glyphs = resolveGlyphs()
const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ── What the typing means ────────────────────────────────────────────────

const typed = computed(() => parseCardinals(entry.value))
/** The coordinate the box currently spells, if it spells a whole one. A parsed
 *  cardinal cannot exceed 99, so anything two numbers long is on the map. */
const target = computed(() => {
  const nums = typed.value
  if (!nums || nums.length !== 2) return null
  return { x: nums[0], y: nums[1] }
})
// Said back as it is typed, because reading "со́рок три → 43" while typing it is
// most of the lesson — and because a box that silently does nothing when you
// misspell a numeral teaches only frustration.
const parseHint = computed(() => {
  const nums = typed.value
  if (nums === null) return '✗ Not a number I know'
  if (nums.length === 0) return 'Two numbers: across, then down.'
  if (nums.length === 1) return `→ X ${nums[0]} · Y …`
  if (nums.length > 2) return '✗ Two numbers, not more'
  return `→ X ${nums[0]} · Y ${nums[1]}`
})
const words = (n) => cardinalNominative(n)

const seconds = computed(() => Math.ceil(msLeft.value / 1000))
const savedPct = computed(() => Math.round(saved.value * 1000) / 10)

// ── Drawing ──────────────────────────────────────────────────────────────

/**
 * Whether this device can actually draw a glyph, rather than a tofu box or —
 * for a ZWJ sequence it does not know — the two emoji it is built from. Both
 * failures are visible in what the canvas measures, which is the only honest
 * test available: the font stack is whatever the OS has.
 */
function glyphProbe() {
  const probe = document.createElement('canvas')
  const pctx = probe.getContext?.('2d')
  if (!pctx) return () => true
  pctx.font = `20px ${EMOJI_FONT}`
  // A noncharacter: no font has it, so whatever it draws is this device's tofu.
  const tofu = pctx.measureText('\u{10FFFF}').width
  const one = pctx.measureText('\u{1F600}').width
  return (glyph) => {
    const w = pctx.measureText(glyph).width
    if (Math.abs(w - tofu) < 0.01) return false
    // A ZWJ sequence that failed renders as two emoji side by side.
    return w <= one * 1.4
  }
}

/**
 * The halo under a fire. At a phone's width a burning cell is four pixels of
 * orange in ten thousand cells of forest, which is not something a player can
 * *find* — and finding it is the whole game. Drawn additively, so a front of
 * neighbouring fires blooms into one glow the size of the problem.
 */
function glow(px) {
  const c = document.createElement('canvas')
  c.width = px
  c.height = px
  const gctx = c.getContext('2d')
  if (gctx) {
    const grad = gctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2)
    grad.addColorStop(0, 'rgb(255 180 60 / 75%)')
    grad.addColorStop(0.4, 'rgb(255 90 20 / 35%)')
    grad.addColorStop(1, 'rgb(255 60 0 / 0%)')
    gctx.fillStyle = grad
    gctx.fillRect(0, 0, px, px)
  }
  return c
}

/** Pre-render one glyph at `px` device pixels, so the map is blits not text. */
function sprite(glyph, px) {
  const c = document.createElement('canvas')
  c.width = px
  c.height = px
  const sctx = c.getContext('2d')
  if (sctx) {
    sctx.font = `${Math.round(px * 0.92)}px ${EMOJI_FONT}`
    sctx.textAlign = 'center'
    sctx.textBaseline = 'middle'
    sctx.fillText(glyph, px / 2, px / 2 + px * 0.04)
  }
  return c
}

/**
 * Size the canvas to the space available, at a whole number of device pixels
 * per cell. Fractional cells would land every tree on a half-pixel and turn
 * the whole forest to mush; rounding down and letting the map be a few CSS
 * pixels narrower than its box costs nothing and keeps every cell crisp.
 */
function layout() {
  const dpr = window.devicePixelRatio || 1
  const avail = Math.min(wrapEl.value?.clientWidth || 320, 560)
  cell = Math.max(3, Math.floor((avail * dpr) / SIZE))
  const device = cell * SIZE
  mapPx.value = Math.round(device / dpr)
  const canvas = canvasEl.value
  if (!canvas) return
  canvas.width = device
  canvas.height = device
  ctx = canvas.getContext?.('2d') ?? null
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  base = document.createElement('canvas')
  base.width = device
  base.height = device
  baseCtx = base.getContext('2d')
  glyphs = resolveGlyphs(glyphProbe())
  sprites = {}
  for (const glyph of Object.values(glyphs)) sprites[glyph] ??= sprite(glyph, cell)
  fireSprite = sprite(glyphs.fire, Math.max(8, cell * 2))
  // Bigger than a cell, both of them: at a phone's width a cell is three or
  // four pixels, and a plane that small is a speck.
  waterSprite = sprite(glyphs.water, Math.max(8, cell * 2))
  planeSprite = sprite(glyphs.plane, Math.max(16, cell * 4))
  glowSprite = glow(Math.max(20, cell * 6))
  paintTerrain()
}

/** Paint every cell into the base canvas — once per round, or per resize. */
function paintTerrain() {
  if (!baseCtx || !world) return
  // Ground first: the glyphs do not tile, and what shows between them sets
  // the map's contrast. Something dark and earthy keeps a fire the brightest
  // thing on screen.
  baseCtx.clearRect(0, 0, base.width, base.height)
  baseCtx.fillStyle = GROUND
  baseCtx.fillRect(0, 0, base.width, base.height)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      patch(y * SIZE + x)
    }
  }
}

/**
 * Redraw one cell of the base canvas in its resting state. Fire is never
 * painted here — it is drawn on top every frame so it can flicker — so a cell
 * that has just caught still shows its tree underneath, and one that has just
 * been doused needs no patch at all.
 */
function patch(i) {
  if (!baseCtx || !world) return
  const x = i % SIZE
  const y = (i - x) / SIZE
  const state = world.state[i] === BURNED ? BURNED : 0
  baseCtx.clearRect(x * cell, y * cell, cell, cell)
  baseCtx.drawImage(sprites[cellGlyph(world.kind[i], state, glyphs)], x * cell, y * cell)
}

function drawGrid() {
  ctx.lineWidth = 1
  for (const t of TICKS) {
    const p = Math.round(t * cell) + 0.5
    ctx.strokeStyle = t === 0 ? 'rgb(0 0 0 / 35%)' : 'rgb(0 0 0 / 18%)'
    ctx.beginPath()
    ctx.moveTo(p, 0)
    ctx.lineTo(p, base.height)
    ctx.moveTo(0, p)
    ctx.lineTo(base.width, p)
    ctx.stroke()
  }
}

/**
 * Cross-hairs on a square, and the 5×5 the drop will cover — which is what
 * #726 asks for and also the clearest way to teach the kernel: you can see
 * before the plane arrives exactly how much of the fire it can reach.
 *
 * The lines run the full width and height on purpose. They are what carries
 * the eye out to the tick labels, so a square on the map turns into the two
 * numbers to type.
 */
function drawCrosshairs(x, y, colour, { fill = null, lines = 0.45 } = {}) {
  const half = KERNEL.length / 2
  const left = (x - half + 0.5) * cell
  const top = (y - half + 0.5) * cell
  ctx.save()
  ctx.strokeStyle = colour
  ctx.lineWidth = Math.max(2, cell / 3)
  if (fill) {
    ctx.fillStyle = fill
    ctx.fillRect(left, top, cell * 5, cell * 5)
  }
  ctx.strokeRect(left, top, cell * 5, cell * 5)
  ctx.globalAlpha = lines
  ctx.lineWidth = Math.max(1, cell / 4)
  ctx.beginPath()
  ctx.moveTo((x + 0.5) * cell, 0)
  ctx.lineTo((x + 0.5) * cell, base.height)
  ctx.moveTo(0, (y + 0.5) * cell)
  ctx.lineTo(base.width, (y + 0.5) * cell)
  ctx.stroke()
  ctx.restore()
}

function draw(now) {
  if (!ctx || !world) return
  ctx.clearRect(0, 0, base.width, base.height)
  ctx.drawImage(base, 0, 0)

  // The break the last drop laid, under the flames rather than over them: a
  // front running up against blue and stopping is the thing the player is
  // trying to arrange, so it has to be visible while it is happening.
  ctx.save()
  ctx.fillStyle = 'rgb(90 170 255 / 30%)'
  for (const i of world.wet) {
    const x = i % SIZE
    const y = (i - x) / SIZE
    ctx.fillRect(x * cell, y * cell, cell, cell)
  }
  ctx.restore()

  const still = reduceMotion()
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const i of world.burning) {
    const x = i % SIZE
    const y = (i - x) / SIZE
    const g = glowSprite.width
    ctx.drawImage(glowSprite, (x + 0.5) * cell - g / 2, (y + 0.5) * cell - g / 2)
  }
  ctx.restore()
  for (const i of world.burning) {
    const x = i % SIZE
    const y = (i - x) / SIZE
    // Drawn over its cell's edges, for the same reason as the glow: at this
    // scale a flame confined to one cell is a pixel.
    const size = cell * (still ? 1.7 : 1.7 + 0.35 * Math.sin(now / 130 + i))
    const off = (size - cell) / 2
    ctx.drawImage(fireSprite, x * cell - off, y * cell - off, size, size)
  }

  drawGrid()

  for (const plane of planes) {
    if (!plane.dropped) {
      drawCrosshairs(plane.target.x, plane.target.y, '#ff3b2f', {
        fill: 'rgb(255 59 47 / 22%)',
        lines: 0.55,
      })
    }
  }
  if (marker.value) drawCrosshairs(marker.value.x, marker.value.y, '#f8fafc', { lines: 0.5 })

  for (const d of drops) {
    const age = (now - d.born) / WATER_MS
    if (age > 1) continue
    ctx.save()
    ctx.globalAlpha = 1 - age
    const s = waterSprite.width * (0.6 + age * 0.7)
    ctx.drawImage(
      waterSprite,
      (d.x + d.vx * age) * cell - s / 2,
      (d.y + d.vy * age + age * age * 4) * cell - s / 2,
      s,
      s,
    )
    ctx.restore()
  }

  for (const plane of planes) {
    const at = plane.path(Math.min(1, (now - plane.born) / FLIGHT_MS))
    const s = planeSprite.width
    ctx.save()
    ctx.translate(at.x * cell, at.y * cell)
    // ✈️ points north-east in every font that has it, so square it up first.
    ctx.rotate(at.angle + Math.PI / 4)
    ctx.drawImage(planeSprite, -s / 2, -s / 2)
    ctx.restore()
  }
}

// ── The round ────────────────────────────────────────────────────────────

function readHud() {
  const s = stats(world)
  burning.value = s.burning
  saved.value = s.saved
  housesLost.value = s.housesLost
  doused.value = s.doused
}

function simulate(dt, now) {
  carry += dt
  while (carry >= TICK_S) {
    step(world, TICK_S)
    carry -= TICK_S
  }
  for (const i of world.changed) patch(i)
  world.changed.clear()

  planes = planes.filter((plane) => {
    const t = (now - plane.born) / FLIGHT_MS
    if (t >= DROP_AT && !plane.dropped) {
      plane.dropped = true
      const hit = douse(world, plane.target.x, plane.target.y)
      if (hit) playFeedback(true)
      if (!reduceMotion()) {
        for (let n = 0; n < 8; n++) {
          drops.push({
            x: plane.target.x + (Math.random() - 0.5) * 4,
            y: plane.target.y + (Math.random() - 0.5) * 4,
            vx: (Math.random() - 0.5) * 3,
            vy: (Math.random() - 0.5) * 3,
            born: now,
          })
        }
      }
    }
    return t < 1
  })
  drops = drops.filter((d) => now - d.born < WATER_MS)
  readHud()
}

function frame(now) {
  raf = requestAnimationFrame(frame)
  // Clamp: a backgrounded tab hands back however long it slept, and letting
  // that through would burn the forest down while nobody was looking.
  const dt = Math.min(0.25, (now - lastFrame) / 1000)
  lastFrame = now
  if (phase.value === 'playing') {
    msLeft.value = Math.max(0, deadline - Date.now())
    simulate(dt, now)
    if (msLeft.value <= 0) finish()
  }
  draw(now)
}

function start() {
  world = generateForest()
  planes = []
  drops = []
  carry = 0
  sent.value = 0
  entry.value = ''
  marker.value = null
  msLeft.value = ROUND_MS
  deadline = Date.now() + ROUND_MS
  phase.value = 'playing'
  readHud()
  // The canvas only exists once the playing markup is rendered.
  requestAnimationFrame(() => {
    layout()
    lastFrame = performance.now()
    if (raf === null) raf = requestAnimationFrame(frame)
  })
}

function finish() {
  phase.value = 'over'
  planes = []
  drops = []
  readHud()
  if (saved.value > best.value) {
    best.value = saved.value
    playCelebration()
  }
}

function stop() {
  if (raf !== null) cancelAnimationFrame(raf)
  raf = null
  phase.value = 'idle'
  world = null
}

/** Send a plane, if the box spells a coordinate. */
function send() {
  if (phase.value !== 'playing') return
  const to = target.value
  if (!to) {
    playFeedback(false)
    return
  }
  planes.push({
    target: to,
    path: planePath(approachFrom(to), to),
    born: performance.now(),
    dropped: false,
  })
  sent.value++
  entry.value = ''
}

/** Tap (or drag) the map to read the coordinate off it. */
function pick(e) {
  const canvas = canvasEl.value
  if (!canvas || phase.value !== 'playing') return
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * SIZE)
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * SIZE)
  marker.value = {
    x: Math.min(SIZE - 1, Math.max(0, x)),
    y: Math.min(SIZE - 1, Math.max(0, y)),
  }
}

function onDown(e) {
  canvasEl.value?.setPointerCapture?.(e.pointerId)
  pick(e)
}

function onMove(e) {
  if (e.buttons) pick(e)
}

onMounted(() => {
  loadSettings()
  window.addEventListener('resize', layout)
})

onUnmounted(() => {
  if (raf !== null) cancelAnimationFrame(raf)
  raf = null
  window.removeEventListener('resize', layout)
})
</script>

<template>
  <section v-if="phase === 'idle'" class="grid">
    <h2 style="margin: 0">Firewatch 🔥</h2>
    <p class="muted" style="margin: 0">
      A forest, 100 squares across and 100 down, and fires that spread. Send a water plane by
      typing where it should go — two numbers in Russian words, across then down: «со́рок три
      два́дцать». Planes are unlimited and take about a second to arrive.
    </p>
    <p class="muted" style="margin: 0">
      A drop covers five squares by five and is only certain in the middle. Where it lands it
      puts the fire out <em>and</em> leaves the ground too wet to catch, so a plane dropped just
      ahead of a fire cuts a break and stops it — which is the only way to beat a blaze that has
      got going. Catch them early.
    </p>
    <p class="muted" style="margin: 0">
      Tap the map to read a coordinate off it, and watch the numbers along the top and the side.
      Two minutes; the score is how much forest is left standing.
    </p>
    <div class="row">
      <button class="primary" @click="start">Start</button>
    </div>
    <p v-if="best" class="muted" style="margin: 0">Best run: {{ Math.round(best * 100) }}% saved</p>
  </section>

  <section v-else class="grid firewatch" style="gap: 0.75rem">
    <div class="row hud">
      <span class="pill">{{ seconds }}s</span>
      <span class="muted">🔥 {{ burning }}</span>
      <span class="muted">🌲 {{ savedPct }}%</span>
      <span v-if="housesLost" class="muted">🏚️ {{ housesLost }}</span>
    </div>

    <div ref="wrapEl" class="map-wrap">
      <div class="map" :style="{ width: `${mapPx}px` }">
        <div class="axis x" aria-hidden="true">
          <span v-for="t in TICKS" :key="`x${t}`" :style="{ left: `${t}%` }">{{ t }}</span>
        </div>
        <div class="map-row">
          <div class="axis y" aria-hidden="true">
            <span v-for="t in TICKS" :key="`y${t}`" :style="{ top: `${t}%` }">{{ t }}</span>
          </div>
          <canvas
            ref="canvasEl"
            class="board"
            role="img"
            :aria-label="`Forest map, 100 by 100. ${burning} squares alight, ${savedPct}% still standing.`"
            :style="{ width: `${mapPx}px`, height: `${mapPx}px` }"
            @pointerdown="onDown"
            @pointermove="onMove"
          />
        </div>
      </div>
    </div>

    <p class="readout" :class="{ empty: !marker }">
      <template v-if="marker">
        📍 X <b>{{ marker.x }}</b> · Y <b>{{ marker.y }}</b>
        <span v-if="showWords" lang="ru" class="muted">
          — {{ words(marker.x) }} {{ words(marker.y) }}</span
        >
      </template>
      <template v-else>📍 Tap the map for a coordinate</template>
    </p>

    <p v-if="phase === 'playing'" class="parse muted" :class="{ bad: typed === null }">
      {{ parseHint }}
    </p>
    <form v-if="phase === 'playing'" class="send" @submit.prevent="send">
      <input
        v-model="entry"
        lang="ru"
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="со́рок три два́дцать"
        aria-label="Where to send the plane, as two Russian numbers"
      />
      <button class="primary" type="submit" :disabled="!target">Send ✈️</button>
    </form>

    <template v-if="phase === 'over'">
      <p class="feedback" :class="saved > 0.9 ? 'good' : 'bad'" style="margin: 0">
        {{ savedPct }}% of the forest still standing · {{ housesLost }} houses lost ·
        {{ sent }} planes · {{ doused }} fires out
      </p>
      <div class="row">
        <button class="primary" @click="start">Again</button>
        <button @click="stop">Stop</button>
      </div>
    </template>
    <div v-else class="row" style="gap: 0.5rem; flex-wrap: wrap">
      <button type="button" @click="showWords = !showWords">
        {{ showWords ? '🙈 Hide the words' : '👁 Show the words' }}
      </button>
      <button type="button" @click="finish">Stop</button>
    </div>
  </section>
</template>

<style scoped>
.map-wrap {
  width: 100%;
}

/* The gutter the row of Y ticks sits in. Two digits at the tick size, plus a
   hair of daylight between the label and the map's edge. */
.map {
  --gutter: 1.15rem;
  --tick: 0.55rem;

  position: relative;
  padding-left: var(--gutter);
  padding-top: calc(var(--tick) + 0.2rem);
  margin-inline: auto;
  box-sizing: content-box;
}

.map-row {
  position: relative;
}

.axis span {
  position: absolute;
  font-size: var(--tick);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  opacity: 0.65;
}

.axis.x {
  position: absolute;
  top: 0;
  left: var(--gutter);
  right: 0;
  height: var(--tick);
}

.axis.x span {
  top: 0;
  /* Just right of the gridline it names, so 0 never hangs off the edge. */
  margin-left: 1px;
}

.axis.y {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--gutter) * -1);
  width: calc(var(--gutter) - 0.2rem);
}

.axis.y span {
  right: 0;
  margin-top: 1px;
}

.board {
  display: block;
  border-radius: 4px;
  /* Matches the ground the terrain is painted onto, so the map has one edge
     rather than a seam while it is being drawn. */
  background: #2b3826;
  touch-action: none;
  cursor: crosshair;
}

.hud {
  gap: 0.75rem;
  align-items: baseline;
}

.readout {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.readout.empty {
  opacity: 0.6;
}

.readout b {
  font-size: 1.15rem;
}

.send {
  display: flex;
  gap: 0.5rem;
}

.send input {
  flex: 1;
  min-width: 0;
}

.parse {
  margin: 0;
  font-size: 0.85rem;
  min-height: 1.2em;
}

.parse.bad {
  color: var(--bad);
}
</style>
