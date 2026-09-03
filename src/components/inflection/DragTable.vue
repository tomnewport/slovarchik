<script setup>
// Exercise 2 — an empty table plus a bank of shuffled forms. Drag a form into a
// cell (desktop) or tap a form then tap a cell (touch). A form is correct in a
// cell when their normalised spellings match, so syncretic forms work anywhere
// they legitimately fit.
//
// A big table is filled in *stages* (#645). Until the learner has assembled it
// once with nothing in the wrong cell, the drill walks one column at a time —
// masculine, neuter, feminine, plural — showing only the columns reached so far
// and banking only the forms of the column being filled. `staged: false` (the
// default, and what a learner who has already built this table cleanly gets) is
// the original whole-table drill: one stage holding every column. Small tables
// never split, whatever `staged` says — see lib/tableStage.js.
import { computed, onMounted, reactive, ref } from 'vue'

import { cellKey } from '../../lib/paradigm.js'
import { columnStages } from '../../lib/tableStage.js'
import { shuffle } from '../../lib/quiz.js'
import { normalize, stressMatches } from '../../lib/text.js'
import { speak } from '../../lib/speech.js'

const props = defineProps({
  paradigm: { type: Object, required: true },
  // Offer this table one column at a time (a learner's first pass at a big one).
  staged: { type: Boolean, default: false },
})
const emit = defineEmits(['graded'])

// The column groups this table is filled in, and where each column sits in them.
const stages = columnStages(props.paradigm, props.staged)
const stageOfCol = new Map()
stages.forEach((cols, i) => cols.forEach((col) => stageOfCol.set(col, i)))

// One chip per filled cell (so duplicates appear the right number of times).
// Each remembers its column, which is what confines the bank to the stage.
const chips = shuffle(props.paradigm.cells.map((c, i) => ({ id: i, form: c.form, col: c.col })))
const chipById = new Map(chips.map((c) => [c.id, c]))
const colByCell = new Map(props.paradigm.cells.map((c) => [cellKey(c.row, c.col), c.col]))

const placed = reactive({}) // cellKey -> chipId
const picked = ref(null) // chip id selected for tap-to-place
const stage = ref(0) // the column group being filled
const checkedStage = ref(-1) // the last stage graded (-1 = nothing checked yet)
// Every cell record collected so far, oldest stage first — emitted as one table
// result when the last stage is checked.
const records = []
// Screen-reader narration of the pick → place gesture, which is otherwise
// signalled only by colour and the speak() call.
const announcement = ref('')

const lastStage = computed(() => stage.value >= stages.length - 1)
const stageChecked = computed(() => checkedStage.value >= stage.value)
/** Columns of the current stage — the only ones being filled right now. */
const stageCols = computed(() => new Set(stages[stage.value]))
/** Columns to render: those reached so far, so earlier stages stay in view. */
const shownCols = computed(() =>
  props.paradigm.cols.filter((c) => (stageOfCol.get(c.key) ?? 0) <= stage.value),
)
const stageCells = computed(() => props.paradigm.cells.filter((c) => stageCols.value.has(c.col)))
/** A cell is locked once its own stage has been graded. */
function isChecked(key) {
  return (stageOfCol.get(colByCell.get(key)) ?? 0) <= checkedStage.value
}

const placedIds = computed(() => new Set(Object.values(placed)))
const bank = computed(() => chips.filter((c) => stageCols.value.has(c.col) && !placedIds.value.has(c.id)))
const allPlaced = computed(() =>
  stageCells.value.every((c) => placed[cellKey(c.row, c.col)] != null),
)

function cellAt(row, col) {
  return props.paradigm.cells.find((c) => c.row === row && c.col === col)
}

// "Nominative, Singular" for every slot — the only thing that tells a
// screen-reader user which of a dozen identical cells they are on.
const slotLabels = computed(() => {
  const map = new Map()
  for (const row of props.paradigm.rows) {
    for (const col of props.paradigm.cols) {
      map.set(cellKey(row.key, col.key), `${row.label}, ${col.label}`)
    }
  }
  return map
})

function slotLabel(key) {
  return slotLabels.value.get(key) ?? key
}

/** "Masculine — column 2 of 4", the staged drill's progress line. */
const stageLabel = computed(() => {
  if (stages.length < 2) return ''
  const labels = props.paradigm.cols
    .filter((c) => stageCols.value.has(c.key))
    .map((c) => c.label)
    .join(' / ')
  return `${labels} — column ${stage.value + 1} of ${stages.length}`
})

function cellLabel(key) {
  const where = slotLabel(key)
  const chip = chipById.get(placed[key])
  if (!isChecked(key)) {
    if (!chip) {
      const pick = picked.value == null ? null : chipById.get(picked.value)
      return pick ? `${where}: empty, place ${pick.form}` : `${where}: empty`
    }
    return `${where}: ${chip.form}, press to return it to the bank`
  }
  const answer = props.paradigm.cells.find((c) => cellKey(c.row, c.col) === key)
  if (!chip) return `${where}: empty, answer ${answer.form}`
  if (hasStressMismatch(key)) return `${where}: ${chip.form}, right form, wrong stress — ${answer.form}`
  if (isCorrect(key)) return `${where}: ${chip.form}, correct`
  return `${where}: ${chip.form}, wrong — ${answer.form}`
}

function place(key, chipId) {
  if (isChecked(key) || chipId == null) return
  // Remove the chip from any previous cell, then drop it here.
  for (const [k, v] of Object.entries(placed)) if (v === chipId) delete placed[k]
  placed[key] = chipId
  picked.value = null
  announcement.value = `${chipById.get(chipId).form} placed in ${slotLabel(key)}.`
}

function onCellClick(key) {
  if (isChecked(key)) return
  if (placed[key] != null) {
    // Tap a filled cell to send its chip back to the bank.
    const chip = chipById.get(placed[key])
    delete placed[key]
    announcement.value = `${chip.form} returned to the bank.`
    return
  }
  if (picked.value != null) place(key, picked.value)
}

function onChipClick(id) {
  if (stageChecked.value) return
  const chip = chipById.get(id)
  speak(chip.form)
  picked.value = picked.value === id ? null : id
  announcement.value =
    picked.value === id ? `${chip.form} selected — choose a cell.` : `${chip.form} deselected.`
}

function nextEmptySlot() {
  for (const row of props.paradigm.rows) {
    for (const col of props.paradigm.cols) {
      if (!stageCols.value.has(col.key)) continue
      if (cellAt(row.key, col.key) && placed[cellKey(row.key, col.key)] == null) {
        return cellKey(row.key, col.key)
      }
    }
  }
  return null
}

function onChipDblClick(id) {
  if (stageChecked.value) return
  const slot = nextEmptySlot()
  if (slot != null) place(slot, id)
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

// A stress-only miss stays correct for scoring, but is shown separately so
// syncretic-looking forms such as о́кна / окна́ cannot be swapped silently.
function hasStressMismatch(key) {
  const cell = props.paradigm.cells.find((c) => cellKey(c.row, c.col) === key)
  const chip = chipById.get(placed[key])
  return !!(cell && chip && isCorrect(key) && !stressMatches(chip.form, cell.form))
}

const stressWarningCount = computed(
  () =>
    stageCells.value.filter((c) => hasStressMismatch(cellKey(c.row, c.col))).length,
)

onMounted(() => speak(props.paradigm.lemma))

function check() {
  if (stageChecked.value || !allPlaced.value) return
  checkedStage.value = stage.value
  for (const c of stageCells.value) {
    const key = cellKey(c.row, c.col)
    const correct = isCorrect(key)
    records.push({ slot: key, correct, stressCorrect: correct ? !hasStressMismatch(key) : null })
  }
  if (!lastStage.value) {
    announcement.value = `Column checked. ${stages.length - stage.value - 1} to go.`
    return
  }
  emit('graded', records.every((r) => r.correct), records)
}

/** Move on to the next column of a staged table. */
function nextStage() {
  if (!stageChecked.value || lastStage.value) return
  stage.value += 1
  picked.value = null
  announcement.value = `${stageLabel.value}.`
}
</script>

<template>
  <div class="grid" style="gap: 1rem">
    <p class="visually-hidden" role="status" aria-live="polite">{{ announcement }}</p>

    <!-- Staged first pass (#645): one column at a time, so the bank offers a
         handful of forms rather than the whole paradigm. -->
    <p v-if="stageLabel" class="stage-line muted">{{ stageLabel }}</p>

    <div
      class="bank card"
      :class="{ active: picked != null }"
      role="group"
      aria-label="Forms to place"
    >
      <span v-if="!bank.length" class="muted">All forms placed.</span>
      <button
        v-for="chip in bank"
        :key="chip.id"
        type="button"
        class="chip"
        :class="{ picked: picked === chip.id }"
        :aria-pressed="picked === chip.id"
        draggable="true"
        lang="ru"
        @click="onChipClick(chip.id)"
        @dblclick="onChipDblClick(chip.id)"
        @dragstart="(e) => e.dataTransfer.setData('text/plain', String(chip.id))"
      >
        {{ chip.form }}
      </button>
    </div>

    <div class="table-scroll">
      <table class="ptable" :class="{ narrow: shownCols.length < paradigm.cols.length }">
        <thead>
          <tr>
            <th></th>
            <th v-for="col in shownCols" :key="col.key">{{ col.label }}</th>
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
            <td v-for="col in shownCols" :key="col.key">
              <div v-if="cellAt(row.key, col.key)" class="cell">
                <button
                  v-if="cellAt(row.key, col.key).note"
                  type="button"
                  class="info cell-info"
                  :title="cellAt(row.key, col.key).note"
                  :aria-label="cellAt(row.key, col.key).note"
                >ⓘ</button>
              <div
                class="drop"
                :data-answer="cellAt(row.key, col.key).form"
                :class="{
                  filled: placed[cellKey(row.key, col.key)] != null,
                  correct:
                    isChecked(cellKey(row.key, col.key)) &&
                    isCorrect(cellKey(row.key, col.key)) &&
                    !hasStressMismatch(cellKey(row.key, col.key)),
                  'stress-warning':
                    isChecked(cellKey(row.key, col.key)) && hasStressMismatch(cellKey(row.key, col.key)),
                  wrong:
                    isChecked(cellKey(row.key, col.key)) &&
                    placed[cellKey(row.key, col.key)] != null &&
                    !isCorrect(cellKey(row.key, col.key)),
                  droppable: picked != null && placed[cellKey(row.key, col.key)] == null,
                }"
                role="button"
                :tabindex="isChecked(cellKey(row.key, col.key)) ? -1 : 0"
                :aria-label="cellLabel(cellKey(row.key, col.key))"
                @click="onCellClick(cellKey(row.key, col.key))"
                @keydown.enter="onCellClick(cellKey(row.key, col.key))"
                @keydown.space.prevent="onCellClick(cellKey(row.key, col.key))"
                @dragover.prevent
                @drop.prevent="(e) => onDrop(e, cellKey(row.key, col.key))"
              >
                <div
                  v-if="isChecked(cellKey(row.key, col.key)) && hasStressMismatch(cellKey(row.key, col.key))"
                  class="stress-correction"
                  lang="ru"
                >
                  <span class="stress-attempt">{{ chipById.get(placed[cellKey(row.key, col.key)]).form }}</span>
                  <span aria-hidden="true">→</span>
                  <span class="correct-form">{{ cellAt(row.key, col.key).form }}</span>
                </div>
                <div
                  v-else-if="
                    isChecked(cellKey(row.key, col.key)) &&
                    placed[cellKey(row.key, col.key)] != null &&
                    !isCorrect(cellKey(row.key, col.key))
                  "
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
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="stageChecked && stressWarningCount" class="stress-hint" role="status">
      Table accepted — check the stress in
      {{ stressWarningCount === 1 ? 'the highlighted form' : 'the highlighted forms' }}.
    </p>

    <div class="row">
      <button v-if="!stageChecked" class="primary" :disabled="!allPlaced" @click="check">Check</button>
      <button v-else-if="!lastStage" class="primary" @click="nextStage">Next column →</button>
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
.stage-line {
  margin: 0;
  font-size: 0.9rem;
}
.table-scroll {
  overflow-x: auto;
}
.ptable {
  width: 100%;
  border-collapse: collapse;
}
/* A staged table holds only the columns reached so far, so it sizes to its
   content rather than stretching a lone column across the screen (#645). Its
   cells keep a floor width so an empty column isn't a sliver. */
.ptable.narrow {
  width: auto;
}
.ptable.narrow .drop {
  min-width: 7rem;
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
.cell {
  position: relative;
}
.cell-info {
  position: absolute;
  top: -0.2rem;
  right: -0.2rem;
  padding: 0;
  z-index: 2;
}
.ptable thead th:first-child {
  position: sticky;
  left: 0;
  background: var(--card);
  z-index: 1;
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
.drop:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
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
.drop.stress-warning {
  border-color: var(--warn, #c9962b);
  background: color-mix(in srgb, var(--warn, #c9962b) 18%, var(--card));
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
.stress-correction {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--warn, #c9962b);
}
.stress-attempt {
  text-decoration: line-through;
  opacity: 0.9;
}
.stress-hint {
  margin: 0;
  color: var(--warn, #c9962b);
  font-size: 0.9rem;
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
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
