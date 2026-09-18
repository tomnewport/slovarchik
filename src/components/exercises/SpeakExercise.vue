<script setup>
// Speaking exercise: produce the Russian aloud from the English (#733).
//
// The drill used to be an echo — the Russian on screen, read aloud, repeated
// back. Nothing was produced. Now the prompt is the English and the learner has
// to summon the sentence, with a ladder of help behind it (lib/speakingAid.js):
// the first encounter's dictionary of unlearned non-target words is free,
// arranging those words into the blanked sentence is free, and only filling the
// blank costs the exercise its flawlessness.
//
// Grading has one rule, unchanged since #79 and now the whole of it: **speech
// recognition never marks an answer wrong.** The Web Speech API mishears
// fluent Russian often enough that its "no" is not evidence. A match is
// recorded correct; anything else hands the verdict to the learner, who heard
// themselves say it. Only a self-certified miss records a wrong answer — which
// also means the learner is trusted when they say they got it, exactly as they
// already are when the recogniser is unavailable altogether.
//
// Whoever is grading, the learner never gives a verdict blind: the 'judge' step
// puts the model answer on screen AND reads it aloud before asking. You cannot
// say whether you said it right until you have heard what right sounds like —
// and the recogniser's transcript, when there is one, is not that.
import { computed, onBeforeUnmount, ref } from 'vue'

import { typingSequence } from '../../lib/phrases.js'
import { speak, speechSupported, cancelSpeech, estimateSpeechMs, SLOW_RATE } from '../../lib/speech.js'
import {
  listen,
  gradeSpoken,
  recognitionSupported,
  recognitionErrorMessage,
} from '../../lib/recognition.js'
import { HINT_ORDER, HINT_REVEAL, hintLadder, rungIsFree } from '../../lib/speakingAid.js'
import { posLabel } from '../../lib/spellPrompt.js'
import { playFeedback, settings, setSelfCertifySpeech } from '../../stores/settings.js'
import { speakingAidFor } from '../../stores/hints.js'
import { firstPhraseEncounter } from '../../stores/progress.js'
import AnnotatedEnglish from '../AnnotatedEnglish.vue'
import SpeakButton from '../SpeakButton.vue'
import WordFacts from '../WordFacts.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

const canRecognize = recognitionSupported()
// Whether the model answer can be *heard* rather than only read. Without a
// voice the verdict step still shows the sentence, and the wording stops
// promising a read-aloud that won't come.
const canSpeak = speechSupported()
const checkVerb = canSpeak ? 'hear' : 'check'

// Grade by hand when there's no recogniser at all, or when the learner has
// turned self-grading on for the rest of this app session.
const selfGrading = computed(() => !canRecognize || settings.selfCertifySpeech)

// A match at 80% of the letters counts as heard saying it. Below that we don't
// conclude anything — the learner is asked instead.
const THRESHOLD = 0.8

// Give a reasonable window to finish speaking: ~3s for a word, ~10s for a phrase.
const isPhrase = computed(() => props.exercise.content === 'phrase')
const firstEncounter = isPhrase.value && firstPhraseEncounter(props.exercise.ru)
const maxListenMs = computed(() => (isPhrase.value ? 10000 : 3000))

// Letters expected, so we can stop early once roughly that much has been heard
// instead of waiting out the whole window for a short word.
const targetLetters = computed(() => typingSequence(props.exercise.ru).replace(/\s+/g, '').length)

// The word being said aloud — the subject of the facts panel once it is graded.
// A phrase drilling several words has no single subject, so it gets none.
const factsKey = computed(() => {
  const targets = (props.exercise.targets ?? []).filter(Boolean)
  return targets.length === 1 ? targets[0] : null
})

// --- The help ladder --------------------------------------------------------

// The free dictionary and the blanked sentence behind the first hint. Only a
// phrase has either: a single word's non-target words are the empty set, and
// its skeleton would be the answer.
const aid = computed(() =>
  isPhrase.value && props.exercise.ru
    ? speakingAidFor(props.exercise.ru, {
        targets: props.exercise.targets,
        targetTokens: props.exercise.targetTokens,
      })
    : { dictionary: [], skeleton: [], hasSkeleton: false },
)

// How far up the ladder the learner has climbed. 0 is the dictionary, which is
// on from the start and costs nothing.
const rung = ref(0)
const ladder = computed(() => hintLadder({ hasSkeleton: aid.value.hasSkeleton }))
const nextRung = computed(() => ladder.value.find((r) => r > rung.value) ?? null)
const showSkeleton = computed(() => rung.value >= HINT_ORDER && aid.value.hasSkeleton)
const revealed = computed(() => rung.value >= HINT_REVEAL)
// The fire is out once the answer has been handed over — and only then.
const hinted = computed(() => !rungIsFree(rung.value))

const hintLabel = computed(() =>
  nextRung.value === HINT_ORDER ? 'Put it in order' : 'Reveal the answer',
)

// The aids stay up while the learner is speaking, not just while they think:
// reading the sentence off the skeleton mid-utterance is what it is for. They
// go once there is a verdict to look at.
const aidVisible = computed(() => phase.value === 'prompt' || phase.value === 'listening')

function takeHint() {
  if (nextRung.value == null) return
  rung.value = nextRung.value
  // A revealed sentence is there to be said, so read it once: seeing it spelled
  // out is not the same as knowing how it sounds.
  if (revealed.value) speakSlow()
}

// --- Speaking and grading ---------------------------------------------------

// phase: 'prompt' (thinking, waiting to speak) | 'listening'
//      | 'judge' (the attempt is over — the answer is read out and the
//                 learner decides; reached by a mismatch or by self-grading)
//      | 'graded'
const phase = ref('prompt')
const transcript = ref('')
const recError = ref('')
const result = ref(null) // { correct }
const similarity = ref(0)

let recCtl = null
let cancelled = false
const timers = new Set()
function later(fn, ms) {
  const id = setTimeout(() => {
    timers.delete(id)
    fn()
  }, ms)
  timers.add(id)
  return id
}
function clearTimers() {
  for (const id of timers) clearTimeout(id)
  timers.clear()
}

const errorMessage = computed(() =>
  recError.value ? recognitionErrorMessage(recError.value) : '',
)

function stopRecognition() {
  if (recCtl) {
    recCtl.abort()
    recCtl = null
  }
}

function beginListen() {
  if (selfGrading.value || cancelled) return
  stopRecognition()
  clearTimers()
  earlyTimer = null
  recError.value = ''
  transcript.value = ''
  result.value = null
  phase.value = 'listening'
  recCtl = listen({
    lang: 'ru-RU',
    onResult: ({ transcript: heard }) => {
      if (cancelled) return
      transcript.value = heard
      maybeFinishEarly(heard)
    },
    onError: (err) => {
      if (!cancelled) recError.value = err
    },
    onEnd: (finalText, alternatives) => {
      recCtl = null
      clearTimers()
      if (cancelled || phase.value !== 'listening') return
      if (!finalText) {
        // Heard nothing — drop back to the prompt so they can try again rather
        // than putting a verdict to them about an attempt nobody heard.
        phase.value = 'prompt'
        if (!recError.value) recError.value = 'no-speech'
        return
      }
      grade(finalText, alternatives)
    },
  })
  // Hard cap: stop after the allotted window even if the recogniser doesn't.
  later(() => recCtl?.stop(), maxListenMs.value)
}

// Once we've heard roughly as many letters as the target, give the recogniser a
// short grace period to finalise, then stop — so a quick word concludes promptly.
let earlyTimer = null
function maybeFinishEarly(heard) {
  if (earlyTimer || !targetLetters.value) return
  const heardLetters = typingSequence(heard).replace(/\s+/g, '').length
  if (heardLetters >= targetLetters.value * 0.8) {
    earlyTimer = later(() => {
      earlyTimer = null
      recCtl?.stop()
    }, 700)
  }
}

// A match settles it; a mismatch settles nothing. See the module comment.
function grade(finalText, alternatives = []) {
  const guesses = alternatives.length ? alternatives : [finalText]
  const { correct, similarity: score, best } = gradeSpoken(guesses, props.exercise.ru, THRESHOLD)
  transcript.value = best || transcript.value
  similarity.value = score
  if (correct) {
    settle(true)
    return
  }
  // Over to the learner: they hear the model answer and say whether what they
  // said was it. The answer is on screen from here on — the attempt is over, so
  // showing it can no longer help them produce it, and they need it to judge.
  phase.value = 'judge'
  speakTargetSlow()
}

function settle(correct) {
  result.value = { correct }
  phase.value = 'graded'
  playFeedback(correct)
  speakTarget() // hear the model answer alongside the result
}

function speakTarget() {
  if (speechSupported()) speak(props.exercise.ru)
}

function speakTargetSlow() {
  if (speechSupported()) speak(props.exercise.ru, 'ru-RU', SLOW_RATE)
}

// Read the answer aloud slowly, then (if we interrupted a listening attempt)
// resume listening — a clearer model to echo before the next go.
function speakSlow() {
  const wasListening = phase.value === 'listening'
  stopRecognition()
  clearTimers()
  earlyTimer = null
  if (wasListening) phase.value = 'prompt'
  let opened = false
  const open = () => {
    if (opened || cancelled) return
    opened = true
    if (!selfGrading.value && wasListening) beginListen()
  }
  speak(props.exercise.ru, 'ru-RU', SLOW_RATE, { onEnd: open })
  // The slow read takes about twice as long — the watchdog waits it out rather
  // than cutting in mid-speech.
  later(open, estimateSpeechMs(props.exercise.ru, SLOW_RATE) + 500)
}

function tryAgain() {
  result.value = null
  recError.value = ''
  phase.value = 'prompt'
  beginListen()
}

// Self-grading: the learner has said it aloud and is ready for the verdict.
// The same judge step the recogniser path uses — the answer shown and read
// slowly — and only then the question. Free, and deliberately so: HINT_REVEAL
// costs the fire because it helps *produce* the sentence, and by here there is
// nothing left to produce.
function checkAnswer() {
  phase.value = 'judge'
  speakTargetSlow()
}

// The learner's own verdict — from the judge step, whether they arrived there
// from a mismatch or by self-grading. It counts exactly as a recognised attempt
// would, right or wrong.
function selfAssessed(correct) {
  settle(correct)
}

// "Speech not working?" — hand grading to the learner for the rest of this app
// session rather than skipping the word. The recogniser can be unusable for
// reasons the app can't detect (ambient noise on public transport, a mic the
// browser hands us but nothing reaches). Stops the mic immediately so nothing
// half-heard arrives late and grades on their behalf.
function certifySelf() {
  stopRecognition()
  clearTimers()
  earlyTimer = null
  recError.value = ''
  transcript.value = ''
  result.value = null
  phase.value = 'prompt'
  setSelfCertifySpeech(true)
}

// Back to the microphone, from the next exercise onwards as well.
function useMic() {
  setSelfCertifySpeech(false)
  beginListen()
}

function next() {
  emit('done', {
    correct: result.value?.correct ?? false,
    // Free help leaves the fire lit; the reveal puts it out. This is what the
    // quick-progression offer reads (#725), so it is the whole cost of a hint.
    flawless: rungIsFree(rung.value),
  })
}

// Nothing is read aloud when the exercise appears: the Russian *is* the answer,
// and the English is on screen to be read. The mic opens when the learner says
// they are ready, not before — producing a sentence takes longer than echoing
// one, and an auto-opened mic would time out while they were still thinking.

onBeforeUnmount(() => {
  cancelled = true
  clearTimers()
  stopRecognition()
  cancelSpeech()
})
</script>

<template>
  <div class="grid speak" style="gap: 1rem">
    <p class="muted">Say it in Russian</p>

    <!-- The prompt: the English, and nothing that gives the Russian away. -->
    <div class="prompt">
      <AnnotatedEnglish
        class="cue"
        :text="exercise.en"
        :notes="exercise.enNotes ?? []"
      />
      <small v-if="!isPhrase && exercise.note" class="muted">({{ exercise.note }})</small>
      <small v-else-if="!isPhrase && exercise.ambiguousEn?.length" class="muted">
        (one of {{ exercise.ambiguousEn.length + 1 }} Russian words for this)
      </small>
      <small v-if="exercise.pos && !isPhrase" class="pos">
        {{ posLabel(exercise.pos, exercise.aspect) }}
      </small>
    </div>

    <!-- Rung 0: on the first encounter, unlearned non-target headwords with
         glosses, alphabetically. Free, and on from the start. -->
    <ul v-if="firstEncounter && aid.dictionary.length && aidVisible" class="dict-list">
      <li v-for="entry in aid.dictionary" :key="entry.key">
        <span lang="ru" class="dict-ru">{{ entry.ru }}</span>
        <span lang="en" class="dict-en">{{ entry.en }}</span>
      </li>
    </ul>

    <!-- Rung 1: those words in the sentence's own order and forms, with the
         assessed word blanked. Also free. -->
    <p v-if="showSkeleton && aidVisible" lang="ru" class="skeleton">
      <span
        v-for="(t, i) in aid.skeleton"
        :key="i"
        :class="{ blank: t.blank }"
        >{{ t.text }}</span
      >
    </p>

    <!-- Rung 2: the answer itself, which is what the fire pays for. -->
    <div v-if="revealed && aidVisible" class="revealed">
      <span lang="ru" class="ru">{{ exercise.ru }}</span>
      <SpeakButton :text="exercise.ru" :slow="true" />
    </div>

    <!-- The ladder's control. The fire is lit while the help is still free and
         goes out when the answer is handed over; it stays on screen, spent, so
         the state of the exercise is readable rather than merely remembered. -->
    <button
      v-if="aidVisible"
      type="button"
      class="hint-rung"
      :class="{ spent: hinted }"
      :disabled="nextRung == null"
      @click="takeHint"
    >
      <span class="face" :class="{ out: hinted }" aria-hidden="true">🔥</span>
      <template v-if="nextRung != null">
        <span class="label">{{ hintLabel }}</span>
        <small class="cost">{{ nextRung === HINT_ORDER ? 'free' : 'costs the fire' }}</small>
      </template>
    </button>

    <!-- The verdict, however it was reached — the recogniser's match, or the
         learner's own word. One block, because from here the two are the same
         thing: an attempt with a result on it. -->
    <template v-if="phase === 'graded'">
      <p class="feedback" :class="result.correct ? 'good' : 'bad'">
        <template v-if="result.correct">✓ Got it!</template>
        <template v-else>✗ Not quite</template>
      </p>
      <div class="answer">
        <span lang="ru" class="ru">{{ exercise.ru }}</span>
        <SpeakButton :text="exercise.ru" :slow="true" />
      </div>
      <!-- About this word (#586) — once it has been graded, right or wrong. -->
      <WordFacts v-if="factsKey" :word-key="factsKey" />
      <div class="row">
        <button class="primary next" @click="next">Next →</button>
      </div>
    </template>

    <!-- The attempt is over and the verdict is the learner's to give — because
         the recogniser heard something that didn't match, or because there is
         no recogniser and they have said they're done. Either way the model
         answer is on screen and read aloud before the question: nobody can say
         whether they said it right without hearing what right sounds like, and
         a transcript of what the recogniser thought it heard is not that.
         Free, deliberately — HINT_REVEAL charges the fire for help *producing*
         the sentence, and by here there is nothing left to produce. -->
    <template v-else-if="phase === 'judge'">
      <div class="answer">
        <span lang="ru" class="ru">{{ exercise.ru }}</span>
        <SpeakButton :text="exercise.ru" :slow="true" />
      </div>
      <p v-if="transcript" class="muted heard" style="margin: 0">
        Heard: "{{ transcript }}"
        <span class="match-score">· {{ Math.round(similarity * 100) }}% letters</span>
      </p>
      <p class="muted info">
        <template v-if="!selfGrading">
          That isn't what we heard — but the recogniser mishears plenty. Was what you said right?
        </template>
        <template v-else-if="canSpeak">
          Here's the answer, read out — was that what you said?
        </template>
        <template v-else>
          Here's the answer — was that what you said?
        </template>
      </p>
      <div class="row">
        <button class="primary next" @click="selfAssessed(true)">✓ I said it</button>
        <button class="missed" @click="selfAssessed(false)">✗ Not quite</button>
        <button v-if="!selfGrading" @click="tryAgain">🎤 Try again</button>
      </div>
    </template>

    <!-- With a working recogniser: listen, and let a match stand on its own. -->
    <template v-else-if="!selfGrading">
      <p v-if="errorMessage && phase === 'prompt'" class="feedback bad" style="margin: 0">
        {{ errorMessage }}
      </p>

      <template v-if="phase === 'listening'">
        <p class="listening">🎤 Listening…</p>
        <p v-if="transcript" lang="ru" class="heard">"{{ transcript }}"</p>
        <div class="row">
          <button class="primary done" @click="recCtl?.stop()">Done</button>
          <!-- Only once the answer is already on screen: reading it aloud
               mid-attempt would be the reveal by another route. -->
          <button v-if="revealed" @click="speakSlow">🐢 Slow</button>
        </div>
      </template>

      <template v-else>
        <div class="row">
          <button class="primary mic" @click="beginListen">🎤 Speak</button>
        </div>
      </template>
    </template>

    <!-- Self-graded: say it aloud, then ask for the answer and report how it
         went. Two steps, not one — the answer arrives *after* the attempt, so
         it judges the attempt rather than supplying it. The verdict counts
         exactly as a recognised attempt would, right or wrong. -->
    <template v-else>
      <p class="muted info">
        <template v-if="canRecognize">
          You're grading yourself — say it aloud, then {{ checkVerb }} the answer and mark how it
          went. It counts the same as a recognised answer.
        </template>
        <template v-else>
          Speech recognition isn't available in this browser (try Chrome or Edge) — say it aloud,
          then {{ checkVerb }} the answer and mark how it went.
        </template>
      </p>
      <div class="row">
        <button class="primary said" @click="checkAnswer">
          I've said it — {{ checkVerb }} the answer
        </button>
        <button v-if="revealed" @click="speakSlow">🐢 Slow</button>
      </div>
    </template>

    <!-- Escape hatch for a recogniser that can't do the job — mis-hearing this
         word, or drowned out on a noisy train. Hands grading to the learner
         rather than putting a verdict to them about every single attempt. Still
         offered at the judge step: a mismatch is exactly when the learner
         discovers the recogniser is useless here. -->
    <button v-if="!selfGrading && phase !== 'graded'" class="self-certify" @click="certifySelf">
      Speech not working? Grade it yourself
    </button>
    <!-- Only from the prompt: switching back mid-verdict would throw away an
         attempt that has already been made. -->
    <button
      v-if="selfGrading && canRecognize && phase === 'prompt'"
      class="self-certify"
      @click="useMic"
    >
      Speech working again? Use the microphone
    </button>
  </div>
</template>

<style scoped>
.prompt {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem;
}
.cue {
  font-size: 1.35rem;
}
.pos {
  color: var(--muted);
  font-size: 0.8rem;
}
.answer,
.revealed {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 1.5rem;
}
.info {
  font-size: 0.9rem;
}

/* The free dictionary — headwords, alphabetical, saying nothing about order. */
.dict-list {
  list-style: none;
  margin: 0;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-soft);
  display: grid;
  gap: 0.2rem;
  font-size: 0.95rem;
}
.dict-ru {
  font-weight: 600;
}
.dict-en {
  color: var(--muted);
  margin-left: 0.5rem;
}

.skeleton {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0;
  font-size: 1.25rem;
}
.skeleton .blank {
  color: var(--primary);
  letter-spacing: 0.05em;
}

/* Mirrors HintPassButton's vocabulary (a fire that goes out) without being it:
   there the first press is always the one that costs, and here the first rungs
   are free, so the two cannot share a control. */
.hint-rung {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  justify-self: start;
  padding: 0.35rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card);
  color: var(--muted);
  font-size: 0.85rem;
}
.hint-rung .face {
  font-size: 1rem;
  line-height: 1;
  transition:
    filter 0.45s ease,
    opacity 0.45s ease;
}
.hint-rung .face.out {
  filter: grayscale(1);
  opacity: 0.45;
}
.hint-rung .cost {
  opacity: 0.7;
}
.hint-rung:disabled {
  opacity: 0.6;
}

.mic {
  font-size: 1.15rem;
  padding: 0.6rem 1.4rem;
  justify-self: start;
}
.listening {
  margin: 0;
  font-size: 1.2rem;
  animation: pulse 1.2s ease-in-out infinite;
}
.heard {
  font-style: italic;
}
.match-score {
  margin-left: 0.4rem;
  font-weight: 400;
  opacity: 0.85;
}
.self-certify {
  justify-self: start;
  font-size: 0.85rem;
  color: var(--muted);
  background: none;
  border: none;
  padding: 0.25rem 0;
  text-decoration: underline;
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
