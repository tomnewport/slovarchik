<script setup>
// In-context inflection drill (mastery). A real, correct sentence is shown with
// one word collapsed to its dictionary form. The learner works in two stages:
//   1. SELECT the grammatical slot — a sequence of picks, case first, then the
//      other dimension: number for nouns, gender + number for adjectives /
//      possessive pronouns. Personal pronouns pick case only; verbs skip it.
//   2. SPELL the correctly inflected form
// The descriptor is built by lib/phraseContext.js from an annotated usage
// example (an `inflect:` block in the vocab YAML). The full sentence is NEVER
// spoken until the form is correct — we never voice the ungrammatical
// lemma-in-slot version.
import { computed, nextTick, ref, onMounted } from 'vue'

import { normalize } from '../../lib/text.js'
import { speak } from '../../lib/speech.js'
import { playFeedback } from '../../stores/settings.js'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

// The ordered selection steps (case → number, or case → gender + number); empty
// for verbs. Each is { kind, prompt, options: [{ id, label, hint?, correct }] }.
const selectSteps = computed(() => props.exercise.selectSteps ?? [])
const hasSelect = computed(() => selectSteps.value.length > 0)

// step: 'select' → 'spell' → 'done'. Verbs start at 'spell'.
const step = ref(hasSelect.value ? 'select' : 'spell')
const selectIdx = ref(0) // which selection step the learner is on
const chosen = ref([]) // the option clicked at each selection step, in order
const typed = ref('')
const spellCorrect = ref(false)
const inputEl = ref(null)

const currentSelect = computed(() => selectSteps.value[selectIdx.value] ?? null)
// What the learner has picked so far, e.g. "Accusative" then "Accusative · Singular".
const pickedSoFar = computed(() => chosen.value.map((o) => o.label).join(' · '))

// Every selection step answered, and every one correct.
const selectCorrect = computed(
  () =>
    chosen.value.length === selectSteps.value.length &&
    chosen.value.every((o) => o.correct),
)
const overallCorrect = computed(() => selectCorrect.value && spellCorrect.value)

// The dimensions the learner got wrong (case / number / gender), worded for the
// feedback line — e.g. "case", "number", or "case and number".
const wrongDimsLabel = computed(() => {
  const names = selectSteps.value
    .map((s, i) => (chosen.value[i] && !chosen.value[i].correct ? s.kind : null))
    .filter(Boolean)
  if (names.length <= 1) return names[0] ?? ''
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
})

// The instructive near-miss: every slot was selected and the spelling matched,
// but at least one selection was wrong. Worth calling out clearly so the learner
// doesn't think their (correct) spelling was rejected.
const spellingOnlyMiss = computed(
  () =>
    hasSelect.value &&
    chosen.value.length === selectSteps.value.length &&
    !selectCorrect.value &&
    spellCorrect.value,
)

// Punctuation around the target token (e.g. a trailing full stop) is preserved
// so the slot doesn't drop it when we swap in the lemma / answer. Combining marks
// (the stress accent) stay with the word core, so they're excluded from the affix.
const slotAffix = computed(() => {
  const orig = props.exercise.tokens?.[props.exercise.targetIndex] ?? ''
  return {
    lead: orig.match(/^[^\p{L}\p{M}]*/u)?.[0] ?? '',
    trail: orig.match(/[^\p{L}\p{M}]*$/u)?.[0] ?? '',
  }
})

// The slot token: lemma until solved, the correct form once solved.
const slotText = computed(() => {
  const core = step.value === 'done' ? props.exercise.answerAccented : props.exercise.lemma
  return slotAffix.value.lead + core + slotAffix.value.trail
})

function chooseOption(opt) {
  if (step.value !== 'select') return
  chosen.value = [...chosen.value, opt]
  if (selectIdx.value < selectSteps.value.length - 1) {
    selectIdx.value += 1 // advance to the next selection step (e.g. case → number)
  } else {
    step.value = 'spell'
    nextTick(() => inputEl.value?.focus())
  }
}

function submitSpell() {
  if (step.value !== 'spell') return
  spellCorrect.value = normalize(typed.value) === props.exercise.answer
  step.value = 'done'
  playFeedback(overallCorrect.value)
  // Only now — with the form known correct — is it safe to voice the sentence.
  speak(props.exercise.ru)
}

function next() {
  emit('done', { correct: overallCorrect.value })
}

onMounted(() => {
  if (!hasSelect.value) nextTick(() => inputEl.value?.focus())
})
</script>

<template>
  <div class="grid" style="gap: 1rem">
    <p class="prompt-en muted">{{ exercise.en }}</p>

    <div class="phrase-line" lang="ru">
      <template v-for="(tok, i) in exercise.tokens" :key="i">
        <button
          v-if="i === exercise.targetIndex && step !== 'done'"
          class="target-btn"
          type="button"
          @click="() => inputEl?.focus()"
        >{{ slotText }}</button>
        <mark
          v-else-if="i === exercise.targetIndex"
          :class="overallCorrect ? 'mark-ok' : spellingOnlyMiss ? 'mark-warn' : 'mark-err'"
        >{{ slotText }}</mark>
        <span v-else>{{ tok }}</span>
      </template>
    </div>

    <!-- Stage 1 — work through the selection steps: case, then number / gender -->
    <div v-if="step === 'select'" class="grid" style="gap: 0.6rem">
      <p v-if="pickedSoFar" class="picked muted">
        <em lang="ru">{{ exercise.lemma }}</em> → {{ pickedSoFar }} · …
      </p>
      <p class="step-label muted">{{ currentSelect.prompt }}</p>
      <div class="case-grid">
        <button
          v-for="opt in currentSelect.options"
          :key="opt.id"
          type="button"
          class="case-btn"
          @click="chooseOption(opt)"
        >
          <strong>{{ opt.label }}</strong>
          <small v-if="opt.hint" class="muted">{{ opt.hint }}</small>
        </button>
      </div>
    </div>

    <!-- Step 2 — spell the form -->
    <template v-else>
      <p class="slot-label muted">
        <em lang="ru">{{ exercise.lemma }}</em> → {{ exercise.slotLabel }}
      </p>

      <form v-if="step === 'spell'" @submit.prevent="submitSpell" class="grid">
        <input
          ref="inputEl"
          v-model="typed"
          type="text"
          lang="ru"
          :data-answer="exercise.answerAccented"
          placeholder="наберите правильную форму"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <button type="submit" class="primary">Check</button>
      </form>

      <div v-else class="grid" style="gap: 0.75rem">
        <p class="feedback" :class="overallCorrect ? 'good' : spellingOnlyMiss ? 'warn' : 'bad'">
          <template v-if="overallCorrect">✓ Correct!</template>
          <template v-else-if="spellingOnlyMiss">
            ✓ Spelling right — but you picked the wrong {{ wrongDimsLabel }}.
            It needed <strong>{{ exercise.slotLabel }}</strong>.
          </template>
          <template v-else>✗ {{ exercise.answerAccented }}</template>
        </p>

        <!-- The full, correct sentence — safe to read aloud now. -->
        <p class="full-ru" lang="ru">
          {{ exercise.ru }}
          <SpeakButton :text="exercise.ru" />
        </p>

        <details v-if="exercise.rule" class="rule" :class="{ exception: exercise.exception }" open>
          <summary>
            <span v-if="exercise.exception" class="exc-badge">Exception</span>
            {{ exercise.rule.title }}
          </summary>
          <p v-if="exercise.rule.formula" class="formula" lang="ru">{{ exercise.rule.formula }}</p>
          <p v-if="exercise.rule.explanation" class="muted">{{ exercise.rule.explanation }}</p>
          <ul v-if="exercise.rule.exceptions?.length" class="exceptions muted">
            <li v-for="(ex, i) in exercise.rule.exceptions" :key="i" lang="ru">{{ ex }}</li>
          </ul>
        </details>

        <button class="primary next" @click="next">Next →</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.prompt-en {
  font-style: italic;
}
/* Flex + gap guarantees a visible space between every word chunk regardless of
   how the template's whitespace is condensed. */
.phrase-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.1rem 0.4rem;
  font-size: 1.4rem;
  line-height: 1.6;
  text-align: left;
}
.target-btn {
  padding: 0.05rem 0.3rem;
  font-size: inherit;
  font-family: inherit;
  border: 2px solid var(--primary);
  border-radius: 4px;
  background: color-mix(in srgb, var(--primary) 12%, var(--card));
  color: var(--primary);
  font-weight: 600;
  cursor: pointer;
}
.mark-ok {
  background: color-mix(in srgb, var(--good) 15%, transparent);
  border-radius: 3px;
  padding: 0 0.15rem;
  color: var(--good);
  font-weight: 600;
}
.mark-err {
  background: color-mix(in srgb, var(--bad) 15%, transparent);
  border-radius: 3px;
  padding: 0 0.15rem;
  color: var(--bad);
  font-weight: 600;
}
/* Spelling was right, only the case/form choice missed — the word shown in the
   sentence is the correct form, so don't flag it red as if it were wrong. */
.mark-warn {
  background: color-mix(in srgb, var(--warn, #c9962b) 18%, transparent);
  border-radius: 3px;
  padding: 0 0.15rem;
  color: var(--warn, #c9962b);
  font-weight: 600;
}
.feedback.warn {
  color: var(--warn, #c9962b);
}
.step-label {
  font-size: 0.95rem;
}
.picked {
  font-size: 0.9rem;
}
.case-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}
.case-btn {
  display: grid;
  gap: 0.1rem;
  padding: 0.5rem 0.6rem;
  text-align: left;
  border: 1px solid var(--border, #ccc);
  border-radius: 6px;
  background: var(--card);
  cursor: pointer;
}
.case-btn:hover {
  border-color: var(--primary);
}
.case-btn small {
  font-size: 0.75rem;
}
.slot-label {
  font-size: 0.9rem;
}
.full-ru {
  font-size: 1.2rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.rule {
  text-align: left;
  border: 1px solid var(--border, #ccc);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  background: color-mix(in srgb, var(--primary) 5%, var(--card));
}
.rule.exception {
  border-color: var(--warn, #c9962b);
  background: color-mix(in srgb, var(--warn, #c9962b) 8%, var(--card));
}
.rule summary {
  cursor: pointer;
  font-weight: 600;
}
.exc-badge {
  display: inline-block;
  margin-right: 0.4rem;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #fff;
  background: var(--warn, #c9962b);
  vertical-align: middle;
}
.formula {
  font-weight: 600;
  margin: 0.35rem 0;
}
.exceptions {
  margin: 0.25rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.85rem;
}
</style>
