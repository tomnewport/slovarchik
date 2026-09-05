<script setup>
// Usage / dictation exercise: spell the Russian with the hintable on-screen
// keyboard. Covers spell-word, spell-phrase and dictation (where the prompt is
// heard, not seen). Hints never penalise — grading only looks at the answer.
//
// A wrong answer that is a real, related word is not a failure to be cut off
// after one retry — it is the moment the distinction is learnable (#588). Such
// an answer is diagnosed ("«сшить» is the perfective…"), the input re-opens, and
// the learner may try as often as they like; an **I don't know** link ends the
// loop whenever they want, so a counter never does it for them. An answer that
// *isn't* a recognisable word is an ordinary spelling slip and behaves exactly
// as it always has. Grading is untouched either way: only the first attempt is
// evidence of recall, and every later try teaches.
//
// Giving up is a deliberate act, never a misclick: the escape is a quiet link
// (never the primary button, and never wearing Next's clothes), and it asks
// before it fires, spelling out that it is an "I don't know" — the answer is
// shown, the question is marked wrong, and the word comes back — rather than a
// free pass to the next exercise.
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
import { posLabel } from '../../lib/spellPrompt.js'
import { normToken } from '../../lib/phraseHint.js'
import { stripStress } from '../../lib/text.js'
import { speak } from '../../lib/speech.js'
import { keyboard, resetHint, setHintAllowed } from '../../stores/keyboard.js'
import { hintTokensFor, diagnoseAnswer } from '../../stores/hints.js'
import { correctionMessage, QUIET_TIERS } from '../../lib/confusables.js'
import { ruleReminder, spellingRuleMiss } from '../../lib/ruleOracle.js'
import { state as vocabState } from '../../stores/vocab.js'
import { playFeedback } from '../../stores/settings.js'
import AnnotatedEnglish from '../AnnotatedEnglish.vue'
import WordFacts from '../WordFacts.vue'
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
// How many answers have been checked. Only the first is evidence of recall; the
// count also decides when a *spelling* miss has had its one retry.
const attempts = ref(0)
// Wrong answers that weren't a recognisable word — the ones the old one-retry
// rule governs. A diagnosed (lexical) miss never counts here, so it never
// spends the learner's retry.
const spellingMisses = ref(0)
// The diagnosis of the latest lexical miss: {headline, detail, tier}, or null
// when the answer was an ordinary slip. See lib/confusables.js.
const correction = ref(null)
// The spelling rule a miss broke — and broke on its own, the rest of the answer
// being right (#646). Typing «кни́гы» is the seven-letter rule, not a gap in the
// genitive, and saying so once saves a whole column of endings. Null for the
// ordinary slip, which is nearly all of them. Grading is untouched: this is a
// reminder, not a second chance.
const ruleHint = ref(null)
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
// Whether the "I don't know" link has been pressed and is awaiting confirmation.
// Nothing is graded or revealed until the learner confirms.
const confirmingReveal = ref(false)
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

// The word whose facts the resolved answer shows. A phrase drills one assessed
// word (the one `targetTokens` marks in the sentence), so it is that word the
// panel is about; a set spanning several words has no single subject and gets
// none.
const factsKey = computed(() => {
  const targets = (props.exercise.targets ?? []).filter(Boolean)
  return targets.length === 1 ? targets[0] : null
})

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
    // Never reveal the assessed word, however its form is recognised — including
    // when it is only one sense of a homograph the hint also glosses otherwise.
    if (hint.senses.some((s) => assessedKeys.has(s.key))) continue
    if (assessedTokens.has(normToken(text))) continue
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
  if (attempts.value === 0) {
    // Capture the first, unaided attempt's outcome — the only evidence of
    // unaided recall. A phrase can be wrong overall yet the assessed word
    // spelled right (a slip elsewhere); coerce to a clean boolean
    // (assessedWordCorrect → null for a single word, where the whole answer *is*
    // the word).
    firstTryCorrect.value = wasCorrect.value
    firstTryWordCorrect.value =
      wasCorrect.value || assessedWordCorrect(typed.value, props.exercise.targetTokens) === true
  }
  attempts.value += 1
  if (wasCorrect.value) {
    resolve()
    return
  }
  retried.value = true

  // Did they write a real word — one the dictionary can name and relate to the
  // answer? If so this is a confusion, not a slip: say what they wrote and let
  // them go again, however many attempts it takes.
  const verdict = diagnoseAnswer(typed.value, {
    targetKey: (props.exercise.targets ?? [])[0],
    target: props.exercise.ru,
  })
  if (verdict) {
    correction.value = correctionMessage(verdict)
    ruleHint.value = null
    feedback.value = null
    errorCells.value = []
    // The second attempt is aided whatever went wrong on the first — a lexical
    // miss escalates the help like any other, it just doesn't spend the retry.
    setHintAllowed(true)
    typed.value = ''
    // A synonym, or the right word in another region's shape, is correct
    // knowledge in the wrong slot — not a sound worth punishing.
    if (!QUIET_TIERS.includes(correction.value.tier)) playFeedback(false)
    return
  }

  correction.value = null
  // Did the answer break a spelling rule and nothing else? Then the rule is the
  // whole of what went wrong, and it is worth more than "not quite".
  ruleHint.value =
    ruleReminder(spellingRuleMiss(typed.value, props.exercise.ru), vocabState.rules) ??
    ruleHint.value
  spellingMisses.value += 1
  if (spellingMisses.value === 1) {
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

/** End the loop on the learner's terms: reveal the answer, unsolved. */
function reveal() {
  if (checked.value) return
  confirmingReveal.value = false
  wasCorrect.value = false
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
  attempts.value += 1
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
    correctedOnRetry: attempts.value > 1 && wasCorrect.value,
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
           vs the adverb (#503) — and, for a verb, which aspect, the only thing
           that tells уби́ть from убива́ть when both glosses read "to kill"
           (#527). Word spelling only; a phrase has no single POS. -->
      <small v-if="exercise.pos && !isPhrase" class="pos">
        {{ posLabel(exercise.pos, exercise.aspect) }}
      </small>
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

    <!-- The answer was a real, related word: name it and say how it differs,
         without ever spelling out the word being asked for. -->
    <p v-if="correction && !checked" class="retry-hint" :class="correction.tier">
      <strong class="correction-headline">{{ correction.headline }}</strong>
      <span class="correction-detail">{{ correction.detail }}</span>
      <span class="retry-again">— try again</span>
    </p>

    <template v-if="retried && !correction && !checked">
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

    <!-- A rule the answer broke, and the only thing that went wrong with it
         (#646). Named while the learner is still trying — it says which letters
         the rule chooses between, never the word — and kept on screen once the
         answer is in, so a miss that was never corrected still lands. -->
    <p v-if="ruleHint" class="rule-hint">
      <strong class="rule-hint-headline">{{ ruleHint.headline }}</strong>
      <span class="rule-hint-detail">{{ ruleHint.detail }}</span>
    </p>

    <div v-if="checked" class="feedback-block">
      <div class="feedback" :class="wasCorrect ? 'ok' : 'no'">
        <strong>{{ wasCorrect ? 'Correct' : 'Answer:' }}</strong>
        <span lang="ru" class="answer-text">{{ exercise.ru }}</span>
        <SpeakButton :text="exercise.ru" />
      </div>
      <p v-if="exercise.audio && exercise.en" class="translation-hint">{{ exercise.en }}</p>
      <!-- About this word (#586) — only once the answer is resolved, right,
           wrong or given up on. A `build` fact spells the word out, so showing
           it any earlier would hand over the answer. -->
      <WordFacts v-if="factsKey" :word-key="factsKey" />
    </div>

    <div class="row check-row">
      <CelebrationBurst :show="showFire" emoji="🔥" />
      <!-- One button chain, so Next belongs to the answered state alone: while
           the question is open the only primary is Check. -->
      <template v-if="!checked">
        <button
          v-if="reorderMode"
          class="primary check"
          :disabled="!placed.length"
          @click="checkOrder"
        >
          Check
        </button>
        <button v-else class="primary check" :disabled="!typed.trim()" @click="check">Check</button>
        <!-- The learner ends the loop, not a counter (#588) — quietly, and out
             at the far end of the row, well away from where Next lands. -->
        <button
          v-if="!confirmingReveal"
          type="button"
          class="dunno"
          @click="confirmingReveal = true"
        >
          I don't know
        </button>
      </template>
      <button v-else class="primary next" @click="next">Next →</button>
    </div>

    <!-- Say what "I don't know" costs before it costs it: this is the one place
         the learner can lose the question without answering it. -->
    <div
      v-if="confirmingReveal && !checked"
      class="dunno-confirm"
      role="group"
      aria-label="Confirm showing the answer"
    >
      <p class="dunno-explain">
        This is an <strong>“I don’t know”</strong>, not a pass: the answer is shown, the question is
        marked wrong, and the word comes back for more practice.
      </p>
      <div class="row">
        <button type="button" class="reveal" @click="reveal">Show me the answer</button>
        <button type="button" class="keep-trying" @click="confirmingReveal = false">
          Keep trying
        </button>
      </div>
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
/* A diagnosed answer is a real word, so the correction teaches rather than
   rejects — amber like the close bands, never red. A synonym is better still:
   right knowledge, wrong slot. A regional variant stays amber: it is a real
   word, but the drill really does want the dictionary one, and green would say
   otherwise. */
.retry-hint.lexical,
.retry-hint.regional,
.retry-hint.synonym {
  display: grid;
  gap: 0.15rem;
  color: var(--gold);
}
.retry-hint.synonym {
  color: var(--ok, var(--gold));
}
.correction-headline {
  font-weight: 600;
}
.correction-detail {
  color: var(--text);
}
/* The rule reminder is neither praise nor rejection — it is the thing to
   remember, so it reads as a note rather than as a grade. */
.rule-hint {
  display: grid;
  gap: 0.15rem;
  margin: 0;
  padding: 0.5rem 0.6rem;
  border-left: 3px solid var(--primary);
  border-radius: 0 6px 6px 0;
  background: var(--card);
  font-size: 0.9rem;
  text-align: left;
}
.rule-hint-headline {
  font-weight: 600;
}
.rule-hint-detail {
  color: var(--muted);
}
/* An escape hatch, not a call to action: a quiet link pushed to the far end of
   the row, so it is never mistaken for the primary button — nor for Next, which
   takes that primary slot the moment the answer is in. */
.dunno {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--muted);
  text-decoration: underline;
  font-size: 0.85rem;
  padding: 0.4rem 0.2rem;
  cursor: pointer;
}
.dunno-confirm {
  display: grid;
  gap: 0.6rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-soft);
}
.dunno-explain {
  margin: 0;
  font-size: 0.9rem;
  color: var(--muted);
}
.reveal {
  font-size: 0.9rem;
  color: var(--muted);
  background: none;
}
.keep-trying {
  font-size: 0.9rem;
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
