<script setup>
// Celebration Emporium minigame (#727). Customers ask, in Russian, for a cake
// for somebody's age or for a year; the player hands one over from the
// cabinet, or dials it on the intercom and waits for the kitchen.
//
// What a customer says, what a cake is and whether it suits them live in
// src/lib/celebrationEmporium.js; this view owns the clocks, the voice and the
// taps, and nothing else.
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  BAKE_MS,
  SLOTS,
  arrivalGap,
  isFull,
  makeCake,
  nextCustomer,
  openingCabinet,
  orderKind,
  suits,
} from '../lib/celebrationEmporium.js'
import { cancelSpeech, speak, speechSupported, voiceAvailable } from '../lib/speech.js'
import { loadSettings, playFeedback } from '../stores/settings.js'

// The clocks are read every tick; 100ms keeps the bake bars smooth.
const TICK_MS = 100
// The longest number the intercom takes: a year.
const MAX_DIGITS = 4

const phase = ref('idle') // idle | open | closed
const cabinet = ref([]) // SLOTS entries, each a cake or null
const waiting = ref([]) // customers, in the order they came in
const orders = ref([]) // cakes on order: { id, value, readyAt }
const selected = ref(null) // id of the cake in hand
const dial = ref('')
const refusal = ref('')
const served = ref(0)
const binned = ref(0)
const best = ref(0)
const now = ref(Date.now())

let ticker = null
let arrived = 0
let nextArrival = 0
let cakeIds = 0
let canSpeak = false

const customerSlots = computed(() =>
  Array.from({ length: SLOTS }, (_, i) => waiting.value[i] ?? null),
)
const heldCake = computed(() => cabinet.value.find((c) => c?.id === selected.value) ?? null)

function stopClock() {
  clearInterval(ticker)
  ticker = null
}

function say(customer) {
  if (customer?.spoken) speak(customer.ru, 'ru-RU')
}

function open() {
  stopClock()
  cancelSpeech()
  canSpeak = voiceAvailable('ru-RU')
  cabinet.value = openingCabinet()
  cakeIds = SLOTS
  waiting.value = []
  orders.value = []
  selected.value = null
  dial.value = ''
  refusal.value = ''
  served.value = 0
  binned.value = 0
  arrived = 0
  now.value = Date.now()
  nextArrival = now.value
  phase.value = 'open'
  ticker = setInterval(tick, TICK_MS)
  tick()
}

/** Leave the game; the clock and the voice go with it. */
function stop() {
  stopClock()
  cancelSpeech()
  phase.value = 'idle'
}

function close() {
  stopClock()
  best.value = Math.max(best.value, served.value)
  phase.value = 'closed'
  playFeedback(false)
}

function tick() {
  now.value = Date.now()
  // The kitchen: a finished cake goes onto the first free shelf, and waits at
  // the hatch when there is none.
  const head = orders.value[0]
  if (head && head.readyAt <= now.value) {
    const slot = cabinet.value.findIndex((c) => !c)
    if (slot >= 0) {
      const shelves = [...cabinet.value]
      shelves[slot] = makeCake(head.value, `cake-${cakeIds++}`)
      cabinet.value = shelves
      orders.value = orders.value.slice(1)
    }
  }
  // The door.
  if (now.value >= nextArrival) {
    const customer = nextCustomer({
      arrived,
      cabinet: cabinet.value.filter(Boolean),
      waiting: waiting.value,
      canSpeak,
    })
    arrived += 1
    nextArrival = now.value + arrivalGap(arrived)
    waiting.value = [...waiting.value, customer]
    say(customer)
    if (isFull(waiting.value)) close()
  }
}

function pickCake(cake) {
  if (phase.value !== 'open' || !cake) return
  selected.value = selected.value === cake.id ? null : cake.id
}

function tapCustomer(customer) {
  if (phase.value !== 'open' || !customer) return
  const cake = heldCake.value
  // Nothing in hand: hear them again.
  if (!cake) return say(customer)
  cabinet.value = cabinet.value.map((c) => (c?.id === cake.id ? null : c))
  selected.value = null
  if (suits(cake, customer)) {
    waiting.value = waiting.value.filter((c) => c.id !== customer.id)
    served.value += 1
    playFeedback(true)
  } else {
    binned.value += 1
    playFeedback(false)
  }
}

function press(digit) {
  refusal.value = ''
  if (dial.value.length < MAX_DIGITS) dial.value += digit
}

function backspace() {
  refusal.value = ''
  dial.value = dial.value.slice(0, -1)
}

function order() {
  const value = Number(dial.value)
  if (!dial.value || !orderKind(value)) {
    refusal.value = `No cake for ${dial.value}: we bake ages 1–120 and years 1800–2099.`
    dial.value = ''
    return
  }
  const lastReady = orders.value.at(-1)?.readyAt ?? 0
  orders.value = [...orders.value, { id: `order-${cakeIds++}`, value, readyAt: Math.max(now.value, lastReady) + BAKE_MS }]
  dial.value = ''
  refusal.value = ''
}

/** How far through baking an order is, 0–1; the ones behind it wait at 0. */
function progress(o) {
  return Math.min(1, Math.max(0, 1 - (o.readyAt - now.value) / BAKE_MS))
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
    <h2 style="margin: 0">Celebration Emporium 🎂</h2>
    <p class="muted" style="margin: 0">
      Customers want a cake for somebody's age — «Моему́ бра́ту девятна́дцать лет» — or for a
      year — «Мне ну́жен ты́сяча девятьсо́т два́дцать шесто́й год». Tap a cake, then the customer,
      to hand it over; the wrong cake goes in the bin. Dial a number on the intercom to have a new
      one baked. They come faster and faster: if nine are left waiting, the shop is full and the
      day is over.
    </p>
    <p v-if="!speechSupported()" class="muted" style="margin: 0">
      This browser has no speech synthesis, so every customer will write their order down.
    </p>
    <div class="row">
      <button class="primary" @click="open">Open the shop</button>
    </div>
    <p v-if="best" class="muted" style="margin: 0">Best day: {{ best }} served</p>
  </section>

  <section v-else class="grid emporium" style="gap: 0.9rem">
    <div class="row" style="justify-content: space-between">
      <span class="pill">Served {{ served }}</span>
      <span class="muted">🗑 {{ binned }} · {{ waiting.length }}/{{ SLOTS }} waiting</span>
    </div>

    <div class="board customers" aria-label="Customers">
      <button
        v-for="(c, i) in customerSlots"
        :key="c?.id ?? `empty-customer-${i}`"
        type="button"
        class="cell customer"
        :class="{ empty: !c, ready: c && heldCake }"
        :disabled="!c || phase !== 'open'"
        :aria-label="c ? (c.spoken ? 'Customer: tap to hear the order again' : `Customer: ${c.ru}`) : 'Empty place'"
        @click="tapCustomer(c)"
      >
        <template v-if="c">
          <span class="face" aria-hidden="true">{{ c.face }}</span>
          <span v-if="c.spoken" class="bubble" aria-hidden="true">🔊</span>
          <span v-else class="bubble written" lang="ru">{{ c.ru }}</span>
        </template>
      </button>
    </div>

    <div class="board cabinet" aria-label="Cake cabinet">
      <button
        v-for="(cake, i) in cabinet"
        :key="cake?.id ?? `empty-shelf-${i}`"
        type="button"
        class="cell cake"
        :class="{ empty: !cake, held: cake && cake.id === selected, year: cake?.kind === 'year' }"
        :disabled="!cake || phase !== 'open'"
        :aria-pressed="cake ? cake.id === selected : undefined"
        :aria-label="cake ? `Cake tagged ${cake.value}` : 'Empty shelf'"
        @click="pickCake(cake)"
      >
        <template v-if="cake">
          <span class="cake-icon" aria-hidden="true">🎂</span>
          <span class="tag">{{ cake.value }}</span>
        </template>
      </button>
    </div>

    <div class="intercom">
      <div class="display" aria-live="polite">
        <span class="dialled">{{ dial || '—' }}</span>
        <span v-if="refusal" class="refusal">{{ refusal }}</span>
      </div>
      <div class="keypad" role="group" aria-label="Intercom keypad">
        <button v-for="d in ['1', '2', '3', '4', '5', '6', '7', '8', '9']" :key="d" type="button" :disabled="phase !== 'open'" @click="press(d)">{{ d }}</button>
        <button type="button" aria-label="Delete a digit" :disabled="phase !== 'open'" @click="backspace">⌫</button>
        <button type="button" :disabled="phase !== 'open'" @click="press('0')">0</button>
        <button type="button" class="primary" aria-label="Order this cake" :disabled="phase !== 'open' || !dial" @click="order">📞</button>
      </div>
      <ul v-if="orders.length" class="orders" aria-label="Cakes on order">
        <li v-for="o in orders" :key="o.id">
          <span class="tag">{{ o.value }}</span>
          <span class="bake"><span :style="{ width: `${progress(o) * 100}%` }" /></span>
        </li>
      </ul>
    </div>

    <template v-if="phase === 'closed'">
      <p class="feedback bad" style="margin: 0">The shop is full — nine customers waiting. {{ served }} served today.</p>
      <div class="row">
        <button class="primary" @click="open">Open again</button>
        <button @click="stop">Stop</button>
      </div>
    </template>
    <button v-else style="justify-self: start" @click="stop">Stop</button>
  </section>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
}

.cell {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 0.2rem;
  min-height: 4.6rem;
  padding: 0.35rem;
  border: 1px solid rgb(127 127 127 / 30%);
  border-radius: 0.6rem;
  background: rgb(127 127 127 / 8%);
  color: inherit;
  cursor: pointer;
}

.cell.empty {
  border-style: dashed;
  background: none;
  cursor: default;
}

.face,
.cake-icon {
  font-size: 1.6rem;
  line-height: 1;
}

.bubble {
  font-size: 0.95rem;
}

/* A written order has to fit a third of a phone's width. */
.bubble.written {
  font-size: 0.68rem;
  line-height: 1.25;
  text-align: center;
  overflow-wrap: anywhere;
}

.customer.ready {
  border-color: var(--primary, #4f7dff);
}

.cake.held {
  outline: 3px solid var(--primary, #4f7dff);
  outline-offset: -2px;
}

.tag {
  padding: 0.05rem 0.4rem;
  border-radius: 0.3rem;
  background: #fff3c4;
  color: #3b2f00;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.cake.year .tag {
  background: #d9ecff;
  color: #0b2a4a;
}

.intercom {
  display: grid;
  gap: 0.5rem;
}

.display {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  min-height: 2rem;
}

.dialled {
  font-size: 1.4rem;
  font-variant-numeric: tabular-nums;
}

.refusal {
  color: #d92b2b;
  font-size: 0.8rem;
}

.keypad {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
  max-width: 18rem;
}

.keypad button {
  min-height: 2.6rem;
  font-size: 1.1rem;
}

.orders {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.orders li {
  display: grid;
  gap: 0.2rem;
  justify-items: center;
}

.bake {
  display: block;
  width: 3rem;
  height: 0.35rem;
  border-radius: 999px;
  overflow: hidden;
  background: rgb(127 127 127 / 25%);
}

.bake span {
  display: block;
  height: 100%;
  background: #2e9e4f;
}
</style>
