<script setup>
// Exercise 4 — type every ending with no assistance. Stems are shown; the
// learner fills one input per cell. A blank input is correct for a zero ending.
import { computed, onMounted, reactive, ref } from 'vue'

import { cellKey, endingOf } from '../../lib/paradigm.js'
import { stripStress, normalize } from '../../lib/text.js'
import { speak } from '../../lib/speech.js'
import SpeakButton from '../SpeakButton.vue'

const props = defineProps({ paradigm: { type: Object, required: true } })
const emit = defineEmits(['graded'])

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

function cellAt(row, col) {
  return props.paradigm.cells.find((c) => c.row === row && c.col === col)
}

function correctCell(key) {
  return normalize(entries[key] ?? '') === normalize(endings[key])
}

const allCorrect = computed(() => props.paradigm.cells.every((c) => correctCell(cellKey(c.row, c.col))))

function check() {
  if (checked.value) return
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
            {{ row.label }}
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
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="row">
      <button v-if="!checked" class="primary" @click="check">Check</button>
    </div>
  </div>
</template>

<style scoped>
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
}
.rowhead small {
  display: block;
  font-weight: 400;
  font-size: 0.7rem;
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
