<script setup>
// Exercise 4 — type every ending with no assistance. Stems are shown; the
// learner fills one input per cell. A blank input is correct for a zero ending.
//
// With `allowRetry` (the in-session mastery drill), a first imperfect check is
// not graded: the wrong cells are marked — without revealing the answers — and
// a `retry` event lets the parent unlock the keyboard hint for a second, aided
// try, mirroring TypeExercise's try-before-hint flow (#keyboard-hints).
import { computed, onMounted, reactive, ref } from 'vue'

import { cellKey, endingOf } from '../../lib/paradigm.js'
import { stripStress, normalize } from '../../lib/text.js'
import { ruleReminder, spellingRuleMiss } from '../../lib/ruleOracle.js'
import { speak } from '../../lib/speech.js'
import { state as vocabState } from '../../stores/vocab.js'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({
  paradigm: { type: Object, required: true },
  allowRetry: { type: Boolean, default: false },
})
const emit = defineEmits(['graded', 'retry'])

const endings = {}
const stems = {}
for (const cell of props.paradigm.cells) {
  const key = cellKey(cell.row, cell.col)
  const ending = endingOf(props.paradigm, cell)
  endings[key] = ending
  stems[key] = stripStress(cell.form).slice(0, stripStress(cell.form).length - ending.length)
}

const entries = reactive({})
const checked = ref(false)
// One unaided attempt has been spent; the second check grades for real.
const retried = ref(false)
// Cells wrong at the first check — marked (not corrected) while retrying.
const firstTryWrong = ref(new Set())

function cellAt(row, col) {
  return props.paradigm.cells.find((c) => c.row === row && c.col === col)
}

function correctCell(key) {
  return normalize(entries[key] ?? '') === normalize(endings[key])
}

const allCorrect = computed(() => props.paradigm.cells.every((c) => correctCell(cellKey(c.row, c.col))))

/**
 * The spelling rules the wrong cells broke — and broke on their own, the ending
 * being otherwise right (#646). A whole column can slip on one rule (кни́гы,
 * ру́чкы, две́рцы), so the reminders are deduped by rule: the learner needs to
 * hear "the seven-letter rule" once, not six times. The oracle sees the whole
 * form, not the bare ending, because the letter the rule turns on is the one
 * before it — usually the last letter of the stem.
 */
function ruleHintsFor(keys) {
  const seen = new Map()
  for (const key of keys) {
    const cell = props.paradigm.cells.find((c) => cellKey(c.row, c.col) === key)
    if (!cell) continue
    const hint = ruleReminder(
      spellingRuleMiss(stems[key] + (entries[key] ?? ''), cell.form),
      vocabState.rules,
    )
    if (hint && !seen.has(hint.ruleId)) seen.set(hint.ruleId, hint)
  }
  return [...seen.values()]
}

// Reminders for the cells that slipped, refreshed at each check so a retry that
// fixes the rule stops repeating it back.
const ruleHints = ref([])

function check() {
  if (checked.value) return
  if (!allCorrect.value && props.allowRetry && !retried.value) {
    retried.value = true
    firstTryWrong.value = new Set(
      props.paradigm.cells.map((c) => cellKey(c.row, c.col)).filter((k) => !correctCell(k)),
    )
    ruleHints.value = ruleHintsFor(firstTryWrong.value)
    emit('retry')
    return
  }
  ruleHints.value = ruleHintsFor(
    props.paradigm.cells.map((c) => cellKey(c.row, c.col)).filter((k) => !correctCell(k)),
  )
  checked.value = true
  const records = props.paradigm.cells.map((c) => ({
    slot: cellKey(c.row, c.col),
    correct: correctCell(cellKey(c.row, c.col)),
  }))
  emit('graded', allCorrect.value, records)
}

// Enter jumps to the next still-empty ending box (wrapping around), so the
// learner can fill the whole table without reaching for each cell. Works for
// both a physical Enter and the on-screen keyboard's ⏎ (which dispatches one).
function focusNext(e) {
  const inputs = [...e.target.closest('table').querySelectorAll('input.ending-input:not([disabled])')]
  const i = inputs.indexOf(e.target)
  const order = [...inputs.slice(i + 1), ...inputs.slice(0, i + 1)]
  order.find((el) => !el.value.trim())?.focus()
}

onMounted(() => speak(props.paradigm.lemma))
</script>

<template>
  <div class="grid" style="gap: 1rem">
    <div class="table-scroll">
      <table class="ptable">
        <thead>
          <tr>
            <th></th>
            <th v-for="col in paradigm.cols" :key="col.key">{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in paradigm.rows" :key="row.key">
            <th class="rowhead">
              {{ row.label }}<button
                v-if="row.note"
                type="button"
                class="info"
                :title="row.note"
                :aria-label="row.note"
              >ⓘ</button>
              <small v-if="row.sub" class="muted">{{ row.sub }}</small>
            </th>
            <td v-for="col in paradigm.cols" :key="col.key">
              <div
                v-if="cellAt(row.key, col.key) && (!checked || correctCell(cellKey(row.key, col.key)))"
                class="ecell"
              >
                <span class="muted" lang="ru">{{ stems[cellKey(row.key, col.key)] }}</span>
                <input
                  v-model="entries[cellKey(row.key, col.key)]"
                  type="text"
                  lang="ru"
                  class="ending-input"
                  :class="{ 'first-try-wrong': retried && !checked && firstTryWrong.has(cellKey(row.key, col.key)) }"
                  :data-answer="endings[cellKey(row.key, col.key)]"
                  :disabled="checked"
                  :style="{
                    borderColor: checked ? 'var(--good)' : undefined,
                  }"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  @keydown.enter.prevent="focusNext"
                />
                <button
                  v-if="cellAt(row.key, col.key).note"
                  type="button"
                  class="info"
                  :title="cellAt(row.key, col.key).note"
                  :aria-label="cellAt(row.key, col.key).note"
                >ⓘ</button>
              </div>
              <div
                v-if="checked && cellAt(row.key, col.key) && !correctCell(cellKey(row.key, col.key))"
                class="correction"
              >
                <div class="wrong-attempt" lang="ru">
                  <span class="muted">{{ stems[cellKey(row.key, col.key)] }}</span><span>{{ entries[cellKey(row.key, col.key)] || '∅' }}</span>
                </div>
                <div class="correct-form speak-row">
                  <span lang="ru">{{ cellAt(row.key, col.key).form }}</span>
                  <SpeakButton :text="cellAt(row.key, col.key).form" />
                  <button
                    v-if="cellAt(row.key, col.key).note"
                    type="button"
                    class="info"
                    :title="cellAt(row.key, col.key).note"
                    :aria-label="cellAt(row.key, col.key).note"
                  >ⓘ</button>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="retried && !checked" class="retry-hint">
      Not quite — fix the marked endings and try again
    </p>

    <!-- A rule the marked endings broke, and the only thing wrong with them
         (#646): the ending itself was right, its spelling wasn't. Deduped, so
         one rule is stated once however many cells it explains. -->
    <p v-for="hint in ruleHints" :key="hint.ruleId" class="rule-hint">
      <strong class="rule-hint-headline">{{ hint.headline }}</strong>
      <span class="rule-hint-detail">{{ hint.detail }}</span>
    </p>

    <div class="row">
      <button v-if="!checked" class="primary" @click="check">Check</button>
    </div>
  </div>
</template>

<style scoped>
.table-scroll {
  overflow-x: auto;
}
/* The rule reminder is a note to remember, not a grade — so it reads calm
   beside the amber "not quite" line rather than competing with it. */
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
.ptable {
  width: 100%;
  border-collapse: collapse;
}
.ptable th,
.ptable td {
  padding: 0.25rem;
}
.rowhead {
  text-align: left;
  white-space: nowrap;
  vertical-align: top;
  position: sticky;
  left: 0;
  background: var(--card);
  z-index: 1;
}
.rowhead small {
  display: block;
  font-weight: 400;
  font-size: 0.7rem;
}
.info {
  border: none;
  background: none;
  padding: 0 0 0 0.2rem;
  margin: 0;
  color: var(--primary);
  font-size: 0.8rem;
  cursor: help;
  vertical-align: super;
  line-height: 1;
}
.ptable thead th:first-child {
  position: sticky;
  left: 0;
  background: var(--card);
  z-index: 1;
}
.ecell {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 1.05rem;
}
.ending-input {
  width: 5rem;
  padding: 0.4rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
}
.ending-input.first-try-wrong {
  border-color: var(--bad);
}
.retry-hint {
  margin: 0;
  color: var(--bad);
  font-size: 0.9rem;
}
.correction {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem;
}
.wrong-attempt {
  font-size: 0.8rem;
  text-decoration: line-through;
  color: var(--bad);
}
.correct-form {
  font-size: 1.2rem;
}
</style>
