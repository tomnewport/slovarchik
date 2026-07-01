<script setup>
// Usage / dictation exercise: spell the Russian with the hintable on-screen
// keyboard. Covers spell-word, spell-phrase and dictation (where the prompt is
// heard, not seen). Hints never penalise — grading only looks at the answer.
//
// Phrase spelling (#keyboard-hints-word-bank) nudges the learner to spell
// unaided first: the keyboard hint is withheld on the opening attempt, and a
// ❓ Dictionary reveals — with no penalty — the phrase words they haven't
// learned yet (the ones they can't be expected to spell). If that first try
// lands close to the answer we mark *where* it went wrong (without giving the
// letters away), then unlock the keyboard hint for a second, aided try.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { assessedWordCorrect, phraseCorrect, spellingDiff, typingSequence } from '../../lib/phrases.js'
import { normToken } from '../../lib/phraseHint.js'
import { stripStress } from '../../lib/text.js'
import { speak } from '../../lib/speech.js'
import { keyboard, resetHint, setHintAllowed } from '../../stores/keyboard.js'
import { hintTokensFor } from '../../stores/hints.js'
import { playFeedback } from '../../stores/settings.js'
import SpeakButton from '../SpeakButton.vue'
import CelebrationBurst from '../CelebrationBurst.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

// Phrase spelling gets the withhold-then-hint flow and the Dictionary; single
// words keep the classic behaviour (hint available from the start).
const isPhrase = computed(() => props.exercise.content === 'phrase')

const typed = ref('')
const checked = ref(false)
const wasCorrect = ref(false)
// For a phrase, whether the *word being assessed* was spelled right — true even
// when the whole phrase is wrong if the only slip was elsewhere. Lets the session
// spare the word a penalty while still counting the exercise as incorrect. For a
// single word (no targetTokens) this always tracks wasCorrect.
const wordCorrect = ref(false)
// On a first wrong answer offer one retry before revealing. Once the learner
// has retried (or they got it right), this stays true so we don't loop.
const retried = ref(false)
// After a close-but-wrong first phrase attempt, the per-character map of where
// the learner slipped (shown while they retry). Empty when we don't reveal it.
const errorCells = ref([])
// The ❓ Dictionary panel (unlearned phrase words) — collapsed by default.
const dictOpen = ref(false)
// Whether the learner switched the keyboard hint on at any point this exercise.
// A correct answer with the hint untouched counts double (and gets a little 🔥).
const hintUsed = ref(false)
const showFire = ref(false)
watch(
  () => keyboard.on,
  (on) => {
    if (on) hintUsed.value = true
  },
)
// Correct and never reached for the hint — the answer the learner truly knew.
const double = computed(() => wasCorrect.value && !hintUsed.value)

const answer = computed(() => typingSequence(props.exercise.ru))

// The unlearned words of a phrase, each with its meaning, for the Dictionary:
// words the learner hasn't learned and isn't actively drilling. The word this
// exercise is testing is always excluded — belt and braces, since the shared
// hint index could in principle attribute its inflected surface form to another
// entry — so the answer is never handed out. Sorted alphabetically like a real
// dictionary.
const dictionary = computed(() => {
  if (!isPhrase.value) return []
  const assessedKeys = new Set(props.exercise.targets ?? [])
  const assessedTokens = new Set(props.exercise.targetTokens ?? [])
  const seen = new Set()
  const out = []
  for (const { text, hint } of hintTokensFor(props.exercise.ru)) {
    if (!hint) continue
    // Never reveal the assessed word, however its form is recognised.
    if (assessedKeys.has(hint.key) || assessedTokens.has(normToken(text))) continue
    // Drop any surrounding punctuation so an end-of-phrase word reads cleanly.
    const ru = text.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
    const key = ru.toLowerCase()
    if (!ru || seen.has(key)) continue
    seen.add(key)
    out.push({ ru, en: hint.en })
  }
  return out.sort((a, b) => stripStress(a.ru).localeCompare(stripStress(b.ru), 'ru'))
})

// Did the first unaided phrase attempt land close enough to be worth showing
// where it went wrong? 95% of the answer right, or (for answers over four
// letters) no more than two slips.
function closeEnough(cells) {
  const dist = cells.filter((c) => c.type !== 'ok').length
  const len = answer.value.length
  return len > 0 && (dist <= len * 0.05 || (len > 4 && dist <= 2))
}

function check() {
  if (checked.value) return
  const targets = [props.exercise.ru, ...(props.exercise.alsoRu ?? [])]
  wasCorrect.value = phraseCorrect(typed.value, targets)
  if (!wasCorrect.value && !retried.value) {
    retried.value = true
    if (isPhrase.value) {
      // Mark where the unaided attempt slipped (when close), then unlock the
      // keyboard hint so the second try can be aided.
      const cells = spellingDiff(typingSequence(typed.value), answer.value)
      if (closeEnough(cells)) errorCells.value = cells
      setHintAllowed(true)
    }
    typed.value = ''
    playFeedback(false)
    return
  }
  checked.value = true
  // A phrase can be wrong overall yet the assessed word spelled right (a slip
  // elsewhere); coerce to a clean boolean (assessedWordCorrect → null for a
  // single word, where the whole answer *is* the word).
  wordCorrect.value =
    wasCorrect.value || assessedWordCorrect(typed.value, props.exercise.targetTokens) === true
  playFeedback(wasCorrect.value)
  if (double.value) showFire.value = true
  // Read the Russian aloud once the answer is resolved so the learner hears the
  // correct pronunciation — especially helpful after a spelling exercise.
  if (!props.exercise.audio) speak(props.exercise.ru)
}

function next() {
  emit('done', { correct: wasCorrect.value, double: double.value, wordCorrect: wordCorrect.value })
}

onMounted(() => {
  resetHint()
  // Withhold the keyboard hint for a phrase's first, unaided attempt.
  if (isPhrase.value) setHintAllowed(false)
  if (props.exercise.audio) speak(props.exercise.ru)
})

// Restore the default so the next exercise's keyboard isn't left locked if this
// one is left (e.g. answered correctly first try, with the hint never unlocked).
onBeforeUnmount(() => setHintAllowed(true))
</script>

<template>
  <div class="grid" style="gap: 1rem">
    <div class="prompt">
      <template v-if="exercise.audio">
        <span class="muted">Type what you hear</span>
        <SpeakButton :text="exercise.ru" />
      </template>
      <template v-else>
        <span class="cue">{{ exercise.en }}</span>
        <small v-if="exercise.note" class="muted">({{ exercise.note }})</small>
        <small v-else-if="exercise.ambiguousEn?.length" class="muted">
          (one of {{ exercise.ambiguousEn.length + 1 }} Russian words for this)
        </small>
      </template>
    </div>

    <form @submit.prevent="check">
      <input
        v-model="typed"
        type="text"
        lang="ru"
        class="answer-input"
        :data-answer="answer"
        :disabled="checked"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="по-русски…"
      />
    </form>

    <!-- Dictionary: reveal, with no penalty, the phrase words the learner can't
         be expected to spell yet. -->
    <div v-if="dictionary.length && !checked" class="dictionary">
      <button type="button" class="dict-toggle" :aria-expanded="dictOpen" @click="dictOpen = !dictOpen">
        ❓ Dictionary
      </button>
      <ul v-if="dictOpen" class="dict-list">
        <li v-for="entry in dictionary" :key="entry.ru">
          <span lang="ru" class="dict-ru">{{ entry.ru }}</span>
          <span class="dict-en" lang="en">{{ entry.en }}</span>
        </li>
      </ul>
    </div>

    <template v-if="retried && !checked">
      <p class="retry-hint">Not quite — try again</p>
      <!-- Where the first, unaided try slipped: wrong letters flagged, gaps for
           omissions — without revealing the correct letters. -->
      <p v-if="errorCells.length" class="error-map" aria-label="Where your spelling went wrong">
        <span
          v-for="(cell, i) in errorCells"
          :key="i"
          class="cell"
          :class="cell.type"
          lang="ru"
        >{{ cell.type === 'gap' ? '·' : cell.char === ' ' ? '␣' : cell.char }}</span>
      </p>
    </template>

    <div v-if="checked" class="feedback-block">
      <div class="feedback" :class="wasCorrect ? 'ok' : 'no'">
        <strong>{{ wasCorrect ? 'Correct' : 'Answer:' }}</strong>
        <span lang="ru" class="answer-text">{{ exercise.ru }}</span>
        <SpeakButton :text="exercise.ru" />
      </div>
      <p v-if="exercise.audio && exercise.en" class="translation-hint">{{ exercise.en }}</p>
    </div>

    <div class="row check-row">
      <CelebrationBurst :show="showFire" emoji="🔥" />
      <button v-if="!checked" class="primary check" :disabled="!typed.trim()" @click="check">
        Check
      </button>
      <button v-else class="primary next" @click="next">Next →</button>
    </div>
  </div>
</template>

<style scoped>
.prompt {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.3rem;
}
.answer-input {
  width: 100%;
  padding: 0.6rem;
  font-size: 1.2rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
}
.retry-hint {
  margin: 0;
  color: var(--bad);
  font-size: 0.9rem;
}
.dictionary {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.dict-toggle {
  align-self: flex-start;
  font-size: 0.9rem;
  color: var(--muted);
}
.dict-list {
  list-style: none;
  margin: 0;
  padding: 0.5rem 0.6rem;
  display: grid;
  gap: 0.3rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-soft);
}
.dict-list li {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
}
.dict-ru {
  font-weight: 600;
}
.dict-en {
  color: var(--muted);
  font-size: 0.9rem;
}
/* Per-character map of the first-try slips (monospace so cells line up). */
.error-map {
  margin: 0;
  font-family: ui-monospace, monospace;
  font-size: 1.2rem;
  letter-spacing: 0.05em;
  word-break: break-word;
}
.error-map .cell.ok {
  color: var(--muted);
}
.error-map .cell.wrong {
  color: var(--bad);
  text-decoration: underline wavy;
}
.error-map .cell.gap {
  color: var(--bad);
}
.feedback-block {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.feedback {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.translation-hint {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}
.feedback.ok strong {
  color: var(--good);
}
.feedback.no strong {
  color: var(--bad);
}
.answer-text {
  font-size: 1.2rem;
}
/* Anchor the 🔥 burst over the Check/Next button. */
.check-row {
  position: relative;
}
</style>
