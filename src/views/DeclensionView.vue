<script setup>
import { computed, reactive, ref } from 'vue'
import { nouns } from '../data/nouns.js'
import {
  CASES,
  CASE_LABELS,
  CASE_HINTS,
  NUMBER_LABELS,
  numbersOf,
  endingsTable,
  matchingSlots,
  validCases,
} from '../lib/declension.js'
import { normalize, sample } from '../lib/quiz.js'

const LEVELS = [
  { id: 'easy', label: 'Easy · spot the case', help: 'Which case(s) could this form be?' },
  { id: 'intermediate', label: 'Intermediate · fill the table', help: 'Type every form.' },
  { id: 'advanced', label: 'Advanced · endings only', help: 'Type the ending for each cell.' },
]

const level = ref(null)
const noun = ref(null)
const score = reactive({ right: 0, total: 0 })

// --- Easy: spot the case -------------------------------------------------
const probeForm = ref('')
const selected = reactive(new Set())
const easyChecked = ref(false)
const correctCases = computed(() =>
  noun.value && probeForm.value ? validCases(noun.value, probeForm.value) : new Set(),
)

// --- Table modes (intermediate / advanced) -------------------------------
const entries = reactive({}) // `${num}.${case}` -> typed value
const tableChecked = ref(false)
const table = computed(() => (noun.value ? endingsTable(noun.value) : null))

// Numbers actually present (some nouns are plural-only, e.g. деньги, ворота).
const nums = computed(() => (noun.value ? numbersOf(noun.value) : []))
const cellCount = computed(() => nums.value.length * CASES.length)

function start(levelId) {
  level.value = levelId
  score.right = 0
  score.total = 0
  newRound()
}

function newRound() {
  noun.value = sample(nouns, 1)[0]
  easyChecked.value = false
  tableChecked.value = false
  selected.clear()
  for (const k of Object.keys(entries)) delete entries[k]

  if (level.value === 'easy') {
    // Pick a random form (from a number the noun actually has) to identify.
    const num = sample(numbersOf(noun.value), 1)[0]
    const c = sample(CASES, 1)[0]
    probeForm.value = noun.value.forms[num][c]
  }
}

function toggle(c) {
  if (easyChecked.value) return
  selected.has(c) ? selected.delete(c) : selected.add(c)
}

function checkEasy() {
  if (easyChecked.value) return
  easyChecked.value = true
  score.total += 1
  const want = correctCases.value
  const same = want.size === selected.size && [...want].every((c) => selected.has(c))
  if (same) score.right += 1
}

function key(num, c) {
  return `${num}.${c}`
}

function expected(num, c) {
  if (level.value === 'advanced') return table.value.endings[num][c]
  return noun.value.forms[num][c]
}

// Stress marks are ignored — learners type without them.
function cellCorrect(num, c) {
  return normalize(entries[key(num, c)] ?? '') === normalize(expected(num, c))
}

function countRight() {
  let right = 0
  for (const num of nums.value) for (const c of CASES) if (cellCorrect(num, c)) right += 1
  return right
}

function checkTable() {
  if (tableChecked.value) return
  tableChecked.value = true
  score.total += 1
  // One "point" per fully-correct table keeps scoring comparable across modes.
  if (countRight() === cellCount.value) score.right += 1
}

const tableScore = computed(() => (tableChecked.value ? countRight() : null))

function quit() {
  level.value = null
  noun.value = null
}
</script>

<template>
  <section v-if="!level" class="grid">
    <h2 style="margin: 0">Noun declension</h2>
    <div class="grid">
      <button v-for="l in LEVELS" :key="l.id" class="card" style="text-align: left" @click="start(l.id)">
        <strong>{{ l.label }}</strong>
        <div class="muted">{{ l.help }}</div>
      </button>
    </div>
  </section>

  <section v-else class="grid" style="gap: 1.25rem">
    <div class="row" style="justify-content: space-between">
      <span class="pill">{{ level }}</span>
      <span class="muted">Score: {{ score.right }} / {{ score.total }}</span>
    </div>

    <!-- Easy: spot the case -->
    <template v-if="level === 'easy'">
      <div class="card" style="text-align: center">
        <div class="muted">{{ noun.lemma }} ({{ noun.en }}) — which case is this form?</div>
        <div style="font-size: 2rem; margin: 0.5rem 0" lang="ru">{{ probeForm }}</div>
      </div>
      <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 0.5rem">
        <button
          v-for="c in CASES"
          :key="c"
          class="choice"
          :class="
            easyChecked
              ? correctCases.has(c)
                ? 'correct'
                : selected.has(c)
                  ? 'wrong'
                  : ''
              : selected.has(c)
                ? 'primary'
                : ''
          "
          @click="toggle(c)"
        >
          {{ CASE_LABELS[c] }}
          <div class="muted" style="font-size: 0.75rem">{{ CASE_HINTS[c] }}</div>
        </button>
      </div>
      <p v-if="easyChecked" class="muted">
        Matches:
        <span lang="ru">{{
          matchingSlots(noun, probeForm)
            .map((s) => `${NUMBER_LABELS[s.number].toLowerCase()} ${CASE_LABELS[s.case].toLowerCase()}`)
            .join(', ')
        }}</span>
      </p>
      <div class="row">
        <button v-if="!easyChecked" class="primary" :disabled="selected.size === 0" @click="checkEasy">
          Check
        </button>
        <button v-else class="primary" @click="newRound">Next →</button>
        <button @click="quit">Change mode</button>
      </div>
    </template>

    <!-- Intermediate / advanced: the table -->
    <template v-else>
      <div class="card" style="text-align: center">
        <div style="font-size: 1.6rem" lang="ru">{{ noun.lemma }}</div>
        <div class="muted">
          {{ noun.en }} · {{ noun.gender || 'pl' }}{{ noun.animate ? ' · animate' : '' }}
          <span v-if="noun.cefr" class="pill">{{ noun.cefr }}</span>
          <template v-if="level === 'advanced'"> · stem <b lang="ru">{{ table.stem }}-</b></template>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse">
        <thead>
          <tr>
            <th></th>
            <th v-for="num in nums" :key="num" style="text-align: left; padding: 0.3rem">
              {{ NUMBER_LABELS[num] }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in CASES" :key="c">
            <th style="text-align: left; padding: 0.3rem; white-space: nowrap">
              {{ CASE_LABELS[c] }}
            </th>
            <td v-for="num in nums" :key="num" style="padding: 0.2rem">
              <div class="row" style="gap: 0.3rem; flex-wrap: nowrap">
                <span v-if="level === 'advanced'" class="muted" lang="ru">{{ table.stem }}</span>
                <input
                  v-model="entries[key(num, c)]"
                  type="text"
                  lang="ru"
                  :disabled="tableChecked"
                  :style="{
                    borderColor: tableChecked
                      ? cellCorrect(num, c)
                        ? 'var(--good)'
                        : 'var(--bad)'
                      : undefined,
                  }"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                />
              </div>
              <div v-if="tableChecked && !cellCorrect(num, c)" class="muted" style="font-size: 0.8rem" lang="ru">
                {{ expected(num, c) }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-if="tableChecked" class="muted">{{ tableScore }} / {{ cellCount }} cells correct.</p>

      <div class="row">
        <button v-if="!tableChecked" class="primary" @click="checkTable">Check table</button>
        <button v-else class="primary" @click="newRound">Next noun →</button>
        <button @click="quit">Change mode</button>
      </div>
    </template>
  </section>
</template>
