<script setup>
import { computed, reactive, ref, onUnmounted } from 'vue'
import { phrases, state } from '../stores/vocab.js'
import { sample } from '../lib/quiz.js'
import { bankTokens, buildListeningBank, listeningTokens, listeningWordPool, phraseCorrect } from '../lib/phrases.js'
import { speak, speechSupported, SLOW_RATE } from '../lib/speech.js'
import { makeVisualReplacement } from '../lib/exerciseBuild.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'
import HintablePhrase from '../components/HintablePhrase.vue'
import SpeakButton from '../components/SpeakButton.vue'
import WordBankExercise from '../components/exercises/WordBankExercise.vue'

// How long the celebration plays before auto-advancing to the next phrase.
const CELEBRATE_MS = 1000
// A few random decoys are mixed into the word bank alongside the real words.
const DECOYS = 3

const ready = computed(() => phrases.value.length > 0)
const canSpeak = speechSupported()

const started = ref(false)
const score = reactive({ right: 0, total: 0 })

const current = ref(null)
const bank = ref([])
const placed = ref([])
const answered = ref(false)
const wasCorrect = ref(false)
const celebrating = ref(false)
let advanceTimer = null
let visSeq = 0
const visualExercise = ref(null)

// Decoy candidates are the same for every question, so cache them and only
// recompute when the phrase list itself changes.
const decoyPool = computed(() => listeningWordPool(phrases.value))

const placedIds = computed(() => new Set(placed.value.map((t) => t.id)))
const pool = computed(() => bank.value.filter((t) => !placedIds.value.has(t.id)))

function replay() {
  if (current.value) speak(current.value.ru)
}

function replaySlow() {
  if (current.value) speak(current.value.ru, 'ru-RU', SLOW_RATE)
}

function start() {
  started.value = true
  score.right = 0
  score.total = 0
  nextQuestion()
}

function nextQuestion() {
  clearTimeout(advanceTimer)
  celebrating.value = false
  answered.value = false
  wasCorrect.value = false
  placed.value = []
  current.value = sample(phrases.value, 1)[0]
  // Tiles come from the primary translation *and* its accepted alternates, so
  // an answer check() will grade as correct can actually be assembled (#581).
  // Extra tiles from an alternate are themselves distractors for the primary
  // reading, so they come out of the decoy budget rather than on top of it —
  // otherwise a phrase with alternates faces a much bigger bank than one
  // without. Mirrors WordBankExercise.
  const alts = current.value?.enAlt ?? []
  const extra = alts.length
    ? bankTokens(current.value?.en ?? '', alts).length - listeningTokens(current.value?.en ?? '').length
    : 0
  bank.value = buildListeningBank(current.value?.en ?? '', decoyPool.value, Math.max(0, DECOYS - extra), Math.random, {
    alts,
  })
  replay() // read the phrase aloud as soon as it appears
}

function place(tile) {
  if (answered.value) return
  placed.value = [...placed.value, tile]
}

function remove(tile) {
  if (answered.value) return
  placed.value = placed.value.filter((t) => t.id !== tile.id)
}

function clear() {
  if (!answered.value) placed.value = []
}

function record(correct) {
  if (answered.value) return
  answered.value = true
  wasCorrect.value = correct
  score.total += 1
  if (correct) {
    score.right += 1
    // Celebrate, then move straight to the next phrase.
    celebrating.value = true
    advanceTimer = setTimeout(nextQuestion, CELEBRATE_MS)
  }
}

function check() {
  if (answered.value || !placed.value.length) return
  // The primary translation or any curated alternate — the same accepted set
  // the word-bank exercise uses.
  const accepted = [current.value.en, ...(current.value.enAlt ?? [])]
  record(phraseCorrect(placed.value.map((t) => t.text).join(' '), accepted))
}

function skipToVisual() {
  const phrase = current.value
  if (!phrase) { nextQuestion(); return }
  const rep = makeVisualReplacement(
    {
      ru: phrase.ru,
      en: phrase.en,
      // `makeVisualReplacement` carries enAlt through when it is given, and the
      // replacement is the same phrase — so omitting it silently dropped the
      // learner back to primary-only tiles and grading after a Skip.
      enAlt: phrase.enAlt ?? [],
      content: 'phrase',
      targets: phrase.source ? [phrase.source] : [],
    },
    visSeq++,
  )
  if (!rep) { nextQuestion(); return }
  clearTimeout(advanceTimer)
  celebrating.value = false
  answered.value = false
  visualExercise.value = rep
}

function onVisualDone({ correct }) {
  score.total += 1
  if (correct) score.right += 1
  visualExercise.value = null
  nextQuestion()
}

function quit() {
  clearTimeout(advanceTimer)
  celebrating.value = false
  started.value = false
  current.value = null
  placed.value = []
  bank.value = []
  visualExercise.value = null
}

onUnmounted(() => clearTimeout(advanceTimer))
</script>

<template>
  <section v-if="!started" class="grid">
    <h2 style="margin: 0">Listening</h2>
    <p class="muted" style="margin: 0">
      Listen to a Russian phrase, then tap the English words in order to build the
      translation. A few decoy words are mixed in.
    </p>
    <p v-if="!canSpeak" class="feedback bad">
      Your browser can't read text aloud, so the Russian will be shown as text instead.
    </p>
    <p v-if="!ready && state.status === 'loading'" class="muted">Loading phrases…</p>
    <p v-else-if="!ready" class="feedback bad">
      No phrases available offline yet — connect once to download them.
    </p>
    <button class="primary start" :disabled="!ready" @click="start">
      Start listening
    </button>
  </section>

  <section v-else class="grid" style="gap: 1.25rem; position: relative">
    <CelebrationBurst :show="celebrating" />
    <div class="row" style="justify-content: space-between">
      <span class="pill">Listening</span>
      <span class="muted">Score: {{ score.right }} / {{ score.total }}</span>
    </div>

    <!-- Visual replacement exercise shown after skipping a phrase -->
    <template v-if="visualExercise">
      <p class="muted" style="margin: 0; font-size: 0.85rem">Skipped — now translate it visually</p>
      <WordBankExercise :key="visualExercise.id" :exercise="visualExercise" @done="onVisualDone" />
      <button style="justify-self: start" @click="quit">Stop</button>
    </template>

    <template v-else>
      <div class="card" style="text-align: center">
        <div class="muted">Listen</div>
        <div class="replay-row">
          <button class="primary replay" :disabled="!canSpeak" @click="replay">
            🔊 Play phrase
          </button>
          <button class="replay" :disabled="!canSpeak" @click="replaySlow">🐢 Slow</button>
        </div>
        <!-- Without speech the drill degrades to translating the shown text. -->
        <HintablePhrase v-if="!canSpeak" :text="current.ru" class="ru" />
      </div>

      <!-- Answer line: the words placed so far (tap to send one back). -->
      <div class="answer-line" lang="en">
        <button
          v-for="tile in placed"
          :key="tile.id"
          class="tile placed"
          :disabled="answered"
          @click="remove(tile)"
        >
          {{ tile.text }}
        </button>
        <span v-if="!placed.length" class="muted">Tap the words below…</span>
      </div>

      <!-- Word bank: real words plus decoys, shuffled together. -->
      <div class="bank row" style="flex-wrap: wrap" lang="en">
        <button
          v-for="tile in pool"
          :key="tile.id"
          class="tile"
          :disabled="answered"
          @click="place(tile)"
        >
          {{ tile.text }}
        </button>
      </div>

      <div v-if="answered" class="grid">
        <p class="feedback" :class="wasCorrect ? 'good' : 'bad'">
          {{ wasCorrect ? '✓ Correct!' : '✗ Answer: ' + current.en }}
        </p>
        <div class="muted" style="display: flex; align-items: center; gap: 0.4rem; margin: 0">
          <HintablePhrase :text="current.ru" />
          <SpeakButton :text="current.ru" />
        </div>
        <!-- Correct answers advance on their own; only wrong answers wait. -->
        <div v-if="!wasCorrect" class="row">
          <button class="primary" @click="nextQuestion">Next →</button>
          <button @click="quit">Stop</button>
        </div>
      </div>
      <div v-else class="row">
        <button class="primary check" :disabled="!placed.length" @click="check">
          Check
        </button>
        <button :disabled="!placed.length" @click="clear">Clear</button>
        <button @click="skipToVisual">Skip</button>
        <button style="margin-left: auto" @click="quit">Stop</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.tile {
  padding: 0.5rem 0.8rem;
  font-size: 1.05rem;
}

.tile.placed {
  border-color: var(--primary);
  background: rgba(79, 125, 255, 0.18);
}

.answer-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  min-height: 2.6rem;
  padding: 0.5rem 0.6rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
}

.replay-row {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  margin-top: 0.5rem;
}

.replay {
  font-size: 1.1rem;
}

.ru {
  font-size: 1.4rem;
  margin: 0.75rem 0 0;
}
</style>
