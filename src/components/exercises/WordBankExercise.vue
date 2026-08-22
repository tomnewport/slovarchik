<script setup>
// Identification / hearing exercise: rebuild the English translation of a
// Russian phrase by tapping word tiles from a bank (with decoys). Covers
// translate-phrase (source shown) and listen-translate (source heard).
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  bankTokens,
  buildListeningBank,
  isQuestion,
  listeningTokens,
  listeningWordPool,
  phraseCorrect,
  phraseCorrectBagOfWords,
} from '../../lib/phrases.js'
import { speak } from '../../lib/speech.js'
import { phrases } from '../../stores/vocab.js'
import { playFeedback } from '../../stores/settings.js'
import HintablePhrase from '../HintablePhrase.vue'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done', 'dispute'])

// How many decoy tiles to mix in. Tripled from the original 3 so the bank has
// markedly more distractors to find the target words among.
const DECOY_COUNT = 9
// Generic fillers used as a fallback when the real phrase vocabulary is thin
// (e.g. in unit tests, where the vocab store is empty). Kept large enough to
// satisfy DECOY_COUNT on its own.
const FILLERS = [
  'the', 'a', 'and', 'to', 'is', 'in', 'of', 'it', 'you', 'we',
  'on', 'at', 'for', 'with', 'this', 'that', 'they', 'not', 'he', 'she',
]
// Draw decoys from every known phrase's English so the distractors look like
// real vocabulary, falling back to the generic fillers. Deduplicated because
// buildListeningBank samples without dedup.
const decoyPool = [...new Set([...listeningWordPool(phrases.value), ...FILLERS])]
// Build the bank from the primary translation AND its accepted alternates, so
// an answer this drill would grade as correct can actually be assembled. Until
// #581 the tiles came from the primary alone while check() accepted `enAlt`,
// which made ~90% of the corpus's alternates unreachable.
//
// Every extra tile an alternate contributes is itself a distractor for the
// primary reading, so they are subtracted from the decoy budget rather than
// added on top — otherwise a phrase with alternates would face a much bigger
// bank than one without.
const altTiles = computed(() => {
  const alts = props.exercise.enAlt ?? []
  return alts.length ? bankTokens(props.exercise.en, alts).length - listeningTokens(props.exercise.en).length : 0
})
const bank = ref(
  buildListeningBank(props.exercise.en, decoyPool, Math.max(0, DECOY_COUNT - altTiles.value), Math.random, {
    alts: props.exercise.enAlt ?? [],
  }),
)
const placed = ref([])
const checked = ref(false)
const wasCorrect = ref(false)
// Set when the answer uses exactly the right words but in a different order
// (#267). Word order can carry meaning, so instead of auto-crediting we ask the
// learner to self-confirm their reordering is a faithful translation before it
// counts. Cleared once they decide either way.
const needsConfirm = ref(false)
// What the learner is currently typing to find a tile (type-ahead). Lowercased
// prefix matched against the available (not-yet-placed) tiles.
const typed = ref('')
// Honesty system: a phrase can have several valid English renderings we don't
// all store. If the learner believes a "wrong" grade was actually right, they
// can override it — crediting the attempt and reporting it for curation.
const overridden = ref(false)

// In listen mode the "?" is only heard, and browser TTS rarely conveys the
// rising question intonation, so flag questions in the prompt (#514).
const showQuestionCue = computed(() => props.exercise.audio && isQuestion(props.exercise.ru))

const placedIds = computed(() => new Set(placed.value.map((t) => t.id)))
const assembled = computed(() => placed.value.map((t) => t.text).join(' '))

// The correct tile sequence, exposed (JSON) for e2e answer recovery (#322). The
// same tokens the feedback line shows once checked, made machine-readable so a
// test can tap them in order without solving the translation itself.
const answerTokens = computed(() => JSON.stringify(listeningTokens(props.exercise.en)))

// Tiles still available to place, in bank order.
const available = computed(() => bank.value.filter((t) => !placedIds.value.has(t.id)))
// The available tiles whose text begins with the typed prefix.
const matches = computed(() =>
  typed.value ? available.value.filter((t) => t.text.toLowerCase().startsWith(typed.value)) : [],
)
const matchIds = computed(() => new Set(matches.value.map((t) => t.id)))
// The tile Enter/Space would place — the first match in bank order.
const firstMatch = computed(() => matches.value[0] ?? null)

function pick(tile) {
  if (checked.value || placedIds.value.has(tile.id)) return
  placed.value.push(tile)
  typed.value = ''
}
function unpick(tile) {
  if (checked.value) return
  placed.value = placed.value.filter((t) => t.id !== tile.id)
}

// Physical-keyboard type-ahead: typing letters narrows the highlighted tiles;
// Enter or Space places the first match; Backspace/Escape edit the prefix.
// Clicking tiles still works exactly as before — this only speeds up finding
// the right word in a large bank.
function onKey(e) {
  if (checked.value || e.metaKey || e.ctrlKey || e.altKey) return
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
  const k = e.key
  if (k === 'Enter' || k === ' ') {
    if (firstMatch.value) {
      e.preventDefault()
      pick(firstMatch.value)
    }
    return
  }
  if (k === 'Backspace') {
    if (typed.value) {
      e.preventDefault()
      typed.value = typed.value.slice(0, -1)
    }
    return
  }
  if (k === 'Escape') {
    typed.value = ''
    return
  }
  // Accept a letter (or contraction apostrophe) only if it keeps at least one
  // matching tile, so the prefix can't wander off into something unplaceable.
  if (k.length === 1 && /[a-z']/i.test(k)) {
    const next = typed.value + k.toLowerCase()
    if (available.value.some((t) => t.text.toLowerCase().startsWith(next))) {
      e.preventDefault()
      typed.value = next
    }
  }
}

function check() {
  if (checked.value) return
  // Accept the primary translation or any curated alternate rendering (#145,
  // #168, #169).
  const accepted = [props.exercise.en, ...(props.exercise.enAlt ?? [])]
  checked.value = true
  if (phraseCorrect(assembled.value, accepted)) {
    // Exact match (bar articles/case/stress/punctuation) — pass outright.
    wasCorrect.value = true
    playFeedback(true)
  } else if (phraseCorrectBagOfWords(assembled.value, accepted)) {
    // Right words, different order (#267). English word order is freer than
    // Russian so this is *usually* a valid reordering — but not always (word
    // order can flip the meaning), so let the learner self-confirm rather than
    // auto-crediting. No feedback sound yet: the grade is still pending.
    needsConfirm.value = true
  } else {
    // Wrong or missing words.
    wasCorrect.value = false
    playFeedback(false)
  }
}

// Learner self-confirms their reordering is a faithful translation.
function confirmCorrect() {
  if (!needsConfirm.value) return
  needsConfirm.value = false
  wasCorrect.value = true
  playFeedback(true)
}

// Learner realises their reordering changed the meaning — grade it wrong.
function rejectConfirm() {
  if (!needsConfirm.value) return
  needsConfirm.value = false
  wasCorrect.value = false
  playFeedback(false)
}

function markCorrect() {
  if (!checked.value || wasCorrect.value || needsConfirm.value) return
  overridden.value = true
  wasCorrect.value = true
  playFeedback(true)
  // Report the disputed grading so a genuinely-missing translation can be
  // folded into the vocab data later.
  emit('dispute', { submitted: assembled.value })
}

function next() {
  emit('done', { correct: wasCorrect.value })
}

onMounted(() => {
  // The Russian is the subject here whether it's heard (listen-translate) or
  // shown (translate-phrase), so read it aloud as soon as the exercise appears.
  speak(props.exercise.ru)
  window.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="grid" style="gap: 1rem" :data-answer-tokens="answerTokens">
    <div class="prompt">
      <template v-if="exercise.audio">
        <span class="muted">Translate what you hear</span>
        <SpeakButton :text="exercise.ru" />
        <span v-if="showQuestionCue" class="q-cue" title="This sentence is a question">
          ❓ question
        </span>
      </template>
      <HintablePhrase v-else :text="exercise.ru" mode="inline" class="cue" />
    </div>

    <div class="answer-line card" :aria-label="assembled">
      <button
        v-for="tile in placed"
        :key="tile.id"
        type="button"
        class="tile placed"
        :disabled="checked"
        @click="unpick(tile)"
      >
        {{ tile.text }}
      </button>
      <span v-if="!placed.length" class="muted">Tap the words in order…</span>
    </div>

    <div class="bank">
      <button
        v-for="tile in bank"
        :key="tile.id"
        type="button"
        class="tile"
        :class="{ match: matchIds.has(tile.id), 'match-first': firstMatch && firstMatch.id === tile.id }"
        :disabled="checked || placedIds.has(tile.id)"
        @click="pick(tile)"
      >
        {{ tile.text }}
      </button>
    </div>

    <p v-if="!checked" class="typeahead muted">
      <template v-if="typed">
        Typing <strong>{{ typed }}</strong
        ><span v-if="!firstMatch"> — no match</span>
        <span v-else> · press Enter to place</span>
      </template>
      <template v-else>Tap a word, or just type to find it.</template>
    </p>

    <!-- Right words, different order: ask the learner to self-check meaning. -->
    <div v-if="needsConfirm" class="confirm">
      <!-- The learner can only judge whether their order still fits when they can
           see the sentence they were translating. In listen mode it was only
           heard, so reveal it now (with audio) — otherwise there's nothing to
           check the reordering against (#408). -->
      <p v-if="exercise.audio" class="confirm-source" lang="ru">
        {{ exercise.ru }}
        <SpeakButton :text="exercise.ru" />
      </p>
      <p class="confirm-q">
        Same words, different order. Does your translation mean the same thing?
      </p>
      <!-- Show the learner's answer next to the default English translation so
           the two can be compared directly — the learner can't judge whether a
           reordering is faithful without seeing what it's being judged against
           (#513). -->
      <dl class="confirm-compare">
        <div class="compare-row">
          <dt>Yours</dt>
          <dd>{{ assembled }}</dd>
        </div>
        <div class="compare-row">
          <dt>Default</dt>
          <dd>{{ listeningTokens(exercise.en).join(' ') }}</dd>
        </div>
      </dl>
      <div class="row">
        <button type="button" class="primary" @click="confirmCorrect">Yes, it's correct</button>
        <button type="button" @click="rejectConfirm">No, I was wrong</button>
      </div>
    </div>

    <template v-else-if="checked">
      <div class="feedback" :class="wasCorrect ? 'ok' : 'no'">
        <strong>{{ overridden ? 'Marked correct' : wasCorrect ? 'Correct' : 'Answer:' }}</strong>
        <span>{{ listeningTokens(exercise.en).join(' ') }}</span>
      </div>

      <p v-if="!wasCorrect" class="dispute">
        Sure your translation also works?
        <button type="button" class="link" @click="markCorrect">I was right →</button>
      </p>
    </template>

    <div class="row">
      <button v-if="!checked" class="primary check" :disabled="!placed.length" @click="check">
        Check
      </button>
      <button v-else-if="!needsConfirm" class="primary next" @click="next">Next →</button>
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
.q-cue {
  font-size: 0.85rem;
  color: var(--muted);
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  white-space: nowrap;
}
.answer-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  min-height: 3rem;
  align-items: center;
}
.bank {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.tile {
  padding: 0.5rem 0.8rem;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
  font-size: 1.05rem;
}
.tile.placed {
  border-color: var(--primary);
}
.tile.match {
  border-color: var(--primary);
  background: var(--bg-soft);
}
.tile.match-first {
  background: var(--primary);
  color: var(--bg);
  border-color: var(--primary);
}
.typeahead {
  margin: 0;
  font-size: 0.85rem;
  min-height: 1.2rem;
}
.typeahead strong {
  color: var(--primary);
}
.confirm {
  display: grid;
  gap: 0.6rem;
}
.confirm-source {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.3rem;
}
.confirm-q {
  margin: 0;
  font-size: 0.95rem;
}
.confirm-compare {
  margin: 0;
  display: grid;
  gap: 0.35rem;
}
.compare-row {
  display: grid;
  grid-template-columns: 4.5rem 1fr;
  gap: 0.5rem;
  align-items: baseline;
}
.compare-row dt {
  margin: 0;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--muted);
}
.compare-row dd {
  margin: 0;
  font-size: 1.05rem;
}
.feedback {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem;
}
.feedback.ok strong {
  color: var(--good);
}
.feedback.no strong {
  color: var(--bad);
}
.dispute {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
}
.dispute .link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--primary);
  cursor: pointer;
  text-decoration: underline;
}
</style>
