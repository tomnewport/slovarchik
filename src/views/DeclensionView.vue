<script setup>
import { computed, reactive, ref, onUnmounted } from 'vue'
import { nouns, state } from '../stores/vocab.js'
import {
  CASES,
  CASE_LABELS,
  CASE_HINTS,
  NUMBER_LABELS,
  numbersOf,
  endingsTable,
  matchingSlots,
  slotKey,
  validSlots,
} from '../lib/declension.js'
import { normalize, sample } from '../lib/quiz.js'
import { record as recordAttempt } from '../stores/progress.js'
import { GRADES, gradeFor } from '../lib/progress.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'

// How long the celebration plays before auto-advancing to the next noun.
const CELEBRATE_MS = 1000

const ready = computed(() => nouns.value.length > 0)

const LEVELS = [
  { id: 'easy', label: 'Easy · spot the case', help: 'Which case(s) could this form be?' },
  { id: 'intermediate', label: 'Intermediate · fill the table', help: 'Type every form.' },
  { id: 'advanced', label: 'Advanced · endings only', help: 'Type the ending for each cell.' },
]

const level = ref(null)
const noun = ref(null)
const score = reactive({ right: 0, total: 0 })

const celebrating = ref(false)
const lastCorrect = ref(false)
let advanceTimer = null

// --- Easy: spot the case + number ----------------------------------------
const probeForm = ref('')
const probeSlot = ref('') // the slot the probe form was drawn from, e.g. 'pl.gen'
const selected = reactive(new Set()) // slot keys, e.g. 'pl.gen'
const easyChecked = ref(false)
const correctSlots = computed(() =>
  noun.value && probeForm.value ? validSlots(noun.value, probeForm.value) : new Set(),
)
// Every (case, number) slot offered as a button — grouped by case, with each
// number the noun actually has (pluralia tantum nouns offer plural only).
const easySlots = computed(() =>
  noun.value
    ? CASES.flatMap((c) =>
        numbersOf(noun.value).map((num) => ({ key: slotKey(num, c), case: c, number: num })),
      )
    : [],
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
  clearTimeout(advanceTimer)
  celebrating.value = false
  lastCorrect.value = false
  noun.value = sample(nouns.value, 1)[0]
  easyChecked.value = false
  tableChecked.value = false
  selected.clear()
  for (const k of Object.keys(entries)) delete entries[k]

  if (level.value === 'easy') {
    // Pick a random form (from a number the noun actually has) to identify.
    const num = sample(numbersOf(noun.value), 1)[0]
    const c = sample(CASES, 1)[0]
    probeForm.value = noun.value.forms[num][c]
    probeSlot.value = slotKey(num, c)
  }
}

function toggle(slot) {
  if (easyChecked.value) return
  selected.has(slot) ? selected.delete(slot) : selected.add(slot)
}

function celebrateThenAdvance() {
  lastCorrect.value = true
  celebrating.value = true
  advanceTimer = setTimeout(newRound, CELEBRATE_MS)
}

function checkEasy() {
  if (easyChecked.value) return
  easyChecked.value = true
  score.total += 1
  const want = correctSlots.value
  const same = want.size === selected.size && [...want].every((s) => selected.has(s))
  if (same) {
    score.right += 1
    recordAttempt({ kind: 'form', key: noun.value.id, slot: probeSlot.value }, GRADES.EASY, {
      level: 'easy',
    })
    celebrateThenAdvance()
  } else {
    // Count a miss against the correct form and each form wrongly selected.
    recordAttempt({ kind: 'form', key: noun.value.id, slot: probeSlot.value }, GRADES.INCORRECT, {
      level: 'easy',
    })
    for (const slot of selected) {
      if (!want.has(slot)) {
        recordAttempt({ kind: 'form', key: noun.value.id, slot }, GRADES.INCORRECT, { level: 'easy' })
      }
    }
  }
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
  // Record each cell as a word-form attempt (spelling of that number × case form).
  for (const num of nums.value) {
    for (const c of CASES) {
      recordAttempt(
        { kind: 'form', key: noun.value.id, slot: slotKey(num, c) },
        gradeFor(level.value, cellCorrect(num, c)),
        { level: level.value },
      )
    }
  }
  // One "point" per fully-correct table keeps scoring comparable across modes.
  if (countRight() === cellCount.value) {
    score.right += 1
    celebrateThenAdvance()
  }
}

const tableScore = computed(() => (tableChecked.value ? countRight() : null))

function quit() {
  clearTimeout(advanceTimer)
  celebrating.value = false
  level.value = null
  noun.value = null
}

onUnmounted(() => clearTimeout(advanceTimer))
</script>

<template>
  <section v-if="!level" class="grid">
    <h2 style="margin: 0">Noun declension</h2>
    <p v-if="!ready && state.status === 'loading'" class="muted">Loading vocabulary…</p>
    <p v-else-if="!ready" class="feedback bad">
      No vocabulary available offline yet — connect once to download it.
    </p>
    <div class="grid">
      <button
        v-for="l in LEVELS"
        :key="l.id"
        class="card"
        style="text-align: left"
        :disabled="!ready"
        @click="start(l.id)"
      >
        <strong>{{ l.label }}</strong>
        <div class="muted">{{ l.help }}</div>
      </button>
    </div>
  </section>

  <section v-else class="grid" style="gap: 1.25rem; position: relative">
    <CelebrationBurst :show="celebrating" />
    <div class="row" style="justify-content: space-between">
      <span class="pill">{{ level }}</span>
      <span class="muted">Score: {{ score.right }} / {{ score.total }}</span>
    </div>

    <!-- Easy: spot the case -->
    <template v-if="level === 'easy'">
      <div class="card" style="text-align: center">
        <div class="muted">{{ noun.lemma }} ({{ noun.en }}) — which case &amp; number is this form?</div>
        <div style="font-size: 2rem; margin: 0.5rem 0" lang="ru">{{ probeForm }}</div>
      </div>
      <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 0.5rem">
        <button
          v-for="slot in easySlots"
          :key="slot.key"
          class="choice"
          :class="
            easyChecked
              ? correctSlots.has(slot.key)
                ? 'correct'
                : selected.has(slot.key)
                  ? 'wrong'
                  : ''
              : selected.has(slot.key)
                ? 'primary'
                : ''
          "
          @click="toggle(slot.key)"
        >
          {{ CASE_LABELS[slot.case] }} {{ NUMBER_LABELS[slot.number].toLowerCase() }}
          <div class="muted" style="font-size: 0.75rem">{{ CASE_HINTS[slot.case] }}</div>
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
        <button v-else-if="!lastCorrect" class="primary" @click="newRound">Next →</button>
        <button v-if="!lastCorrect" @click="quit">Change mode</button>
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
        <button v-else-if="!lastCorrect" class="primary" @click="newRound">Next noun →</button>
        <button v-if="!lastCorrect" @click="quit">Change mode</button>
      </div>
    </template>
  </section>
</template>
