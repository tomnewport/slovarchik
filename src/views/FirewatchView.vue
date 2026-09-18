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
  KERNEL_REACH,
  PLANE,
  SIZE,
  approachHeading,
  cellGlyph,
  coordinateFrom,
  coordinateLabel,
  coordinateNumber,
  douse,
  generateForest,
  hintWordAt,
  planePath,
  resolveGlyphs,
  stats,
  step,
  wordsSaid,
} from '../lib/firewatch.js'
import { cardinalNominative, parseCardinals } from '../lib/numerals.js'
import { loadSettings, playCelebration, playFeedback } from '../stores/settings.js'

// A round is a break between practice, not a session of its own.
const ROUND_MS = 120_000
// The simulation runs on its own fixed tick so the fire spreads at the same
// rate on a 120Hz screen as on a throttled one; the frame loop only draws.
const TICK_S = 0.1
// Cells a second. Flights are timed from their length rather than given a
// fixed duration, so every plane flies at the same speed whether it is
// crossing the map or turning at the edge.
const PLANE_SPEED = 80
const WATER_MS = 700
// How many planes the learner has at once. It grows through the round: the
// fires get worse, and by then they are reading coordinates off the map fast
// enough to keep more than two in the air.
const FLEET_START = 2
const FLEET_MAX = 6
const FLEET_EVERY_MS = 22_000
// Typing ahead is the point, but an unbounded queue would let a round be won
// in the first twenty seconds and then watched.
const QUEUE_MAX = 6
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
const inAir = ref(0)
const fleet = ref(FLEET_START)
// Coordinates typed but not yet flown, in the order they were typed.
const queued = ref(/** @type {{x: number, y: number}[]} */ ([]))
const best = ref(0)
const entry = ref('')
const marker = ref(/** @type {{x: number, y: number}|null} */ (null))
// How far into the answer the learner asked to be shown. Cleared by saying the
// word, not by a second press — see `hint` below.
const hintAt = ref(/** @type {number|null} */ (null))
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
/** The square the box currently spells, if it spells a whole one. */
const target = computed(() => coordinateFrom(typed.value))
/**
 * What the box says so far, as the four digits of a coordinate. Never as a
 * labelled pair: working out that x=12 and y=3 means «1203» is arithmetic, and
 * arithmetic is not the thing being practised — the number on screen has to be
 * the number to say.
 *
 * It updates as the words arrive, so «ты́сяча» reads 1000 and «ты́сяча
 * две́сти» reads 1200 on the way to 1203. Watching the number assemble itself
 * is most of the lesson.
 */
const parseHint = computed(() => {
  const nums = typed.value
  if (nums === null) return { bad: 'Not a number I know' }
  // Nothing typed yet: a worked example rather than an instruction, because
  // «ты́сяча две́сти три» → 1203 shown once is the whole rule.
  if (nums.length === 0) return { example: true, across: '12', down: '03' }
  // Two numbers is the old habit — reading the halves off separately — which
  // is exactly what this drill exists to replace, so say so rather than
  // silently refusing.
  if (nums.length > 1) return { bad: 'One number for the whole square' }
  const digits4 = String(Math.min(9999, Math.max(0, nums[0]))).padStart(4, '0')
  return { across: digits4.slice(0, 2), down: digits4.slice(2) }
})
const words = (n) => cardinalNominative(n)

// ── The hint ───────────────────────────────────────────────────────
// One word at a time, and only the word wanted next. Showing the whole numeral
// is a pass — the learner reads it off and learns nothing — but being stuck on
// «четы́ре ты́сячи…» with no way forward is worse. A word at a time keeps
// the rest of the numeral theirs to produce.

/** The answer for the square the learner has tapped, if they have tapped one. */
const answer = computed(() => (marker.value ? words(coordinateNumber(marker.value.x, marker.value.y)) : ''))
/** How much of it is already in the box. */
const said = computed(() => wordsSaid(answer.value, entry.value))
/**
 * The word on show, if any. Derived rather than stored, so saying the word
 * clears the hint by itself: once it is in the box `said` moves past the index
 * that was asked for and there is nothing to show. Deleting it brings the hint
 * back, which is the right answer to a typo.
 */
const hint = computed(() =>
  hintAt.value !== null && hintAt.value === said.value ? hintWordAt(answer.value, hintAt.value) : null,
)
/** Whether there is anything left to hint at. */
const canHint = computed(() => !!answer.value && hintWordAt(answer.value, said.value) !== null)

function showHint() {
  if (canHint.value) hintAt.value = said.value
}
/** A square as its four digits, split for the two-tone display. */
const digits = (p) => ({
  across: coordinateLabel(p.x, p.y).slice(0, 2),
  down: coordinateLabel(p.x, p.y).slice(2),
})

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
  planeSprite = sprite(glyphs.plane, Math.max(28, cell * 6))
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
  // The whole area a flight can wet: the circle the water is released on, plus
  // how far a release reaches. Drawn before the plane arrives, so the learner
  // can see whether the drop they just called will cover the fire.
  const reach = PLANE.dropRadius + KERNEL_REACH
  const side = reach * 2 + 1
  const left = (x - reach) * cell
  const top = (y - reach) * cell
  ctx.save()
  ctx.strokeStyle = colour
  ctx.lineWidth = Math.max(2, cell / 3)
  if (fill) {
    ctx.fillStyle = fill
    ctx.fillRect(left, top, cell * side, cell * side)
  }
  ctx.strokeRect(left, top, cell * side, cell * side)
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

  // Dawn. The fire spreads faster as the shift wears on (#762), and a
  // difficulty that only ever gets *felt* is a difficulty the player thinks is
  // their own fault — so the light goes with it, blue and flat at the start,
  // warm by the end. One rectangle a frame, over the terrain and under
  // everything that moves, so it costs nothing and never tints a flame.
  const sun = 1 - msLeft.value / ROUND_MS
  ctx.save()
  ctx.globalCompositeOperation = 'overlay'
  ctx.fillStyle = `rgb(${120 + 135 * sun} ${140 + 60 * sun} ${190 - 110 * sun} / ${12 + 20 * sun}%)`
  ctx.fillRect(0, 0, base.width, base.height)
  ctx.restore()

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

  // What is already called for, so the learner does not send two planes to the
  // same fire: amber for a coordinate still waiting its turn, red once a plane
  // is on its way to it.
  for (const waiting of queued.value) {
    drawCrosshairs(waiting.x, waiting.y, '#f0a020', { lines: 0.25 })
  }
  for (const plane of planes) {
    if (plane.dropped < plane.flight.releases.length) {
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
    const at = plane.flight.at(Math.min(1, (now - plane.born) / plane.duration))
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
  inAir.value = planes.length
}

/** Put a plane in the air for the next coordinate waiting, if one can go. */
function launch(now) {
  while (planes.length < fleet.value && queued.value.length) {
    const to = queued.value[0]
    queued.value = queued.value.slice(1)
    const flight = planePath(to, approachHeading())
    planes.push({
      target: to,
      flight,
      duration: (flight.length / PLANE_SPEED) * 1000,
      born: now,
      // How many of this flight's releases have already been applied.
      dropped: 0,
    })
    sent.value++
  }
  inAir.value = planes.length
}

function simulate(dt, now) {
  carry += dt
  while (carry >= TICK_S) {
    step(world, TICK_S)
    carry -= TICK_S
  }
  for (const i of world.changed) patch(i)
  world.changed.clear()

  fleet.value = Math.min(
    FLEET_MAX,
    FLEET_START + Math.floor((ROUND_MS - msLeft.value) / FLEET_EVERY_MS),
  )
  launch(now)

  const still = reduceMotion()
  planes = planes.filter((plane) => {
    const t = (now - plane.born) / plane.duration
    // Water goes out release by release as the plane comes round, not in one
    // go: the ring has to appear under the plane and nowhere else, or the
    // circuit is a lie the learner can watch being told.
    while (plane.dropped < plane.flight.releases.length) {
      const release = plane.flight.releases[plane.dropped]
      if (t < release.t) break
      plane.dropped++
      const x = Math.round(release.x)
      const y = Math.round(release.y)
      if (douse(world, x, y)) playFeedback(true)
      if (still) continue
      for (let n = 0; n < 3; n++) {
        drops.push({
          x: x + (Math.random() - 0.5) * 2,
          y: y + (Math.random() - 0.5) * 2,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          born: now,
        })
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
  queued.value = []
  hintAt.value = null
  fleet.value = FLEET_START
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
  queued.value = []
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

/**
 * Call for a plane. It joins the queue rather than taking off at once, so the
 * learner can keep typing while the last one is still flying — which is the
 * whole point of drilling the numbers to speed. A plane leaves as soon as one
 * of the fleet is free.
 */
function send() {
  if (phase.value !== 'playing') return
  const to = target.value
  if (!to || queued.value.length >= QUEUE_MAX) {
    playFeedback(false)
    return
  }
  queued.value = [...queued.value, to]
  // A clean slate for the next coordinate: the box, the square that was tapped
  // and any hint taken on it all go together, so nothing from the last call is
  // still on screen while the next one is being read off the map.
  entry.value = ''
  marker.value = null
  hintAt.value = null
  launch(performance.now())
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
  hintAt.value = null
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
      A forest, 100 squares across and 100 down, and fires that spread. Every square is a
      four-digit number — <b><span class="across">12</span><span class="down">03</span></b>,
      across then down — and you send a water plane to one by saying that number in Russian,
      whole: «ты́сяча две́сти три». Tap the map and it tells you which one; the colours
      match the ticks along the top and the side. 💡 Hint gives you the next word of it and
      nothing more — say that word and it goes, ready to give you the one after.
    </p>
    <p class="muted" style="margin: 0">
      The plane circles the fire and lets water go all the way round. Where it lands it puts the
      fire out <em>and</em> leaves the ground too wet to catch, so a ring laid around a fire pens
      it in — which is the only way to beat a blaze that has got going. Catch them early.
    </p>
    <p class="muted" style="margin: 0">
      Keep typing while they fly: the next coordinates queue up and go as planes come free. You
      start with two planes and earn more as the shift wears on — which you will want, because
      the forest dries out as the sun comes up and the fires spread faster with it. Two minutes;
      the score is how much forest is left standing.
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
      <span class="muted fleet">✈️ {{ inAir }}/{{ fleet }}</span>
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

<!-- The hint button lives up here with the readout, not in the row of
         controls below the box. On a phone the shared Russian keyboard covers
         the bottom of the screen the whole time the learner is typing, which
         is exactly when they reach for a hint — a button under it is a button
         that does not exist. -->
    <div class="readout" :class="{ empty: !marker }">
      <p class="readout-text">
        <template v-if="marker">
          📍
          <b class="coord"
            ><span class="across">{{ digits(marker).across }}</span
            ><span class="down">{{ digits(marker).down }}</span></b
          >
          <span v-if="hint" lang="ru" class="hint-word">💡 {{ hint }}</span>
        </template>
        <template v-else>📍 Tap the map for a coordinate</template>
      </p>
      <button
        v-if="phase === 'playing'"
        type="button"
        class="hint-btn"
        :disabled="!canHint"
        @click="showHint"
      >
        💡 Hint
      </button>
    </div>

    <p v-if="phase === 'playing'" class="parse muted" :class="{ bad: !!parseHint.bad }">
      <template v-if="parseHint.bad">✗ {{ parseHint.bad }}</template>
      <template v-else>
        <span v-if="parseHint.example" lang="ru">«ты́сяча две́сти три»</span>
        <template v-else>→</template>
        <b class="coord"
          ><span class="across">{{ parseHint.across }}</span
          ><span class="down">{{ parseHint.down }}</span></b
        >
      </template>
    </p>
    <form v-if="phase === 'playing'" class="send" @submit.prevent="send">
      <input
        v-model="entry"
        lang="ru"
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="ты́сяча две́сти три"
        aria-label="Where to send the plane, as a Russian number"
      />
      <button class="primary" type="submit" :disabled="!target">Send ✈️</button>
    </form>

    <p v-if="phase === 'playing'" class="queue" :class="{ empty: !queued.length }">
      <template v-if="queued.length">
        <span class="muted">Waiting:</span>
        <span v-for="(q, i) in queued" :key="`${q.x}-${q.y}-${i}`" class="chip coord"
          ><span class="across">{{ digits(q).across }}</span
          ><span class="down">{{ digits(q).down }}</span></span
        >
      </template>
      <span v-else class="muted">Type the next one while these fly.</span>
    </p>

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
      <button type="button" @click="finish">Stop</button>
    </div>
  </section>
</template>

<style scoped>
/* Warm for across, cool for down. Far enough apart to tell at a glance at
   tick size, and both legible against the page and the map's dark ground. */
.firewatch,
.grid {
  --across: #f0b429;
  --down: #56b7e8;
}

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
  opacity: 0.85;
}

/* The two halves of a coordinate, tinted to match the axis each is read off.
   That colour is the whole explanation of what 4320 means: no legend, no
   "x = 43, y = 20", nothing to work out. */
.across {
  color: var(--across);
}

.down {
  color: var(--down);
}

.axis.x span {
  color: var(--across);
}

.axis.y span {
  color: var(--down);
}

.coord {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.parse .coord {
  margin-left: 0.25rem;
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
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-variant-numeric: tabular-nums;
}

.readout-text {
  margin: 0;
  flex: 1;
  min-width: 0;
}

.readout.empty .readout-text {
  opacity: 0.6;
}

.hint-btn {
  flex: none;
}

.readout .coord {
  font-size: 1.5rem;
}

.hint-word {
  margin-left: 0.5rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: rgb(240 180 41 / 18%);
  font-size: 1.05rem;
}

.fleet {
  margin-left: auto;
}

.queue {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem;
  margin: 0;
  min-height: 1.6rem;
  font-size: 0.85rem;
}

.chip {
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: rgb(127 127 127 / 18%);
  font-weight: 600;
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
