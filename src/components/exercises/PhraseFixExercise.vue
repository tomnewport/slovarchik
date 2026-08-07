<script setup>
// In-context inflection drill (mastery), run over a small SET of sentences.
// Each item is a real, correct sentence with one word collapsed to its
// dictionary form; the learner works through the set one sentence at a time:
//   1. SELECT the grammatical slot — every dimension (case, number, gender,
//      aspect) is picked on one compact board. Each pick is graded THE MOMENT
//      it's tapped: a right pick locks its group green, a wrong pick flashes red
//      and the learner tries again — so nobody spells a form for a slot they've
//      picked wrong. A dimension that took a wrong pick still counts as a miss.
//   2. SPELL the correctly inflected form. A wrong spelling reveals what was
//      typed against the correct form, character by character, so a subtle slip
//      (a stray accent, a look-alike letter) is visible.
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
import { revealDiff } from '../../lib/spellReveal.js'
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
// group index → the correct option, once the learner has chosen it (the group
// is then locked). Groups with no entry are still open.
const resolved = ref([])
// group index → the ids the learner tapped that were wrong (kept flagged red).
const wrongTried = ref([])
// The dimensions (kinds) the learner ever picked wrong — the grade's memory,
// even though the pick is corrected before spelling.
const missed = ref([])
const typed = ref('')
const spellCorrect = ref(false)
const inputEl = ref(null)
// Finished items, oldest first: { ru, correct, warn } (warn = spelling right,
// selection wrong — shown amber, not red).
const results = ref([])

// Every group has its correct option chosen — the gate to the spelling stage.
const allResolved = computed(() => selectSteps.value.every((_, i) => resolved.value[i]))
// A selection dimension was picked wrong at least once this item.
const selectMissed = computed(() => missed.value.length > 0)
const overallCorrect = computed(() => !selectMissed.value && spellCorrect.value)

// Whether the aspect group was ever answered wrong — the feedback then names the
// verb that was needed, not just its grammatical slot.
const aspectMissed = computed(() => missed.value.includes('aspect'))

// The dimensions the learner got wrong (case / number / gender / aspect),
// worded for the feedback line — e.g. "case", "number", or "case and number".
const wrongDimsLabel = computed(() => {
  const names = selectSteps.value.map((s) => s.kind).filter((k) => missed.value.includes(k))
  if (names.length <= 1) return names[0] ?? ''
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
})

// The instructive near-miss: the spelling matched but a selection was picked
// wrong. Worth calling out clearly so the learner doesn't think their (correct)
// spelling was rejected.
const spellingOnlyMiss = computed(() => selectMissed.value && spellCorrect.value)

// Character-by-character reveal of a wrong spelling: what was typed against the
// correct accented form, mismatches flagged on both rows.
const spellReveal = computed(() => revealDiff(typed.value, item.value.answerAccented))

// Punctuation around the target token (e.g. a trailing full stop) is preserved
// so the slot doesn't drop it when we swap in the lemma / answer. Combining marks
// (the stress accent) stay with the word core, so they're excluded from the affix.
const slotAffix = computed(() => {
  const tokens = item.value.tokens ?? []
  const start = item.value.targetIndex
  // Lead punctuation from the first covered token, trail from the last — a
  // multi-word slot spans several tokens (день рожде́ния … горо́шек?).
  const first = tokens[start] ?? ''
  const last = tokens[start + (item.value.span ?? 1) - 1] ?? ''
  return {
    lead: first.match(/^[^\p{L}\p{M}]*/u)?.[0] ?? '',
    trail: last.match(/[^\p{L}\p{M}]*$/u)?.[0] ?? '',
  }
})

// An aspect drill must not leak which partner is correct, so until the aspect is
// picked the slot shows every candidate infinitive (impf / pf).
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

// Grade a tap the instant it lands. A correct pick locks the group (and, once
// every group is settled, opens the spelling stage); a wrong pick is flagged red
// and remembered as a miss, but the group stays open for another try.
function pickOption(groupIdx, step, opt) {
  if (stage.value !== 'select' || resolved.value[groupIdx]) return
  if (opt.correct) {
    const next = resolved.value.slice()
    next[groupIdx] = opt
    resolved.value = next
    playFeedback(true)
    if (allResolved.value) {
      stage.value = 'spell'
      nextTick(() => inputEl.value?.focus())
    }
    return
  }
  if (!missed.value.includes(step.kind)) missed.value = [...missed.value, step.kind]
  const tried = wrongTried.value.slice()
  tried[groupIdx] = [...(tried[groupIdx] ?? []), opt.id]
  wrongTried.value = tried
  playFeedback(false)
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
    resolved.value = []
    wrongTried.value = []
    missed.value = []
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
        <!-- Tokens covered by a multi-word slot are drawn as part of the slot above. -->
        <template v-else-if="i > item.targetIndex && i < item.targetIndex + (item.span ?? 1)" />
        <span v-else>{{ tok }}</span>
      </template>
    </div>

    <!-- Stage 1 — one compact board: each dimension graded the moment it's tapped -->
    <div v-if="stage === 'select'" class="grid" style="gap: 0.75rem">
      <fieldset v-for="(step, si) in selectSteps" :key="step.kind" class="select-group">
        <legend class="step-label muted">{{ step.prompt }}</legend>
        <!-- Options that carry a usage hint (aspect, degree) need the roomier
             two-column grid; bare chips (gender, number) sit four to a row. -->
        <div
          class="case-grid"
          :class="{ narrow: step.options.length <= 4 && !step.options.some((o) => o.hint) }"
        >
          <button
            v-for="opt in step.options"
            :key="opt.id"
            type="button"
            class="case-btn"
            :data-correct="opt.correct ? 'true' : 'false'"
            :class="{
              correct: resolved[si]?.id === opt.id,
              wrong: (wrongTried[si] ?? []).includes(opt.id),
            }"
            :disabled="!!resolved[si]"
            @click="pickOption(si, step, opt)"
          >
            <span class="case-body">
              <strong>{{ opt.label }}</strong>
              <small v-if="opt.hint" class="muted">{{ opt.hint }}</small>
            </span>
            <span
              v-if="resolved[si]?.id === opt.id"
              class="pick-mark ok"
              aria-hidden="true"
            >✓</span>
            <span
              v-else-if="(wrongTried[si] ?? []).includes(opt.id)"
              class="pick-mark no"
              aria-hidden="true"
            >✗</span>
          </button>
        </div>
      </fieldset>
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
        <div class="feedback-block">
          <p class="feedback" :class="overallCorrect ? 'good' : spellingOnlyMiss ? 'warn' : 'bad'">
            <template v-if="overallCorrect">✓ Correct!</template>
            <template v-else-if="spellingOnlyMiss">
              ✓ Spelling right — but you picked the wrong {{ wrongDimsLabel }}.
              It needed
              <strong v-if="aspectMissed" lang="ru">{{ item.lemma }}</strong>
              <strong v-else>{{ item.slotLabel }}</strong>.
            </template>
            <template v-else>✗ Not quite — compare your answer below.</template>
          </p>

          <!-- Spelling missed: what was typed vs. the correct form, character by
               character, so a subtle slip (a stray accent, a look-alike letter)
               is visible where a bare answer reveal could not show it. -->
          <dl v-if="!spellCorrect" class="spell-diff">
            <div class="diff-row">
              <dt class="diff-label muted">You typed</dt>
              <dd class="diff-text" lang="ru">
                <template v-if="spellReveal.typed.length">
                  <span
                    v-for="(u, k) in spellReveal.typed"
                    :key="k"
                    :class="{ off: !u.ok }"
                  >{{ u.text }}</span>
                </template>
                <em v-else class="muted">(nothing)</em>
              </dd>
            </div>
            <div class="diff-row">
              <dt class="diff-label muted">Correct</dt>
              <dd class="diff-text" lang="ru">
                <span
                  v-for="(u, k) in spellReveal.answer"
                  :key="k"
                  :class="{ off: !u.ok }"
                >{{ u.text }}</span>
              </dd>
            </div>
          </dl>

          <!-- Spelling and a selection both missed: name the slot it needed too. -->
          <p v-if="!spellCorrect && selectMissed" class="diff-note muted">
            You also picked the wrong {{ wrongDimsLabel }} — it needed {{ item.slotLabel }}.
          </p>
        </div>

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
.feedback.good {
  color: var(--good);
}
.feedback.warn {
  color: var(--warn, #c9962b);
}
.feedback.bad {
  color: var(--bad);
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.5rem 0.6rem;
  text-align: left;
  border: 1px solid var(--border, #ccc);
  border-radius: 6px;
  background: var(--card);
  cursor: pointer;
}
.case-body {
  display: grid;
  gap: 0.1rem;
}
.case-btn:hover:not(:disabled) {
  border-color: var(--primary);
}
/* Graded the instant it's tapped: a right pick locks green, a wrong pick reds. */
.case-btn.correct {
  border-color: var(--good);
  background: color-mix(in srgb, var(--good) 14%, var(--card));
  box-shadow: inset 0 0 0 1px var(--good);
  color: var(--good);
  cursor: default;
}
.case-btn.wrong {
  border-color: var(--bad);
  background: color-mix(in srgb, var(--bad) 12%, var(--card));
  color: var(--bad);
}
/* A locked (resolved) group's other options fade back. */
.case-btn:disabled:not(.correct):not(.wrong) {
  opacity: 0.5;
  cursor: default;
}
.case-btn small {
  font-size: 0.75rem;
}
.pick-mark {
  font-weight: 700;
  font-size: 1.05rem;
  flex: 0 0 auto;
}
.pick-mark.ok {
  color: var(--good);
}
.pick-mark.no {
  color: var(--bad);
}
.slot-label {
  font-size: 0.9rem;
}
.feedback-block {
  display: grid;
  gap: 0.5rem;
  text-align: left;
}
/* What the learner typed against the correct form, aligned character by
   character. Monospace so the two rows line up under each other. */
.spell-diff {
  margin: 0;
  display: grid;
  gap: 0.25rem;
}
.diff-row {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}
.diff-label {
  flex: 0 0 5rem;
  font-size: 0.8rem;
}
.diff-text {
  font-family: ui-monospace, monospace;
  font-size: 1.2rem;
  letter-spacing: 0.03em;
  word-break: break-word;
}
/* The differing characters — a wrong/extra letter typed, or a needed letter the
   answer has that the attempt didn't line up with. */
.diff-text .off {
  color: var(--bad);
  text-decoration: underline wavy;
  background: color-mix(in srgb, var(--bad) 12%, transparent);
  border-radius: 3px;
}
.diff-note {
  margin: 0;
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
