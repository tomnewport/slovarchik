<script setup>
// Exercise 3 — the stems are shown; the learner adds each ending one cell at a
// time using the on-screen keyboard, where the correct next letter is lit up
// alongside a couple of decoys. Zero-ending cells are pre-filled with ∅.
import { computed, onMounted, reactive, ref } from 'vue'

import { cellKey, endingOf } from '../../lib/paradigm.js'
import { sample, shuffle } from '../../lib/quiz.js'
import { stripStress, normalize } from '../../lib/text.js'
import { speak } from '../../lib/speech.js'
import HintKeyboard from '../HintKeyboard.vue'

const props = defineProps({ paradigm: { type: Object, required: true } })
const emit = defineEmits(['graded'])

const PADDING = [...'аеиоуыяюйь']

// Pre-compute each cell's stress-free ending.
const endings = {}
for (const cell of props.paradigm.cells) {
  endings[cellKey(cell.row, cell.col)] = endingOf(props.paradigm, cell)
}

// Cells that actually need typing (non-zero ending), in reading order.
const typable = props.paradigm.cells.filter((c) => endings[cellKey(c.row, c.col)].length > 0)

// Letters that appear in any ending — the decoy pool.
const decoyPool = [...new Set(Object.values(endings).flatMap((e) => [...e]))]

const typed = reactive({}) // cellKey -> built ending
const active = ref(0)
const finished = ref(typable.length === 0)
let mistakes = 0

const hintCache = {}
function hintFor(key, idx, next) {
  const ck = `${key}:${idx}`
  if (!hintCache[ck]) {
    const pool = [...decoyPool, ...PADDING].filter((l) => l !== next)
    hintCache[ck] = shuffle([next, ...sample(pool, 2)])
  }
  return hintCache[ck]
}

const currentKey = computed(() => {
  if (finished.value) return null
  const cell = typable[active.value]
  return cellKey(cell.row, cell.col)
})

const nextLetter = computed(() => {
  if (!currentKey.value) return null
  const expected = endings[currentKey.value]
  const idx = [...(typed[currentKey.value] ?? '')].length
  return [...expected][idx] ?? null
})

const highlight = computed(() => {
  if (!currentKey.value || !nextLetter.value) return []
  const idx = [...(typed[currentKey.value] ?? '')].length
  return hintFor(currentKey.value, idx, nextLetter.value)
})

function finishUp() {
  finished.value = true
  const records = props.paradigm.cells.map((c) => ({ slot: cellKey(c.row, c.col), correct: true }))
  emit('graded', mistakes === 0, records)
}

function press(letter) {
  if (finished.value || !nextLetter.value) return
  const key = currentKey.value
  const want = nextLetter.value
  if (normalize(letter) === normalize(want)) {
    typed[key] = (typed[key] ?? '') + want
    if ([...typed[key]].length >= [...endings[key]].length) {
      if (active.value + 1 >= typable.length) finishUp()
      else active.value += 1
    }
  } else {
    mistakes += 1
  }
}

function backspace() {
  const key = currentKey.value
  if (!key || !typed[key]) return
  typed[key] = [...typed[key]].slice(0, -1).join('')
}

// View-model for one cell: the fixed stem, the ending typed so far, and whether
// it is the cell currently being filled.
function info(rowKey, colKey) {
  const cell = props.paradigm.cells.find((c) => c.row === rowKey && c.col === colKey)
  if (!cell) return null
  const key = cellKey(rowKey, colKey)
  const ending = endings[key]
  const bare = stripStress(cell.form)
  return {
    stem: bare.slice(0, bare.length - ending.length),
    typed: typed[key] ?? '',
    zero: ending.length === 0,
    active: key === currentKey.value,
  }
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
              v-if="info(row.key, col.key)"
              class="ecell"
              :class="{ active: info(row.key, col.key).active }"
              lang="ru"
            >
              <span class="muted">{{ info(row.key, col.key).stem }}</span>
              <span class="ending">{{ info(row.key, col.key).typed }}</span>
              <span v-if="info(row.key, col.key).zero" class="muted">∅</span>
              <span v-if="info(row.key, col.key).active" class="caret">|</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="!finished" class="muted">
      Tap the highlighted letter to add the next part of the ending.
    </p>
    <p v-else class="feedback good">Endings complete!</p>

    <HintKeyboard
      v-if="!finished"
      layout="ru"
      :highlight="highlight"
      @press="press"
      @backspace="backspace"
    />
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
  min-height: 2.4rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.4rem 0.6rem;
  font-size: 1.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ecell.active {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 14%, var(--card));
}
.ending {
  color: var(--good);
  font-weight: 700;
}
.caret {
  color: var(--primary);
  animation: blink 1s steps(1) infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
</style>
