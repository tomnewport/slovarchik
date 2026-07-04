<script setup>
// In-context inflection drill (mastery), run over a small SET of sentences.
// Each item is a real, correct sentence with one word collapsed to its
// dictionary form; the learner works through the set one sentence at a time:
//   1. SELECT the grammatical slot — every dimension (case, number, gender,
//      aspect) is picked on one compact board and checked together
//   2. SPELL the correctly inflected form
// Feedback (and the linked grammar rule) follows each sentence; solved
// sentences stay visible above the current one. The descriptor is built by
// lib/exerciseBuild.js (a set) or lib/phraseContext.js (a single sentence — a
// bare descriptor is treated as a set of one). A set drills one lexical item —
// a word or its aspect pair, so its items may still span two word keys — and
// the exercise reports per-word results via `wrong`. The full sentence is
// NEVER spoken until its form is spelled — we never voice the ungrammatical
// lemma-in-slot version.
import { computed, nextTick, ref, onMounted } from 'vue'

import { normalize } from '../../lib/text.js'
import { speak } from '../../lib/speech.js'
import { playFeedback } from '../../stores/settings.js'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ exercise: { type: Object, required: true } })
const emit = defineEmits(['done'])

// A set descriptor carries `items`; a bare single-sentence descriptor (the
// standalone /phrase-fix view, or the aspect drill's spelling stage) is a set
// of one.
const items = computed(() => props.exercise.items ?? [props.exercise])
const itemIdx = ref(0)
const item = computed(() => items.value[itemIdx.value])

// The selection board's groups (case / number / gender / aspect) for the
// current item. Each is { kind, prompt, options: [{ id, label, hint?, correct }] }.
const selectSteps = computed(() => item.value.selectSteps ?? [])
const hasSelect = computed(() => selectSteps.value.length > 0)

// Per-item stage: 'select' → 'spell' → 'done'. Items with nothing to select
// (unpaired verbs) start at 'spell'.
const stage = ref(hasSelect.value ? 'select' : 'spell')
const picks = ref([]) // group index → the option currently chosen (re-pickable until Check)
const typed = ref('')
const spellCorrect = ref(false)
const inputEl = ref(null)
// Finished items, oldest first: { ru, correct, warn } (warn = spelling right,
// selection wrong — shown amber, not red).
const results = ref([])

// Every group picked (the Check button's gate)…
const allPicked = computed(() =>
  selectSteps.value.every((_, i) => picks.value[i] != null),
)
// …and, once checked, was every pick correct?
const selectCorrect = computed(
  () => hasSelect.value === false || selectSteps.value.every((s, i) => picks.value[i]?.correct),
)
const overallCorrect = computed(() => selectCorrect.value && spellCorrect.value)

// Whether the aspect group was answered wrong — the feedback then names the
// verb that was needed, not just its grammatical slot.
const aspectMissed = computed(() =>
  selectSteps.value.some((s, i) => s.kind === 'aspect' && picks.value[i] && !picks.value[i].correct),
)

// The dimensions the learner got wrong (case / number / gender / aspect),
// worded for the feedback line — e.g. "case", "number", or "case and number".
const wrongDimsLabel = computed(() => {
  const names = selectSteps.value
    .map((s, i) => (picks.value[i] && !picks.value[i].correct ? s.kind : null))
    .filter(Boolean)
  if (names.length <= 1) return names[0] ?? ''
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
})

// The instructive near-miss: the spelling matched but at least one selection
// was wrong. Worth calling out clearly so the learner doesn't think their
// (correct) spelling was rejected.
const spellingOnlyMiss = computed(
  () => hasSelect.value && !selectCorrect.value && spellCorrect.value,
)

// Punctuation around the target token (e.g. a trailing full stop) is preserved
// so the slot doesn't drop it when we swap in the lemma / answer. Combining marks
// (the stress accent) stay with the word core, so they're excluded from the affix.
const slotAffix = computed(() => {
  const orig = item.value.tokens?.[item.value.targetIndex] ?? ''
  return {
    lead: orig.match(/^[^\p{L}\p{M}]*/u)?.[0] ?? '',
    trail: orig.match(/[^\p{L}\p{M}]*$/u)?.[0] ?? '',
  }
})

// An aspect drill must not leak which partner is correct, so until the board is
// checked the slot shows every candidate infinitive (impf / pf).
const lemmaChoicesVisible = computed(
  () =>
    stage.value === 'select' &&
    (item.value.lemmaOptions?.length ?? 0) > 0 &&
    selectSteps.value.some((s) => s.kind === 'aspect'),
)

// The slot token: the candidate lemma(s) until solved, the correct form after.
const slotText = computed(() => {
  const core =
    stage.value === 'done'
      ? item.value.answerAccented
      : lemmaChoicesVisible.value
        ? item.value.lemmaOptions.join(' / ')
        : item.value.lemma
  return slotAffix.value.lead + core + slotAffix.value.trail
})

function pickOption(groupIdx, opt) {
  if (stage.value !== 'select') return
  const next = picks.value.slice()
  next[groupIdx] = opt
  picks.value = next
}

// Commit the board: the picks are locked in and the spelling stage opens
// (showing the slot the sentence actually needs, exactly as before).
function checkSelection() {
  if (stage.value !== 'select' || !allPicked.value) return
  stage.value = 'spell'
  nextTick(() => inputEl.value?.focus())
}

function submitSpell() {
  if (stage.value !== 'spell') return
  spellCorrect.value = normalize(typed.value) === item.value.answer
  stage.value = 'done'
  playFeedback(overallCorrect.value)
  // Only now — with the form known correct — is it safe to voice the sentence.
  speak(item.value.ru)
}

const isLast = computed(() => itemIdx.value >= items.value.length - 1)

function next() {
  results.value = [
    ...results.value,
    {
      ru: item.value.ru,
      key: (item.value.targets ?? [])[0] ?? null,
      correct: overallCorrect.value,
      warn: spellingOnlyMiss.value,
    },
  ]
  if (!isLast.value) {
    itemIdx.value += 1
    stage.value = (items.value[itemIdx.value].selectSteps ?? []).length ? 'select' : 'spell'
    picks.value = []
    typed.value = ''
    spellCorrect.value = false
    if (stage.value === 'spell') nextTick(() => inputEl.value?.focus())
    return
  }
  emit('done', {
    correct: results.value.every((r) => r.correct),
    // Per-word results: a set spans several words, and only the missed ones
    // should record a wrong attempt.
    wrong: results.value.filter((r) => !r.correct && r.key).map((r) => r.key),
  })
}

onMounted(() => {
  if (!hasSelect.value) nextTick(() => inputEl.value?.focus())
})
</script>

<template>
  <div class="grid" style="gap: 1rem">
    <p v-if="items.length > 1" class="set-progress muted">
      Sentence {{ itemIdx + 1 }} of {{ items.length }}
    </p>

    <!-- Sentences already solved this set stay visible for context. -->
    <ul v-if="results.length" class="done-list">
      <li
        v-for="(r, i) in results"
        :key="i"
        class="done-item"
        :class="r.correct ? 'good' : r.warn ? 'warn' : 'bad'"
        lang="ru"
      >
        <span class="done-mark">{{ r.correct ? '✓' : r.warn ? '≈' : '✗' }}</span>
        {{ r.ru }}
      </li>
    </ul>

    <p class="prompt-en muted">{{ item.en }}</p>

    <div class="phrase-line" lang="ru">
      <template v-for="(tok, i) in item.tokens" :key="i">
        <button
          v-if="i === item.targetIndex && stage !== 'done'"
          class="target-btn"
          type="button"
          @click="() => inputEl?.focus()"
        >{{ slotText }}</button>
        <mark
          v-else-if="i === item.targetIndex"
          :class="overallCorrect ? 'mark-ok' : spellingOnlyMiss ? 'mark-warn' : 'mark-err'"
        >{{ slotText }}</mark>
        <span v-else>{{ tok }}</span>
      </template>
    </div>

    <!-- Stage 1 — one compact board: every dimension picked, then checked together -->
    <div v-if="stage === 'select'" class="grid" style="gap: 0.75rem">
      <fieldset v-for="(step, si) in selectSteps" :key="step.kind" class="select-group">
        <legend class="step-label muted">{{ step.prompt }}</legend>
        <div class="case-grid" :class="{ narrow: step.options.length <= 4 && step.kind !== 'aspect' }">
          <button
            v-for="opt in step.options"
            :key="opt.id"
            type="button"
            class="case-btn"
            :class="{ selected: picks[si]?.id === opt.id }"
            :aria-pressed="picks[si]?.id === opt.id"
            @click="pickOption(si, opt)"
          >
            <strong>{{ opt.label }}</strong>
            <small v-if="opt.hint" class="muted">{{ opt.hint }}</small>
          </button>
        </div>
      </fieldset>
      <button type="button" class="primary check-select" :disabled="!allPicked" @click="checkSelection">
        Check
      </button>
    </div>

    <!-- Stage 2 — spell the form -->
    <template v-else>
      <p class="slot-label muted">
        <em lang="ru">{{ item.lemma }}</em> → {{ item.slotLabel }}
      </p>

      <form v-if="stage === 'spell'" @submit.prevent="submitSpell" class="grid">
        <input
          ref="inputEl"
          v-model="typed"
          type="text"
          lang="ru"
          :data-answer="item.answerAccented"
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
            It needed
            <strong v-if="aspectMissed" lang="ru">{{ item.lemma }}</strong>
            <strong v-else>{{ item.slotLabel }}</strong>.
          </template>
          <template v-else>✗ {{ item.answerAccented }}</template>
        </p>

        <!-- The full, correct sentence — safe to read aloud now. -->
        <p class="full-ru" lang="ru">
          {{ item.ru }}
          <SpeakButton :text="item.ru" />
        </p>

        <details v-if="item.rule" class="rule" :class="{ exception: item.exception }" open>
          <summary>
            <span v-if="item.exception" class="exc-badge">Exception</span>
            {{ item.rule.title }}
          </summary>
          <p v-if="item.rule.formula" class="formula" lang="ru">{{ item.rule.formula }}</p>
          <p v-if="item.rule.explanation" class="muted">{{ item.rule.explanation }}</p>
          <ul v-if="item.rule.exceptions?.length" class="exceptions muted">
            <li v-for="(ex, i) in item.rule.exceptions" :key="i" lang="ru">{{ ex }}</li>
          </ul>
        </details>

        <!-- Why this aspect: shown whenever the item carried an aspect choice,
             expanded when that choice went wrong. -->
        <details v-if="item.aspectRule" class="rule" :open="aspectMissed">
          <summary>{{ item.aspectRule.title }}</summary>
          <p v-if="item.aspectRule.formula" class="formula" lang="ru">{{ item.aspectRule.formula }}</p>
          <p v-if="item.aspectRule.explanation" class="muted">{{ item.aspectRule.explanation }}</p>
          <ul v-if="item.aspectRule.exceptions?.length" class="exceptions muted">
            <li v-for="(ex, i) in item.aspectRule.exceptions" :key="i" lang="ru">{{ ex }}</li>
          </ul>
        </details>

        <button class="primary next" @click="next">
          {{ isLast ? 'Next →' : 'Next sentence →' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.prompt-en {
  font-style: italic;
}
.set-progress {
  font-size: 0.85rem;
  margin: 0;
}
.done-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}
.done-item {
  font-size: 0.95rem;
  text-align: left;
}
.done-item.good {
  color: var(--good);
}
.done-item.warn {
  color: var(--warn, #c9962b);
}
.done-item.bad {
  color: var(--bad);
}
.done-mark {
  display: inline-block;
  width: 1.1rem;
  font-weight: 700;
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
.select-group {
  border: 0;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
  text-align: left;
}
.select-group legend {
  padding: 0;
}
.case-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}
/* Short single-word options (number / gender chips) sit four to a row. */
.case-grid.narrow {
  grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr));
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
.case-btn.selected {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--card));
  box-shadow: inset 0 0 0 1px var(--primary);
}
.case-btn small {
  font-size: 0.75rem;
}
.check-select {
  justify-self: start;
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
