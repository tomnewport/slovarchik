<script setup>
// Flashcard identification drill (replaces the old two-column matching board,
// #412). One card at a time: a big Russian word — or, in hearing mode, a speaker
// to tap — and the learner produces its English. They type into a combo box
// seeded with the answer plus a large pile of decoy words, or switch to speaking
// it aloud. The combo box helps quietly: every correct letter typed prunes a
// random tenth of the surviving decoys, so the answer surfaces the closer they
// get — but nothing ever announces that a letter was right. A correct answer
// advances at once; a Pass button fails the card and moves on. The set runs
// through every card the descriptor carries (12, from the practice catalogue).
//
// Reports like the matching board did: `wrong` lists the keys that were passed
// or first guessed wrong, so only those record an incorrect attempt.
import { computed, onBeforeUnmount, ref } from 'vue'

import { shuffle } from '../../lib/quiz.js'
import { phraseCorrect, typingSequence } from '../../lib/phrases.js'
import { speak } from '../../lib/speech.js'
import { gradeSpoken, listen, recognitionSupported } from '../../lib/recognition.js'
import { vocab } from '../../stores/vocab.js'
import { playFeedback } from '../../stores/settings.js'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

// The combo box starts stuffed with up to this many decoys, so the answer is a
// needle in a haystack until the learner types toward it.
const DECOY_TARGET = 999
// Fraction of the *remaining* decoys pruned for each new correct letter typed.
const PRUNE_FRACTION = 0.1
// The dropdown can't render a thousand options — show at most this many at once.
const DISPLAY_LIMIT = 40
// Spoken answers grade on letter overlap, so a mangled article still counts.
const SPEAK_THRESHOLD = 0.75
// How long a wrong guess flashes before the card settles back to neutral.
const FLASH_MS = 700

// Generic English fillers so the combo box still has decoys when the vocab store
// is empty (unit tests). Production draws hundreds of real glosses instead.
const FILLERS = [
  'window', 'table', 'winter', 'summer', 'brother', 'sister', 'water', 'bread',
  'street', 'house', 'friend', 'evening', 'morning', 'country', 'city', 'letter',
  'garden', 'school', 'number', 'weather', 'mother', 'father', 'daughter', 'son',
  'teacher', 'student', 'question', 'answer', 'picture', 'colour', 'animal', 'flower',
]

const cards = computed(() => props.exercise.pairs ?? [])
const idx = ref(0)
const card = computed(() => cards.value[idx.value] ?? null)
const total = computed(() => cards.value.length)

// Keys the learner failed this exercise (passed, or guessed wrong before landing
// on the answer). Deduplicated — reported back so only these record a miss.
const missed = new Set()

const canSpeak = recognitionSupported()

// --- English matching helpers ----------------------------------------------

function enOf(v) {
  const en = v?.en
  return Array.isArray(en) ? (en[0] ?? '') : (en ?? '')
}
const answer = computed(() => enOf(card.value))

// The answer as it types out — full, and with a leading article stripped — so
// "window" earns the same letter credit as "the window".
const answerSeqs = computed(() => {
  const full = typingSequence(answer.value)
  const bare = full.replace(/\b(a|an|the)\b\s*/g, '').replace(/\s+/g, ' ').trim()
  return bare && bare !== full ? [full, bare] : [full]
})

// How many leading letters of the typed text march correctly toward the answer
// (down whichever of the article variants gets furthest).
function correctPrefixLen(text) {
  const nt = typingSequence(text)
  let best = 0
  for (const seq of answerSeqs.value) {
    let i = 0
    while (i < nt.length && i < seq.length && nt[i] === seq[i]) i += 1
    if (i > best) best = i
  }
  return best
}

// A typed / selected candidate is right when it matches the gloss bar case,
// punctuation, stress and articles.
function isAnswer(text) {
  return phraseCorrect(text, [answer.value])
}
// A spoken answer is graded more forgivingly — letter overlap, like the speaking
// drill — so a slightly mis-heard word still counts.
function isSpokenAnswer(guesses) {
  const list = Array.isArray(guesses) ? guesses : [guesses]
  if (list.some((g) => phraseCorrect(g, [answer.value]))) return true
  return gradeSpoken(list, answer.value, SPEAK_THRESHOLD).correct
}

// --- Decoy pool -------------------------------------------------------------

// Every distinct English gloss in the vocabulary, so the decoys read like real
// words rather than filler. Built once; the answer for each card is excluded
// when the card's own pile is drawn.
const decoySource = (() => {
  const seen = new Set()
  const out = []
  const add = (en) => {
    const text = String(en ?? '').trim()
    const k = text.toLowerCase()
    if (text && !seen.has(k)) {
      seen.add(k)
      out.push(text)
    }
  }
  for (const v of vocab.value) add(enOf(v))
  for (const f of FILLERS) add(f)
  return out
})()

// --- Per-card state ---------------------------------------------------------

const typed = ref('')
const decoys = ref([]) // surviving decoy words for the current card
let prunedFor = 0 // longest correct prefix already pruned against (never re-prunes)
const wrongThisCard = ref(false)
const flash = ref(false)
const heard = ref('') // last spoken transcript
const listening = ref(false)
let flashTimer = null
let recCtl = null

function startCard() {
  typed.value = ''
  prunedFor = 0
  wrongThisCard.value = false
  flash.value = false
  heard.value = ''
  const others = decoySource.filter((w) => w.toLowerCase() !== answer.value.toLowerCase())
  decoys.value = shuffle(others).slice(0, DECOY_TARGET)
  // In hearing mode the card is heard, not seen — read it out as it appears.
  if (props.exercise.audio && card.value) speak(card.value.ru)
}

// Candidates shown in the combo box: the answer plus surviving decoys, filtered
// to those containing what's typed, sorted for browsability, capped for the DOM.
// The answer is always kept in view when it still matches the filter, so it can
// be found once the pile is small — never floated to the top, which would give
// it away.
const candidates = computed(() => {
  const q = typingSequence(typed.value)
  const matches = (w) => !q || typingSequence(w).includes(q)
  const pool = [...new Set([answer.value, ...decoys.value])].filter(matches)
  pool.sort((a, b) => a.localeCompare(b))
  const window = pool.slice(0, DISPLAY_LIMIT)
  if (matches(answer.value) && !window.includes(answer.value) && window.length) {
    window[window.length - 1] = answer.value
    window.sort((a, b) => a.localeCompare(b))
  }
  return window
})

function onType() {
  // Prune a slice of decoys for every newly-reached correct-prefix letter.
  const reached = correctPrefixLen(typed.value)
  while (prunedFor < reached && decoys.value.length) {
    const remove = Math.max(1, Math.floor(decoys.value.length * PRUNE_FRACTION))
    decoys.value = shuffle(decoys.value).slice(remove)
    prunedFor += 1
  }
  // Typing the whole word right advances straight away.
  if (isAnswer(typed.value)) succeed()
}

function pickCandidate(word) {
  if (!card.value) return
  if (isAnswer(word)) succeed()
  else registerWrong()
}

// A wrong guess flags the card as missed but leaves it open — the learner can
// keep hunting for the right word, or pass.
function registerWrong() {
  if (!card.value) return
  wrongThisCard.value = true
  missed.add(card.value.key)
  playFeedback(false)
  flash.value = true
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = false), FLASH_MS)
}

function succeed() {
  stopMic()
  // A clean first-time answer chimes; one reached after a wrong guess doesn't
  // (it's already counted as a miss).
  playFeedback(!wrongThisCard.value)
  advance()
}

function pass() {
  if (!card.value) return
  stopMic()
  missed.add(card.value.key)
  playFeedback(false)
  advance()
}

function advance() {
  if (idx.value >= total.value - 1) {
    emit('done', { correct: missed.size === 0, wrong: [...missed] })
    return
  }
  idx.value += 1
  startCard()
}

// --- Speaking ---------------------------------------------------------------

function startMic() {
  if (!canSpeak || listening.value) return
  heard.value = ''
  listening.value = true
  recCtl = listen({
    lang: 'en-GB',
    onResult: ({ transcript }) => {
      heard.value = transcript
    },
    onEnd: (finalText, alternatives) => {
      recCtl = null
      listening.value = false
      if (!finalText) return
      heard.value = finalText
      if (isSpokenAnswer([finalText, ...alternatives])) succeed()
      else registerWrong()
    },
    onError: () => {
      listening.value = false
    },
  })
}

function stopMic() {
  listening.value = false
  if (recCtl) {
    recCtl.abort()
    recCtl = null
  }
}

// Draw the first card's pile up front (not in onMounted) so the combo box is
// populated on the very first render.
startCard()
onBeforeUnmount(() => {
  clearTimeout(flashTimer)
  stopMic()
})
</script>

<template>
  <div class="grid flashcard" style="gap: 1rem">
    <p class="count muted">Card {{ idx + 1 }} of {{ total }}</p>

    <!-- Prompt: heard in hearing mode, shown otherwise. -->
    <div class="cue">
      <template v-if="exercise.audio">
        <span class="big-speak"><SpeakButton :text="card.ru" /></span>
        <span class="muted hint">Tap to hear it</span>
      </template>
      <template v-else>
        <span lang="ru" class="ru">{{ card.ru }}</span>
        <SpeakButton :text="card.ru" />
      </template>
    </div>

    <label class="visually-hidden" :for="'fc-' + idx">Type the English</label>
    <input
      :id="'fc-' + idx"
      v-model="typed"
      type="text"
      class="combo-input"
      :class="{ flash }"
      placeholder="Type the English…"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      @input="onType"
    />

    <p v-if="flash" class="miss muted">Not that one — keep trying, or pass.</p>

    <!-- The combo box: pick the word from the (shrinking) list of candidates. -->
    <ul class="options" role="listbox">
      <li v-for="word in candidates" :key="word">
        <button type="button" class="option" @click="pickCandidate(word)">{{ word }}</button>
      </li>
    </ul>

    <!-- Answer by voice instead of typing. -->
    <div v-if="canSpeak" class="speak-row">
      <button v-if="!listening" type="button" class="speak-toggle" @click="startMic">
        🎤 Speak instead
      </button>
      <template v-else>
        <span class="listening">🎤 Listening…</span>
        <button type="button" class="speak-stop" @click="stopMic">Stop</button>
      </template>
      <span v-if="heard" class="heard muted">Heard: "{{ heard }}"</span>
    </div>

    <div class="row">
      <button type="button" class="pass" @click="pass">Pass →</button>
    </div>
  </div>
</template>

<style scoped>
.count {
  margin: 0;
  font-size: 0.85rem;
}
.cue {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  min-height: 3rem;
  text-align: center;
}
.ru {
  font-size: 2.2rem;
  font-weight: 600;
}
.big-speak {
  font-size: 2rem;
}
.hint {
  font-size: 0.9rem;
}
.combo-input {
  width: 100%;
  padding: 0.6rem 0.7rem;
  font-size: 1.15rem;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
}
.combo-input.flash {
  border-color: var(--bad);
  background: color-mix(in srgb, var(--bad) 12%, var(--card));
}
.miss {
  margin: 0;
  font-size: 0.85rem;
  color: var(--bad);
}
.options {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  max-height: 14rem;
  overflow-y: auto;
}
.option {
  padding: 0.45rem 0.7rem;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
  font-size: 1.02rem;
}
.option:hover {
  border-color: var(--primary);
}
.speak-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}
.speak-toggle,
.speak-stop {
  font-size: 0.95rem;
  padding: 0.4rem 0.7rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
}
.listening {
  font-size: 1rem;
  animation: pulse 1.2s ease-in-out infinite;
}
.heard {
  font-style: italic;
  font-size: 0.9rem;
}
.pass {
  font-size: 0.9rem;
  color: var(--muted);
  background: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.4rem 0.8rem;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@keyframes pulse {
  50% {
    opacity: 0.45;
  }
}
@media (prefers-reduced-motion: reduce) {
  .listening {
    animation: none;
  }
}
</style>
