<script setup>
// Bomb disposal minigame (#728). The instruction is spoken in Russian and the
// player cuts wires in the order it demands, against a clock.
//
// Everything that decides what the bomb is and whether a cut was right lives
// in src/lib/bombDisposal.js; this view owns the clock, the speaking and the
// animation, and nothing else.
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  COLORS,
  cutOutcome,
  generateBomb,
  isDefused,
  readingRateFor,
  resolvePlan,
  stageTargets,
  wireLabelEn,
} from '../lib/bombDisposal.js'
import { cancelSpeech, speak, speechSupported, voiceAvailable, SLOW_RATE } from '../lib/speech.js'
import { loadSettings, playCelebration, playFeedback } from '../stores/settings.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'

// How long the defused bomb is admired before the next one arrives.
const DEFUSED_MS = 1200
// The clock is read every tick; 100ms keeps the bar smooth without a rAF loop.
const TICK_MS = 100

const phase = ref('idle') // idle | armed | defused | boom
const bomb = ref(null)
const cut = ref([])
const msLeft = ref(0)
const round = ref(1)
const best = ref(0)
// Whether the instruction is on screen as well as in the air. Off by default —
// reading it is a pass, and the listening is the point — but forced on when
// there is no Russian voice to hear it from.
const showText = ref(false)
const showGloss = ref(false)
const failure = ref('')

let ticker = null
let advance = null
// When this round's time is up, as a wall-clock instant. The countdown is read
// from it rather than counted down a tick at a time: a backgrounded tab
// throttles its timers heavily, and subtracting a fixed TICK_MS per callback
// would quietly hand the player back however long the tab was asleep.
let deadline = 0

// Asked afresh each round rather than once at mount: voices load
// asynchronously, so the answer early in a page's life is often a
// not-yet rather than a no.
const canHear = ref(true)

const plan = computed(() => (bomb.value ? resolvePlan(bomb.value.rule, bomb.value.wires) : null))
const secondsLeft = computed(() => Math.max(0, msLeft.value / 1000))
const timeFraction = computed(() =>
  bomb.value ? Math.max(0, msLeft.value / (bomb.value.seconds * 1000)) : 0,
)
const urgent = computed(() => secondsLeft.value <= 5)

// What the player still owes, so a defused-in-stages plan can show progress
// without giving the order away.
const remaining = computed(() => {
  if (!plan.value || !bomb.value) return 0
  return stageTargets(plan.value, bomb.value.wires)
    .flat()
    .filter((id) => !cut.value.includes(id)).length
})

const REASONS = {
  'not-a-target': 'That wire was never in the instruction.',
  'out-of-order': 'Right wire, wrong moment — something had to come first.',
  timeout: 'Out of time.',
}

function stopClock() {
  clearInterval(ticker)
  clearTimeout(advance)
  ticker = null
  advance = null
}

// The default rate climbs with the round (see readingRateFor); the 🐢 button
// passes SLOW_RATE instead, so the escape hatch stays as slow as ever however
// far the run has got.
function say(rate = readingRateFor(round.value)) {
  if (!bomb.value) return
  speak(bomb.value.ru, 'ru-RU', rate)
}

function arm() {
  stopClock()
  cancelSpeech()
  canHear.value = voiceAvailable('ru-RU')
  bomb.value = generateBomb(round.value)
  cut.value = []
  failure.value = ''
  msLeft.value = bomb.value.seconds * 1000
  deadline = Date.now() + msLeft.value
  showText.value = !canHear.value
  showGloss.value = false
  phase.value = 'armed'
  say()
  ticker = setInterval(() => {
    msLeft.value = Math.max(0, deadline - Date.now())
    if (msLeft.value <= 0) explode('timeout')
  }, TICK_MS)
}

function start() {
  round.value = 1
  arm()
}

/** Leave the game. The clock and the voice have to go with it, or the round
 *  keeps running underneath the start screen and detonates on top of it. */
function stop() {
  stopClock()
  cancelSpeech()
  phase.value = 'idle'
}

function explode(reason) {
  stopClock()
  cancelSpeech()
  msLeft.value = 0
  failure.value = REASONS[reason] ?? 'Boom.'
  phase.value = 'boom'
  showText.value = true
  showGloss.value = true
  best.value = Math.max(best.value, round.value - 1)
  playFeedback(false)
}

function defuse() {
  stopClock()
  cancelSpeech()
  phase.value = 'defused'
  best.value = Math.max(best.value, round.value)
  playCelebration()
  advance = setTimeout(() => {
    round.value += 1
    arm()
  }, DEFUSED_MS)
}

function cutWire(w) {
  if (phase.value !== 'armed' || !plan.value) return
  const outcome = cutOutcome(plan.value, bomb.value.wires, cut.value, w.id)
  if (outcome.reason === 'already-cut') return
  if (!outcome.ok) {
    cut.value = [...cut.value, w.id]
    explode(outcome.reason)
    return
  }
  cut.value = [...cut.value, w.id]
  if (isDefused(plan.value, bomb.value.wires, cut.value)) defuse()
  else playFeedback(true)
}

const isCut = (w) => cut.value.includes(w.id)

/**
 * A wire's colours, drawn rather than named: the whole game is recognising
 * «кра́сный про́вод с си́ними поло́сками» on sight, so nothing on the bar may
 * say it in words. The English description goes to `aria-label` alone, where
 * it reaches a screen reader — which cannot see the colours — without handing
 * a sighted player the answer.
 */
function wireStyle(w) {
  const base = COLORS[w.color].hex
  const accent = w.accent ? COLORS[w.accent].hex : null
  if (w.pattern === 'striped') {
    return { background: `repeating-linear-gradient(115deg, ${base} 0 15px, ${accent} 15px 26px)` }
  }
  if (w.pattern === 'spotted') {
    return {
      backgroundColor: base,
      backgroundImage: `radial-gradient(${accent} 30%, transparent 33%)`,
      backgroundSize: '22px 22px',
    }
  }
  return { background: base }
}

onMounted(() => {
  loadSettings()
})

onUnmounted(() => {
  stopClock()
  cancelSpeech()
})
</script>

<template>
  <section v-if="phase === 'idle'" class="grid">
    <h2 style="margin: 0">Bomb disposal 💣</h2>
    <p class="muted" style="margin: 0">
      An instruction in Russian, a bomb, and a clock. Cut the wires it names, in the order it
      names them. The colours get less common, the instructions get longer and the reading
      speeds up as you go — «все провода́, кро́ме чёрного», then «е́сли нет ора́нжевого
      про́вода…».
    </p>
    <p v-if="!speechSupported()" class="muted" style="margin: 0">
      This browser has no speech synthesis, so the instruction will be shown in writing instead.
    </p>
    <div class="row">
      <button class="primary" @click="start">Start</button>
    </div>
    <p v-if="best" class="muted" style="margin: 0">Best run: {{ best }} defused</p>
  </section>

  <section v-else class="grid bomb" style="gap: 1rem; position: relative">
    <CelebrationBurst :show="phase === 'defused'" />

    <div class="row" style="justify-content: space-between">
      <span class="pill">Round {{ round }} · level {{ bomb.level }}</span>
      <span class="muted">{{ remaining }} to cut · best {{ best }}</span>
    </div>

    <div class="wires" :class="{ dead: phase === 'boom' }">
      <button
        v-for="w in bomb.wires"
        :key="w.id"
        type="button"
        class="wire"
        :class="{ cut: isCut(w) }"
        :disabled="phase !== 'armed'"
        :aria-label="wireLabelEn(w)"
        @click="cutWire(w)"
      >
        <span class="lug" />
        <span class="core left" :style="wireStyle(w)" />
        <span class="core right" :style="wireStyle(w)" />
        <span class="lug" />
      </button>
    </div>

    <div class="clock" :class="{ urgent, stopped: phase !== 'armed' }">
      <div class="fuse" :style="{ width: `${timeFraction * 100}%` }" />
      <span class="digits">{{ secondsLeft.toFixed(1) }}s</span>
    </div>

    <div class="row" style="gap: 0.5rem; flex-wrap: wrap">
      <button :disabled="!speechSupported()" @click="say()">🔊 Again</button>
      <button :disabled="!speechSupported()" @click="say(SLOW_RATE)">🐢 Slower</button>
      <button v-if="!showText" @click="showText = true">👁 Show it in writing</button>
      <button v-else-if="!showGloss" @click="showGloss = true">🇬🇧 Translate</button>
    </div>

    <p v-if="showText" lang="ru" class="instruction">{{ bomb.ru }}</p>
    <p v-if="showGloss" class="muted" style="margin: 0">{{ bomb.en }}</p>
    <p v-if="!canHear && phase === 'armed'" class="muted" style="margin: 0">
      No Russian voice is installed, so the instruction is written out rather than spoken.
    </p>

    <template v-if="phase === 'boom'">
      <p class="feedback bad" style="margin: 0">💥 {{ failure }}</p>
      <div class="row">
        <button class="primary" @click="start">Again</button>
        <button @click="stop">Stop</button>
      </div>
    </template>
    <p v-else-if="phase === 'defused'" class="feedback good" style="margin: 0">✓ Defused</p>
    <button v-else style="justify-self: start" @click="stop">Stop</button>
  </section>
</template>

<style scoped>
.wires {
  display: grid;
  gap: 0.6rem;
  padding: 0.75rem 0;
}

.wire {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  /* The bar is the hit target; keep it thumb-sized on a phone. */
  min-height: 2.75rem;
}

.wire:disabled {
  cursor: default;
}

.core {
  flex: 1;
  height: 1.6rem;
  /* The cut opens a gap between the two halves rather than fading the wire —
     a snip you can see at a glance, which matters when the clock is running. */
  transition: margin 180ms ease-out;
  box-shadow: inset 0 -3px 6px rgb(0 0 0 / 25%);
}

/* Named rather than positional: `:first-of-type` counts SPANS, and the first
   and last spans in a wire are its lugs, so those selectors matched no core. */
.core.left {
  border-radius: 3px 0 0 3px;
}

.core.right {
  border-radius: 0 3px 3px 0;
}

.wire.cut .core.left {
  margin-right: 1.25rem;
}

.wire.cut .core.right {
  margin-left: 1.25rem;
}

.wire.cut {
  opacity: 0.55;
}

.lug {
  width: 0.8rem;
  height: 2.1rem;
  border-radius: 3px;
  background: #6b7280;
  box-shadow: inset 0 -3px 5px rgb(0 0 0 / 30%);
}

.wires.dead {
  filter: grayscale(0.7);
}

.clock {
  position: relative;
  height: 1.6rem;
  border-radius: 999px;
  overflow: hidden;
  background: rgb(127 127 127 / 25%);
}

.fuse {
  height: 100%;
  background: #2e9e4f;
  transition: width 100ms linear;
}

.clock.urgent .fuse {
  background: #d92b2b;
}

.clock.stopped .fuse {
  transition: none;
}

.digits {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
}

.instruction {
  margin: 0;
  font-size: 1.15rem;
}

@media (prefers-reduced-motion: reduce) {
  .core,
  .fuse {
    transition: none;
  }
}
</style>
