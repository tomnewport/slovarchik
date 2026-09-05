<script setup>
// Generic inflection drill, shared by nouns, pronouns, verbs and adjectives.
// The part of speech comes from the route; three exercises drill the same
// paradigm table in increasing difficulty.
import { computed, reactive, ref, onUnmounted } from 'vue'

import { state } from '../stores/vocab.js'
import { buildParadigms, POS_TITLES } from '../lib/paradigm.js'
import { isCleanTable } from '../lib/tableStage.js'
import { sample } from '../lib/quiz.js'
import { isTableClean, markTableClean } from '../stores/progress.js'
import { resetHint } from '../stores/keyboard.js'
import CelebrationBurst from '../components/CelebrationBurst.vue'
import SpeakButton from '../components/SpeakButton.vue'
import IdentifyForm from '../components/inflection/IdentifyForm.vue'
import DragTable from '../components/inflection/DragTable.vue'
import BlindEndings from '../components/inflection/BlindEndings.vue'
import ParadigmShapeNote from '../components/inflection/ParadigmShapeNote.vue'

const props = defineProps({ pos: { type: String, default: 'noun' } })

const CELEBRATE_MS = 1000

const MODES = [
  { id: 'identify', label: 'Identify the form', help: 'Which slot(s) could a form be?', comp: IdentifyForm },
  { id: 'drag', label: 'Build the table', help: 'Drag each form into the right cell.', comp: DragTable },
  { id: 'endings', label: 'Type the endings', help: 'Type each ending — tap the keyboard’s 💡 if you’re stuck.', comp: BlindEndings },
]

const title = computed(() => POS_TITLES[props.pos] ?? 'Inflection')
const list = computed(() => buildParadigms(state.words, props.pos))
const ready = computed(() => list.value.length > 0)

/** Whether a paradigm has already been assembled cleanly from the word bank. */
function tableClean(p) {
  return isTableClean(p?.word?.key, p?.variant ?? null)
}

const mode = ref(null)
const paradigm = ref(null)
const round = ref(0)
const score = reactive({ right: 0, total: 0 })
const celebrating = ref(false)
const lastResult = ref(null)
let advanceTimer = null

const activeMode = computed(() => MODES.find((m) => m.id === mode.value) ?? null)
const showStem = computed(() => mode.value === 'endings')
// A big table the learner has never built cleanly is dealt one column at a time
// (#645); anything smaller, and any table already earned, comes whole.
const staged = computed(() => mode.value === 'drag' && !tableClean(paradigm.value))

function start(modeId) {
  mode.value = modeId
  score.right = 0
  score.total = 0
  resetHint() // each lesson starts with the keyboard hint off
  newRound()
}

function newRound() {
  clearTimeout(advanceTimer)
  celebrating.value = false
  lastResult.value = null
  // Avoid drawing the same paradigm twice in a row when there's a choice.
  const prev = paradigm.value
  let next = sample(list.value, 1)[0]
  if (list.value.length > 1) {
    while (next?.key === prev?.key) next = sample(list.value, 1)[0]
  }
  paradigm.value = next
  round.value += 1
}

function onGraded(correct, records = []) {
  if (lastResult.value) return
  const stressWarning =
    !!correct && records.some((record) => record.correct && record.stressCorrect === false)
  // Built with nothing in the wrong cell: this table is served whole from now
  // on (#645).
  if (mode.value === 'drag' && isCleanTable(records)) {
    markTableClean(paradigm.value?.word?.key, paradigm.value?.variant ?? null)
  }
  lastResult.value = { correct, stressWarning }
  score.total += 1
  if (correct) score.right += 1
  if (correct && !stressWarning) {
    celebrating.value = true
    advanceTimer = setTimeout(newRound, CELEBRATE_MS)
  }
}

function quit() {
  clearTimeout(advanceTimer)
  resetHint()
  celebrating.value = false
  mode.value = null
  paradigm.value = null
}

onUnmounted(() => {
  clearTimeout(advanceTimer)
  resetHint()
})
</script>

<template>
  <section v-if="!mode" class="grid">
    <h2 style="margin: 0">{{ title }}</h2>
    <p v-if="!ready && state.status === 'loading'" class="muted">Loading vocabulary…</p>
    <p v-else-if="!ready" class="feedback bad">
      No {{ pos }} forms available offline yet — connect once to download them.
    </p>
    <div class="grid">
      <button
        v-for="m in MODES"
        :key="m.id"
        class="card"
        style="text-align: left"
        :disabled="!ready"
        @click="start(m.id)"
      >
        <strong>{{ m.label }}</strong>
        <div class="muted">{{ m.help }}</div>
      </button>
    </div>
  </section>

  <section v-else class="grid" style="gap: 1.25rem; position: relative">
    <CelebrationBurst :show="celebrating" />
    <div class="row" style="justify-content: space-between">
      <span class="pill">{{ activeMode?.label }}</span>
      <span class="muted">Score: {{ score.right }} / {{ score.total }}</span>
    </div>

    <div v-if="paradigm" class="card" style="text-align: center">
      <div class="speak-row" style="justify-content: center">
        <span style="font-size: 1.6rem" lang="ru">{{ paradigm.lemma }}</span>
        <SpeakButton :text="paradigm.lemma" />
      </div>
      <div class="muted">
        {{ paradigm.en }}
        <span v-if="paradigm.variantLabel" class="pill">{{ paradigm.variantLabel }}</span>
        <span v-if="paradigm.cefr" class="pill">{{ paradigm.cefr }}</span>
        <template v-if="showStem && paradigm.stem"> · stem <b lang="ru">{{ paradigm.stem }}-</b></template>
      </div>
    </div>

    <!-- Why the rows/columns differ from the last word's, when they do. -->
    <ParadigmShapeNote v-if="paradigm" :paradigm="paradigm" />

    <component
      :is="activeMode.comp"
      v-if="paradigm"
      :key="round"
      :paradigm="paradigm"
      :staged="staged"
      @graded="onGraded"
    />

    <div class="row">
      <button
        v-if="lastResult && (!lastResult.correct || lastResult.stressWarning)"
        class="primary"
        @click="newRound"
      >
        Next →
      </button>
      <span v-if="lastResult && !lastResult.correct" class="feedback bad">Review the answers above.</span>
      <button @click="quit">Change mode</button>
    </div>
  </section>
</template>
