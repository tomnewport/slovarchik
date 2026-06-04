<script setup>
// The session runner screen. Builds a session from the progress store, steps
// through its exercises, repeats mistakes until none remain, reports each
// result back to the store per dimension, and shows an end-of-session summary.
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { state as vocabState, phrases as vocabPhrases, initVocab } from '../stores/vocab.js'
import * as progress from '../stores/progress.js'
import { STATES } from '../lib/progression.js'
import { buildExercises } from '../lib/exerciseBuild.js'
import {
  initRunner,
  currentExercise,
  submit,
  skipDimension,
  runnerSummary,
  practiceSegments,
  firstPassProgress,
  isRepeating,
} from '../lib/sessionRunner.js'

import TypeExercise from '../components/exercises/TypeExercise.vue'
import WordBankExercise from '../components/exercises/WordBankExercise.vue'
import MatchExercise from '../components/exercises/MatchExercise.vue'
import SpeakExercise from '../components/exercises/SpeakExercise.vue'
import InflectExercise from '../components/exercises/InflectExercise.vue'
import CelebrationBurst from '../components/CelebrationBurst.vue'

const COMPONENTS = {
  type: TypeExercise,
  wordbank: WordBankExercise,
  match: MatchExercise,
  speak: SpeakExercise,
  inflect: InflectExercise,
}

const route = useRoute()
const router = useRouter()

const ready = ref(false)
const showConfirm = ref(false)
const startedAt = ref(0)
const finishedAt = ref(0)

// Snapshot of each target word's state before the session, to spot slips.
const startStates = new Map()
let session = null
let repSeq = 0

const runner = reactive(initRunner([]))
const current = computed(() => currentExercise(runner))
const currentComponent = computed(() => (current.value ? COMPONENTS[current.value.kind] : null))

function rank(stateName) {
  return STATES.indexOf(stateName)
}

async function setup() {
  if (!vocabState.words.length) await initVocab()
  if (!progress.state.loaded) await progress.loadProgress()

  const type = String(route.query.type ?? 'standard')
  const size = route.query.size ? String(route.query.size) : undefined
  session = progress.startSession({ type, size })

  const exercises = buildExercises(session, {
    words: vocabState.words,
    phrases: vocabPhrases.value,
  })
  for (const ex of exercises) {
    for (const key of ex.targets) {
      if (!startStates.has(key)) startStates.set(key, progress.stateOf(key))
    }
  }

  Object.assign(runner, initRunner(exercises))
  startedAt.value = Date.now()
  ready.value = true
  if (runner.phase === 'summary') finishedAt.value = Date.now()
}

setup()

function onDone(result) {
  const ex = current.value
  if (!ex) return
  for (const key of ex.targets ?? []) {
    progress.recordAttempt({
      word: key,
      dimension: ex.dimension,
      level: ex.level,
      correct: result.correct,
    })
  }
  submit(runner, result.correct)
  if (runner.phase === 'summary') finishedAt.value = Date.now()
}

// --- Skipping a modality (listening / speaking) -----------------------------

function makeReplacement(skipped) {
  const practice = {
    practiceType: 'spell-word',
    dimension: 'usage',
    level: 'learning',
    content: 'word',
    bucket: 'current',
    exercises: 1,
    pool: session?.pools?.current ?? [],
  }
  const [rep] = buildExercises({ practices: [practice] }, {
    words: vocabState.words,
    phrases: vocabPhrases.value,
  })
  if (!rep) return null
  rep.id = `rep${repSeq++}`
  rep.practiceIndex = skipped.practiceIndex
  return rep
}

function upcomingHas(dimension) {
  return runner.queue.slice(runner.pos).some((e) => e.dimension === dimension)
}
const canSkipListening = computed(
  () => !runner.skipped.includes('hearing') && upcomingHas('hearing'),
)
const canSkipSpeaking = computed(
  () => !runner.skipped.includes('speaking') && upcomingHas('speaking'),
)

function skip(dimension) {
  skipDimension(runner, dimension, makeReplacement)
  if (runner.phase === 'summary') finishedAt.value = Date.now()
}

// --- Progress bar + summary -------------------------------------------------

const segments = computed(() => practiceSegments(runner))
const overall = computed(() => Math.round(firstPassProgress(runner) * 100))

const summary = computed(() => {
  const base = runnerSummary(runner)
  const slipped = []
  for (const [key, before] of startStates) {
    if (rank(progress.stateOf(key)) < rank(before)) slipped.push(key)
  }
  const durationMs = finishedAt.value && startedAt.value ? finishedAt.value - startedAt.value : 0
  return { ...base, slipped, durationMs }
})

function durationLabel(ms) {
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

// Batches the learner just finished (every word at or above its target state).
const completedBatches = computed(() => {
  if (runner.phase !== 'summary') return []
  return ['learning', 'mastery']
    .filter((level) => progress.state[level] && progress.batchComplete(level))
    .map((level) => ({ level, batch: progress.state[level] }))
})

async function nextBatch(level) {
  await progress.advanceBatch(level)
  router.push({ path: '/batch', query: { level } })
}

function confirmClose() {
  showConfirm.value = false
  router.push('/')
}
</script>

<template>
  <section class="session">
    <header class="session-head">
      <button class="close" aria-label="Close session" @click="showConfirm = true">✕</button>
      <div class="bar" role="progressbar" :aria-valuenow="overall">
        <div v-for="seg in segments" :key="seg.practiceIndex" class="seg">
          <span
            v-for="cell in seg.exercises"
            :key="cell.id"
            class="cell"
            :class="{
              done: cell.done,
              ok: cell.correct === true,
              no: cell.correct === false,
              now: current && cell.id === current.id,
            }"
          />
        </div>
      </div>
      <span v-if="isRepeating(runner)" class="repeat muted">Fixing mistakes…</span>
    </header>

    <p v-if="!ready" class="muted">Loading…</p>

    <!-- Active exercise -->
    <div v-else-if="runner.phase === 'exercise' && current" class="exercise">
      <!-- Fold the submission count into the key so a repeated exercise (same
           id) remounts fresh instead of keeping its previous graded state. -->
      <component
        :is="currentComponent"
        :key="current.id + ':' + runner.log.length"
        :exercise="current"
        @done="onDone"
      />

      <div class="skips row">
        <button v-if="canSkipListening" class="skip" @click="skip('hearing')">Skip listening</button>
        <button v-if="canSkipSpeaking" class="skip" @click="skip('speaking')">Skip speaking</button>
      </div>
    </div>

    <!-- Summary -->
    <div v-else class="summary card">
      <!-- Batch completion celebration takes over the summary when earned. -->
      <div v-if="completedBatches.length" class="celebration" :class="completedBatches[0].level">
        <CelebrationBurst :show="true" />
        <div class="heart" aria-hidden="true">💚</div>
        <h2>Batch complete!</h2>
        <p>
          You {{ completedBatches[0].level === 'mastery' ? 'mastered' : 'learned' }}
          <strong class="batch-name">{{ completedBatches[0].batch.name }}</strong>.
        </p>
        <button class="primary next-batch" @click="nextBatch(completedBatches[0].level)">
          Choose the next batch →
        </button>
        <button class="ghost" @click="router.push('/')">Back home</button>
      </div>

      <template v-else>
        <h2>Session complete</h2>
        <p class="score">{{ summary.percent }}% correct</p>
        <p class="muted">
          {{ summary.correct }} / {{ summary.total }} first try ·
          {{ durationLabel(summary.durationMs) }}
        </p>
        <div v-if="summary.slipped.length" class="slipped">
          <p class="muted">Slipped — worth another look:</p>
          <ul>
            <li v-for="key in summary.slipped" :key="key" lang="ru">{{ key }}</li>
          </ul>
        </div>
        <button class="primary done" @click="router.push('/')">Done</button>
      </template>
    </div>

    <!-- Close confirmation -->
    <div v-if="showConfirm" class="modal-backdrop" @click.self="showConfirm = false">
      <div class="modal card" role="dialog" aria-modal="true">
        <p>End this session? Your progress so far is saved.</p>
        <div class="row">
          <button class="ghost" @click="showConfirm = false">Keep going</button>
          <button class="primary" @click="confirmClose">End session</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.session-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}
.close {
  flex: 0 0 auto;
  width: 2.2rem;
  height: 2.2rem;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
}
.bar {
  flex: 1 1 auto;
  display: flex;
  gap: 0.4rem;
}
.seg {
  flex: 1 1 0;
  display: flex;
  gap: 0.15rem;
}
.cell {
  flex: 1 1 0;
  height: 0.5rem;
  border-radius: 3px;
  background: var(--border);
}
.cell.done {
  background: var(--muted);
}
.cell.ok {
  background: var(--good);
}
.cell.no {
  background: var(--bad);
}
.cell.now {
  outline: 2px solid var(--primary);
}
.repeat {
  flex: 0 0 auto;
  font-size: 0.85rem;
}
.skips {
  margin-top: 1.5rem;
  gap: 0.5rem;
}
.skip {
  font-size: 0.85rem;
  color: var(--muted);
  background: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.35rem 0.6rem;
}
.summary {
  text-align: center;
  display: grid;
  gap: 0.5rem;
  padding: 2rem;
}
.score {
  font-size: 2rem;
  font-weight: 700;
}
.celebration {
  position: relative;
  display: grid;
  gap: 0.6rem;
  justify-items: center;
  padding: 1rem 0;
}
.celebration .heart {
  font-size: 3rem;
}
.celebration.mastery h2 {
  color: var(--gold);
}
.batch-name {
  text-transform: capitalize;
}
.next-batch {
  margin-top: 0.5rem;
}
.slipped ul {
  list-style: none;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: center;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.modal {
  max-width: 22rem;
  display: grid;
  gap: 1rem;
}
.ghost {
  background: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 0.5rem 0.9rem;
}
</style>
