<script setup>
// Usage / dictation exercise: spell the Russian with the hintable on-screen
// keyboard. Covers spell-word, spell-phrase and dictation (where the prompt is
// heard, not seen). Hints never penalise — grading only looks at the answer.
//
// Spelling (#keyboard-hints-word-bank) nudges the learner to spell unaided
// first: the keyboard hint is withheld on the opening attempt — for phrases
// and single words alike. If that first try lands close to the answer we mark
// *where* it went wrong (without giving the letters away), then unlock the
// keyboard hint for a second, aided try. Phrases additionally get a
// ❓ Dictionary revealing — with no penalty — the phrase words the learner
// hasn't learned yet (the ones they can't be expected to spell).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  assessedWordCorrect,
  phraseCorrect,
  phraseFeedback,
  spellingDiff,
  typingSequence,
} from '../../lib/phrases.js'
import { shuffle } from '../../lib/quiz.js'
import { normToken } from '../../lib/phraseHint.js'
import { stripStress } from '../../lib/text.js'
import { speak } from '../../lib/speech.js'
import { keyboard, resetHint, setHintAllowed } from '../../stores/keyboard.js'
import { hintTokensFor } from '../../stores/hints.js'
import { playFeedback } from '../../stores/settings.js'
import AnnotatedEnglish from '../AnnotatedEnglish.vue'
import SpeakButton from '../SpeakButton.vue'
import CelebrationBurst from '../CelebrationBurst.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

// Only phrases get the Dictionary (a single word's dictionary entry would be
// the answer); the withhold-then-hint flow applies to words and phrases alike.
const isPhrase = computed(() => props.exercise.content === 'phrase')

const typed = ref('')
const checked = ref(false)
const wasCorrect = ref(false)
// Whether the first, unaided check was correct. This — not the final graded
// state — is the evidence of unaided recall: a wrong first attempt corrected on
// the retry never earns first-try credit (#447).
const firstTryCorrect = ref(false)
// For a phrase, whether the *word being assessed* was spelled right on that
// first, unaided attempt — true even when the whole phrase was wrong if the only
// slip was elsewhere. Lets the session spare the word a penalty while still
// counting the exercise as incorrect. For a single word (no targetTokens) this
// tracks firstTryCorrect.
const firstTryWordCorrect = ref(false)
// On a first wrong answer offer one retry before revealing. Once the learner
// has retried (or they got it right), this stays true so we don't loop.
const retried = ref(false)
// After a close-but-wrong first phrase attempt, the per-character map of where
// the learner slipped (shown while they retry). Empty when we don't reveal it.
const errorCells = ref([])
// Graded feedback on the first wrong attempt (#523): a headline ("Almost
// correct" / "Good try" / "One word missing" / …) driven by Levenshtein
// similarity and a word-by-word pass. Null until the first miss.
const feedback = ref(null)
// When the first miss was "right words, wrong order", we swap the retry from
// retyping to rearranging chips. `chips` are the learner's tokens (tap to place),
// `placed` the order they've rebuilt so far.
const reorderMode = ref(false)
const chips = ref([])
const placed = ref([])
const placedIds = computed(() => new Set(placed.value.map((c) => c.id)))
const availableChips = computed(() => chips.value.filter((c) => !placedIds.value.has(c.id)))
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
// Correct on the first try and never reached for the hint — the answer the
// learner truly knew unaided. A retry success never qualifies (#447).
const double = computed(() => firstTryCorrect.value && !hintUsed.value)

const answer = computed(() => typingSequence(props.exercise.ru))

// Every accepted Russian rendering (the target plus any synonyms) — the answer
// is graded, and its feedback measured, against whichever one it's closest to.
const gradeTargets = computed(() => [props.exercise.ru, ...(props.exercise.alsoRu ?? [])])

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
  wasCorrect.value = phraseCorrect(typed.value, gradeTargets.value)
  if (!retried.value) {
    // Capture the first, unaided attempt's outcome — the only evidence of
    // unaided recall. A phrase can be wrong overall yet the assessed word
    // spelled right (a slip elsewhere); coerce to a clean boolean
    // (assessedWordCorrect → null for a single word, where the whole answer *is*
    // the word).
    firstTryCorrect.value = wasCorrect.value
    firstTryWordCorrect.value =
      wasCorrect.value || assessedWordCorrect(typed.value, props.exercise.targetTokens) === true
  }
  if (!wasCorrect.value && !retried.value) {
    retried.value = true
    // Grade *how* the attempt missed so the retry hint can say more than "not
    // quite" (#523).
    feedback.value = phraseFeedback(typed.value, gradeTargets.value)
    if (feedback.value.reorder) {
      // Right words, wrong order: retry by rearranging chips, not retyping.
      enterReorder(feedback.value.chips)
    } else {
      // Mark where the unaided attempt slipped (when close), then unlock the
      // keyboard hint so the second try can be aided.
      const cells = spellingDiff(typingSequence(typed.value), answer.value)
      if (closeEnough(cells)) errorCells.value = cells
      setHintAllowed(true)
      typed.value = ''
    }
    playFeedback(false)
    return
  }
  resolve()
}

// Enter reorder mode: turn the learner's own words into tappable chips (shuffled
// so the wrong order isn't simply reproduced left to right).
function enterReorder(words) {
  reorderMode.value = true
  chips.value = shuffle(words.map((text, id) => ({ id, text })))
  placed.value = []
}

function placeChip(chip) {
  if (checked.value || placedIds.value.has(chip.id)) return
  placed.value.push(chip)
}
function unplaceChip(chip) {
  if (checked.value) return
  placed.value = placed.value.filter((c) => c.id !== chip.id)
}

// Grade the rearranged chips as the (aided) second attempt.
function checkOrder() {
  if (checked.value) return
  wasCorrect.value = phraseCorrect(placed.value.map((c) => c.text).join(' '), gradeTargets.value)
  resolve()
}

// Settle the exercise: play feedback, celebrate a clean first try, and read the
// answer aloud once resolved.
function resolve() {
  checked.value = true
  playFeedback(wasCorrect.value)
  if (double.value) showFire.value = true
  // Read the Russian aloud once the answer is resolved so the learner hears the
  // correct pronunciation — especially helpful after a spelling exercise.
  if (!props.exercise.audio) speak(props.exercise.ru)
}

function next() {
  // Preserve the first miss: a retry success reports the initial failure
  // (`correct: false`) flagged `correctedOnRetry`, so the session records the
  // real first-try outcome instead of two first-try successes (#447).
  emit('done', {
    correct: firstTryCorrect.value,
    correctedOnRetry: retried.value && wasCorrect.value,
    double: double.value,
    wordCorrect: firstTryWordCorrect.value,
  })
}

onMounted(() => {
  resetHint()
  // Withhold the keyboard hint for the first, unaided attempt.
  setHintAllowed(false)
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
        <!-- The English is all the learner gets, so anything the Russian
             answer commits to that the English hides (informal vs formal
             "you", the speaker's gender) is annotated on the word itself. -->
        <AnnotatedEnglish class="cue" :text="exercise.en" :notes="exercise.enNotes ?? []" />
        <small v-if="exercise.note" class="muted">({{ exercise.note }})</small>
        <small v-else-if="exercise.ambiguousEn?.length" class="muted">
          (one of {{ exercise.ambiguousEn.length + 1 }} Russian words for this)
        </small>
      </template>
      <!-- Which part of speech the answer should be — e.g. "cold" the adjective
           vs the adverb (#503). Word spelling only; a phrase has no single POS. -->
      <small v-if="exercise.pos && !isPhrase" class="pos">{{ exercise.pos }}</small>
    </div>

    <form v-if="!reorderMode" @submit.prevent="check">
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

    <!-- Right words, wrong order (#523): rebuild the phrase by tapping the chips
         into the correct order instead of retyping. -->
    <div v-if="reorderMode && !checked" class="reorder">
      <div class="answer-line" :aria-label="placed.map((c) => c.text).join(' ')">
        <button
          v-for="chip in placed"
          :key="chip.id"
          type="button"
          class="chip placed"
          lang="ru"
          @click="unplaceChip(chip)"
        >
          {{ chip.text }}
        </button>
        <span v-if="!placed.length" class="muted">Tap the words in order…</span>
      </div>
      <div class="bank">
        <button
          v-for="chip in availableChips"
          :key="chip.id"
          type="button"
          class="chip"
          lang="ru"
          @click="placeChip(chip)"
        >
          {{ chip.text }}
        </button>
      </div>
    </div>

    <!-- Dictionary: reveal, with no penalty, the phrase words the learner can't
         be expected to spell yet. -->
    <div v-if="dictionary.length && !checked && !reorderMode" class="dictionary">
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
      <p class="retry-hint" :class="feedback?.tier">
        {{ feedback?.message ?? 'Not quite' }}
        <span class="retry-again">— {{ reorderMode ? 'reorder the words' : 'try again' }}</span>
      </p>
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
      <button
        v-if="!checked && reorderMode"
        class="primary check"
        :disabled="!placed.length"
        @click="checkOrder"
      >
        Check
      </button>
      <button v-else-if="!checked" class="primary check" :disabled="!typed.trim()" @click="check">
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
.pos {
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.8rem;
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
  color: var(--gold);
  font-size: 0.9rem;
}
/* Only a genuinely-far answer ("Incorrect") reads red; the closer bands and the
   structural hints (reorder / missing word) stay amber — encouraging, not a
   rejection. */
.retry-hint.incorrect {
  color: var(--bad);
}
.retry-again {
  color: var(--muted);
}
.reorder {
  display: grid;
  gap: 0.6rem;
}
.reorder .answer-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  min-height: 3rem;
  align-items: center;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-soft);
}
.reorder .bank {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.chip {
  padding: 0.5rem 0.8rem;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
  font-size: 1.05rem;
}
.chip.placed {
  border-color: var(--primary);
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
