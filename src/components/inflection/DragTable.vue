<script setup>
// Exercise 2 — an empty table plus a bank of shuffled forms. Drag a form into a
// cell (desktop) or tap a form then tap a cell (touch). A form is correct in a
// cell when their normalised spellings match, so syncretic forms work anywhere
// they legitimately fit.
import { computed, reactive, ref } from 'vue'

import { cellKey } from '../../lib/paradigm.js'
import { shuffle } from '../../lib/quiz.js'
import { normalize } from '../../lib/text.js'

const props = defineProps({ paradigm: { type: Object, required: true } })
const emit = defineEmits(['graded'])

// One chip per filled cell (so duplicates appear the right number of times).
const chips = shuffle(props.paradigm.cells.map((c, i) => ({ id: i, form: c.form })))
const chipById = new Map(chips.map((c) => [c.id, c]))

const placed = reactive({}) // cellKey -> chipId
const picked = ref(null) // chip id selected for tap-to-place
const checked = ref(false)

const placedIds = computed(() => new Set(Object.values(placed)))
const bank = computed(() => chips.filter((c) => !placedIds.value.has(c.id)))
const allPlaced = computed(() => Object.keys(placed).length === props.paradigm.cells.length)

function cellAt(row, col) {
  return props.paradigm.cells.find((c) => c.row === row && c.col === col)
}

function place(key, chipId) {
  if (checked.value || chipId == null) return
  // Remove the chip from any previous cell, then drop it here.
  for (const [k, v] of Object.entries(placed)) if (v === chipId) delete placed[k]
  placed[key] = chipId
  picked.value = null
}

function onCellClick(key) {
  if (checked.value) return
  if (placed[key] != null) {
    // Tap a filled cell to send its chip back to the bank.
    delete placed[key]
    return
  }
  if (picked.value != null) place(key, picked.value)
}

function onChipClick(id) {
  if (checked.value) return
  picked.value = picked.value === id ? null : id
}

function onDrop(e, key) {
  const id = Number(e.dataTransfer.getData('text/plain'))
  place(key, id)
}

function isCorrect(key) {
  const cell = props.paradigm.cells.find((c) => cellKey(c.row, c.col) === key)
  const chip = chipById.get(placed[key])
  return cell && chip && normalize(chip.form) === normalize(cell.form)
}

function check() {
  if (checked.value || !allPlaced.value) return
  checked.value = true
  const records = props.paradigm.cells.map((c) => ({
    slot: cellKey(c.row, c.col),
    correct: isCorrect(cellKey(c.row, c.col)),
  }))
  emit('graded', records.every((r) => r.correct), records)
}
</script>

<template>
  <div class="grid" style="gap: 1rem">
    <div class="bank card" :class="{ active: picked != null }">
      <span v-if="!bank.length" class="muted">All forms placed.</span>
      <button
        v-for="chip in bank"
        :key="chip.id"
        type="button"
        class="chip"
        :class="{ picked: picked === chip.id }"
        draggable="true"
        lang="ru"
        @click="onChipClick(chip.id)"
        @dragstart="(e) => e.dataTransfer.setData('text/plain', String(chip.id))"
      >
        {{ chip.form }}
      </button>
    </div>

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
              v-if="cellAt(row.key, col.key)"
              class="drop"
              :class="{
                filled: placed[cellKey(row.key, col.key)] != null,
                correct: checked && isCorrect(cellKey(row.key, col.key)),
                wrong: checked && placed[cellKey(row.key, col.key)] != null && !isCorrect(cellKey(row.key, col.key)),
                droppable: picked != null && placed[cellKey(row.key, col.key)] == null,
              }"
              @click="onCellClick(cellKey(row.key, col.key))"
              @dragover.prevent
              @drop.prevent="(e) => onDrop(e, cellKey(row.key, col.key))"
            >
              <div
                v-if="checked && placed[cellKey(row.key, col.key)] != null && !isCorrect(cellKey(row.key, col.key))"
                class="correction"
                lang="ru"
              >
                <span class="wrong-attempt">{{ chipById.get(placed[cellKey(row.key, col.key)]).form }}</span>
                <span class="correct-form">{{ cellAt(row.key, col.key).form }}</span>
              </div>
              <span v-else-if="placed[cellKey(row.key, col.key)] != null" lang="ru">
                {{ chipById.get(placed[cellKey(row.key, col.key)]).form }}
              </span>
              <span v-else class="muted">·</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="row">
      <button v-if="!checked" class="primary" :disabled="!allPlaced" @click="check">Check</button>
    </div>
  </div>
</template>

<style scoped>
.bank {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-height: 3rem;
}
.bank.active {
  border-color: var(--primary);
}
.chip {
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.5rem 0.8rem;
  color: var(--text);
  font-size: 1.05rem;
  touch-action: manipulation;
}
.chip.picked {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 22%, var(--card));
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
}
.rowhead small {
  display: block;
  font-weight: 400;
  font-size: 0.7rem;
}
.drop {
  min-height: 2.6rem;
  border: 1px dashed var(--border);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.05rem;
}
.drop.droppable {
  border-style: solid;
  border-color: var(--primary);
}
.drop.filled {
  border-style: solid;
  background: var(--bg-soft);
}
.drop.correct {
  border-color: var(--good);
  background: color-mix(in srgb, var(--good) 18%, var(--card));
}
.drop.wrong {
  border-color: var(--bad);
  background: color-mix(in srgb, var(--bad) 18%, var(--card));
}
.correction {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
}
.wrong-attempt {
  font-size: 0.75rem;
  text-decoration: line-through;
  color: var(--bad);
  opacity: 0.9;
}
.correct-form {
  font-size: 1.1rem;
}
</style>
