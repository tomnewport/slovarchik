<script setup>
// Flashcard identification drill (#412). One card at a time: a big Russian word
// — or, in hearing mode, a speaker to tap — and the learner produces its
// English. They type it into a single always-focused input (so the on-screen
// keyboard never has to be dismissed between cards), or switch to speaking it
// aloud.
//
// The loop is deliberately fast: a correct answer advances the moment it's
// typed, no key press needed. A wrong guess — or a Pass — reveals the correct
// answer so the learner actually learns from the miss, then a single Enter (or
// the Next button) moves on.
//
// Unless the guess was a real gloss of a *related* word (#589). Told "to put on"
// for «одева́ться», the drill says that belongs to «надева́ть» and keeps the card
// open for another go, however many it takes — the mirror of the spelling
// direction (#588), sharing its diagnosis. Pass is still the escape hatch, and a
// guess we can't place reveals immediately, so the loop stays fast for a genuine
// blank. The card is counted missed on the first wrong guess either way.
//
// As the learner types, a short type-ahead list of candidate words appears and
// refines as the guess gets closer (#473): a known word can be tapped instead of
// typed in full, and two near-identical glosses (a *winter* hat vs a *brimmed*
// hat) can be told apart by picking the exact form. See lib/flashcardOptions.js.
//
// Reports like the matching board did: `wrong` lists the keys that were passed
// or guessed wrong, so only those record an incorrect attempt.
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

import { phraseCorrect } from '../../lib/phrases.js'
import { normalize } from '../../lib/text.js'
import { buildOptions } from '../../lib/flashcardOptions.js'
import { speak } from '../../lib/speech.js'
import { gradeSpoken, listen, recognitionSupported } from '../../lib/recognition.js'
import { playFeedback } from '../../stores/settings.js'
import { diagnoseEnglishAnswer } from '../../stores/hints.js'
import { correctionMessage } from '../../lib/confusables.js'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

// Spoken answers grade on letter overlap, so a mangled article still counts.
const SPEAK_THRESHOLD = 0.75

const cards = computed(() => props.exercise.pairs ?? [])
const idx = ref(0)
const card = computed(() => cards.value[idx.value] ?? null)
const total = computed(() => cards.value.length)

// Keys the learner failed this exercise (passed, or guessed wrong). Deduplicated
// — reported back so only these record a miss.
const missed = new Set()

const canSpeak = recognitionSupported()

// --- English matching helpers ----------------------------------------------

function enOf(v) {
  const en = v?.en
  return Array.isArray(en) ? (en[0] ?? '') : (en ?? '')
}
const answer = computed(() => enOf(card.value))
// The card's part of speech ("noun", "verb", …), shown as a small tag so the
// learner knows what kind of word they're being asked for (#503).
const pos = computed(() => card.value?.pos ?? '')
// The disambiguated label of the card's answer ("hat (winter)"), for grading a
// picked option: two words sharing a base gloss are told apart by their label.
const answerLabel = computed(() => card.value?.label ?? answer.value)

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

// --- Per-card state ---------------------------------------------------------

const typed = ref('')
// Once true, the correct answer is on screen (after a wrong guess or a pass) and
// the only thing left to do is move on.
const revealed = ref(false)
// The diagnosis of the latest placeable guess: {headline, detail, tier}, or null.
const correction = ref(null)
const heard = ref('') // last spoken transcript
const listening = ref(false)
let recCtl = null

const input = ref(null)

// Keep the single input focused across cards so the device keyboard stays up —
// the whole point of the redesign. Called after every transition.
function focusInput() {
  nextTick(() => input.value?.focus())
}

function startCard() {
  typed.value = ''
  revealed.value = false
  correction.value = null
  heard.value = ''
  // In hearing mode the card is heard, not seen — read it out as it appears.
  if (props.exercise.audio && card.value) speak(card.value.ru)
  focusInput()
}

// Type-ahead suggestions (#473, refined in #503): a substring shortlist that
// appears once the guess narrows the field; hidden once the answer is revealed
// or before anything is typed.
const options = computed(() => {
  if (revealed.value) return []
  const pool = props.exercise.options ?? []
  if (!pool.length) return []
  return buildOptions({ typed: typed.value, pool })
})

// Picking a suggestion answers the card with it. It is correct when it is the
// card's own word or shares its disambiguated label (a true synonym), so the two
// hats are told apart while маши́на/автомоби́ль both count as "car".
function pickOption(o) {
  if (revealed.value) return
  typed.value = o.label ?? o.en ?? ''
  const correct =
    o.key === card.value?.key || normalize(o.label ?? o.en ?? '') === normalize(answerLabel.value)
  if (correct) succeed()
  else miss(typed.value)
}

// Typing the whole word right advances straight away — no Enter needed.
function onType() {
  if (!revealed.value && isAnswer(typed.value)) succeed()
}

// Enter drives both phases: check a guess, or (once revealed) move on. Keeping
// everything on the return key means focus never leaves the input.
function onSubmit() {
  if (revealed.value) {
    advance()
    return
  }
  if (isAnswer(typed.value)) succeed()
  else miss(typed.value)
}

/**
 * A wrong guess. If we can say whose word they just described, say it and leave
 * the card open; otherwise reveal, as the drill always has. Either way the card
 * is counted missed the first time round.
 */
function miss(guess) {
  if (!card.value || revealed.value) return
  const verdict = diagnoseEnglishAnswer(guess, {
    targetKey: card.value.key,
    options: props.exercise.options,
  })
  if (!verdict) {
    reveal()
    return
  }
  correction.value = correctionMessage(verdict)
  missed.add(card.value.key)
  stopMic()
  // A synonym is a correct piece of knowledge in the wrong slot — no error sound.
  if (correction.value.tier !== 'synonym') playFeedback(false)
  typed.value = ''
  focusInput()
}

// Show the correct answer and count the card as missed. The learner reads it,
// then presses Enter / Next to continue.
function reveal() {
  if (!card.value || revealed.value) return
  revealed.value = true
  missed.add(card.value.key)
  stopMic()
  playFeedback(false)
  // Read the Russian aloud so the correct pronunciation lands with the answer —
  // especially valuable in hearing mode, where the word was never shown.
  speak(card.value.ru)
  focusInput()
}

function succeed() {
  stopMic()
  playFeedback(true)
  advance()
}

// Pass is just an explicit "I don't know" — reveal the answer like a wrong guess.
function pass() {
  reveal()
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
  if (!canSpeak || listening.value || revealed.value) return
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
      else reveal()
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

startCard()
onBeforeUnmount(() => {
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

    <!-- Part of speech: which kind of word the learner is being asked for. -->
    <p v-if="pos" class="pos muted">{{ pos }}</p>

    <label class="visually-hidden" for="fc-input">Type the English</label>
    <form @submit.prevent="onSubmit">
      <input
        id="fc-input"
        ref="input"
        v-model="typed"
        type="text"
        class="combo-input"
        :class="{ revealed }"
        :data-answer="answer"
        :readonly="revealed"
        placeholder="Type the English…"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        @input="onType"
      />
    </form>

    <!-- Whose word did they just describe? Shown instead of revealing, so the
         card stays open for another go. -->
    <p v-if="correction && !revealed" class="correction" :class="correction.tier">
      <strong class="correction-headline">{{ correction.headline }}</strong>
      <span class="correction-detail">{{ correction.detail }}</span>
    </p>

    <!-- Type-ahead suggestions: tap to answer without typing the whole word. -->
    <ul v-if="options.length" class="options" role="listbox" aria-label="Suggestions">
      <li v-for="o in options" :key="o.key" role="option">
        <button type="button" class="option" @click="pickOption(o)">{{ o.label }}</button>
      </li>
    </ul>

    <!-- The learning moment: the correct answer after a wrong guess or a pass. -->
    <div v-if="revealed" class="reveal">
      <span class="reveal-label">Answer</span>
      <span class="reveal-en">{{ answer }}</span>
      <span class="reveal-ru"><span lang="ru">{{ card.ru }}</span><SpeakButton :text="card.ru" /></span>
    </div>

    <!-- Answer by voice instead of typing. -->
    <div v-if="canSpeak && !revealed" class="speak-row">
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
      <button v-if="revealed" type="button" class="primary next" @click="advance">Next →</button>
      <button v-else type="button" class="pass" @click="pass">Pass →</button>
    </div>
  </div>
</template>

<style scoped>
.count {
  margin: 0;
  font-size: 0.85rem;
}
/* A placeable guess is a real word, so the correction teaches rather than
   rejects — amber, never the red of a flat miss. */
.correction {
  margin: 0;
  display: grid;
  gap: 0.15rem;
  font-size: 0.9rem;
  color: var(--gold);
}
.correction-headline {
  font-weight: 600;
}
.correction-detail {
  color: var(--text);
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
.pos {
  margin: -0.4rem 0 0;
  text-align: center;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
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
.combo-input.revealed {
  border-color: var(--bad);
  background: color-mix(in srgb, var(--bad) 10%, var(--card));
}
.options {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.option {
  font-size: 1rem;
  padding: 0.4rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  cursor: pointer;
}
.option:hover {
  border-color: var(--primary);
}
.reveal {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem 0.7rem;
  padding: 0.7rem 0.8rem;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
}
.reveal-label {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--bad);
}
.reveal-en {
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--text);
}
.reveal-ru {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--muted);
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
