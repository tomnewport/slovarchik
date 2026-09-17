<script setup>
// Home: the launchpad for every session type, plus the current learning /
// mastery batch status. The learning batch is chosen by the user (on first
// visit and after completing a batch); the mastery batch is auto-selected.
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  state as progress,
  batchProgress,
  batchExerciseProgress,
  atRisk,
  lost,
  stateOf,
  hasContextDrill,
  hasInflections,
  isPendingConfirmation,
} from '../stores/progress.js'
import { state as reports, loadReports, removeReport } from '../stores/reports.js'
import { state as appUpdate, applyUpdate } from '../stores/appUpdate.js'
import { vocab } from '../stores/vocab.js'
import {
  LEARNING_DIMS,
  MASTERY_DIMS,
  buildWordList,
  buildStatusWordList,
} from '../lib/homeDashboard.js'
import { problemKeys } from '../lib/progressWords.js'
import BatchSearchAdd from '../components/BatchSearchAdd.vue'
import WordStatusCard from '../components/WordStatusCard.vue'
import WordProgressModal from '../components/WordProgressModal.vue'

const router = useRouter()

// The word whose progress-detail modal is open, or null.
const selectedWord = ref(null)

function startSession(type) {
  if (!progress.learning) {
    // Carry the session intent so batch selection continues into practice
    // rather than dropping the learner back on the home screen.
    router.push({ path: '/batch', query: { level: 'learning', next: 'session', type } })
    return
  }
  router.push({ path: '/session', query: { type } })
}

// Open-ended standalone drills (no progress tracking) — kept reachable as free
// practice alongside the tracked session flow.
const DRILLS = [
  { to: '/vocab', label: 'Vocabulary' },
  { to: '/declension', label: 'Nouns' },
  { to: '/adjectives', label: 'Adjectives' },
  { to: '/pronouns', label: 'Pronouns' },
  { to: '/verbs', label: 'Verbs' },
  { to: '/numbers', label: 'Numbers' },
  { to: '/phrases', label: 'Phrases' },
  { to: '/phrase-fix', label: 'Fix phrases' },
  { to: '/verb-government', label: 'Verb government' },
  { to: '/listening', label: 'Listening' },
  { to: '/speaking', label: 'Speaking' },
]

// Minigames (#726). Not drills: a game is a break from practice that happens
// to drill something, so they get their own section rather than a pill in the
// free-practice list — and they say which habit they are for, because that is
// the reason to pick one over another.
const MINIGAMES = [
  {
    to: '/bomb',
    icon: '💣',
    label: 'Bomb disposal',
    skill: 'Colours, and following a spoken instruction to the letter.',
  },
  {
    to: '/firewatch',
    icon: '🔥',
    label: 'Firewatch',
    skill: 'Building two-digit numbers, and saying them at speed.',
  },
]

function openDrill(to) {
  router.push(to)
}


onMounted(() => {
  if (!reports.loaded) loadReports()
})

const learningBatch = computed(() => progress.learning)
const masteryBatch = computed(() => progress.mastery)
const learningProgress = computed(() => batchProgress('learning'))
const masteryProgress = computed(() => batchProgress('mastery'))
const learningDone = computed(() => learningProgress.value.filter((w) => w.done).length)
const masteryDone = computed(() => masteryProgress.value.filter((w) => w.done).length)
// Exercise-based progress: how close the batch is to done, measured in the
// minimum exercises still needed now versus when it was freshly committed.
const learningExercise = computed(() => batchExerciseProgress('learning'))
const masteryExercise = computed(() => batchExerciseProgress('mastery'))
const vocabByKey = computed(() => new Map(vocab.value.map((word) => [word.id, word])))

// Injected into the pure builders so they stay free of the store.
const wordListCtx = computed(() => ({
  records: progress.records,
  vocabByKey: vocabByKey.value,
  hasContextDrill,
  isPendingConfirmation,
}))

const allLearningWords = computed(() =>
  buildWordList(learningProgress.value, 'learning', LEARNING_DIMS, wordListCtx.value),
)
const allMasteryWords = computed(() =>
  buildWordList(masteryProgress.value, 'mastery', MASTERY_DIMS, wordListCtx.value),
)

const statusCtx = computed(() => ({
  records: progress.records,
  vocabByKey: vocabByKey.value,
  stateOf,
  hasContextDrill,
  hasInflections,
}))
const problemWords = computed(() =>
  buildStatusWordList(problemKeys(lost.value, atRisk.value), statusCtx.value),
)

function submitPendingReport(report) {
  window.open(report.url, '_blank', 'noopener')
}

const FOCUSED = [
  { type: 'speaking', label: 'Speaking', icon: '🗣️' },
  { type: 'listening', label: 'Listening', icon: '🎧' },
  { type: 'words', label: 'Words', icon: '📚' },
  { type: 'phrases', label: 'Phrases', icon: '💬' },
  { type: 'grammar', label: 'Grammar', icon: '🧩' },
]
</script>

<template>
  <section class="grid" style="gap: 1.25rem">
    <!-- A newer build is installed and waiting — taken when asked for, never
         mid-question (#691). -->
    <div v-if="appUpdate.available" class="card update-banner">
      <p class="update-title">
        <strong>A new version is ready.</strong>
        <span class="muted">It'll be used next time you update — nothing is lost.</span>
      </p>
      <button class="apply-update" :disabled="appUpdate.applying" @click="applyUpdate">
        {{ appUpdate.applying ? 'Updating…' : 'Update now' }}
      </button>
    </div>

    <!-- Pending offline issue reports -->
    <div v-if="reports.pending.length" class="pending-reports card">
      <p class="pending-title">
        You have {{ reports.pending.length }} issue report{{ reports.pending.length === 1 ? '' : 's' }} waiting to submit.
      </p>
      <ul class="report-list">
        <li v-for="r in reports.pending" :key="r.id" class="report-row">
          <span class="report-label">{{ r.ru ?? '(unknown)' }} — {{ r.en ?? '' }}</span>
          <div class="report-actions">
            <button class="submit-report" @click="submitPendingReport(r)">Submit →</button>
            <button class="dismiss-report" :aria-label="`Dismiss report for ${r.ru ?? 'unknown'}`" @click="removeReport(r.id)">✕</button>
          </div>
        </li>
      </ul>
    </div>

    <!-- Batch overview: progress bars only -->
    <button
      v-if="!learningBatch"
      class="card choose-batch"
      @click="router.push({ path: '/batch', query: { level: 'learning' } })"
    >
      <span class="batch-kind learn-kind">Learning</span>
      <span class="muted">Choose words to learn →</span>
    </button>
    <div v-else class="card batches-card">
      <div class="batch-list">
        <div class="batch-row">
          <div
            class="exercise-bar"
            role="progressbar"
            :aria-valuenow="Math.round(learningExercise.fraction * 100)"
            :aria-valuemin="0"
            :aria-valuemax="100"
            :aria-label="`Learning batch ${learningExercise.remaining} exercises remaining`"
            :title="learningExercise.remaining
              ? `${learningExercise.remaining} of ${learningExercise.fresh} exercises to go`
              : 'All exercises complete'"
          >
            <div
              class="exercise-fill learn-fill"
              :style="{ width: Math.round(learningExercise.fraction * 100) + '%' }"
            />
          </div>
          <div class="batch-meta">
            <span class="batch-kind learn-kind">Learning</span>
            <span class="batch-name">{{ learningBatch.name }}</span>
            <span class="batch-count muted">{{ learningDone }} / {{ learningBatch.size }}</span>
          </div>
          <div class="batch-bar">
            <div
              class="batch-fill learn-fill"
              :style="{ width: (learningBatch.size ? (learningDone / learningBatch.size) * 100 : 0) + '%' }"
            />
          </div>
        </div>
        <div v-if="masteryBatch" class="batch-row">
          <div
            class="exercise-bar"
            role="progressbar"
            :aria-valuenow="Math.round(masteryExercise.fraction * 100)"
            :aria-valuemin="0"
            :aria-valuemax="100"
            :aria-label="`Mastery batch ${masteryExercise.remaining} exercises remaining`"
            :title="masteryExercise.remaining
              ? `${masteryExercise.remaining} of ${masteryExercise.fresh} exercises to go`
              : 'All exercises complete'"
          >
            <div
              class="exercise-fill master-fill"
              :style="{ width: Math.round(masteryExercise.fraction * 100) + '%' }"
            />
          </div>
          <div class="batch-meta">
            <span class="batch-kind master-kind">Mastering</span>
            <span class="batch-name">{{ masteryBatch.name }}</span>
            <span class="batch-count muted">{{ masteryDone }} / {{ masteryBatch.size }}</span>
          </div>
          <div class="batch-bar">
            <div
              class="batch-fill master-fill"
              :style="{ width: (masteryBatch.size ? (masteryDone / masteryBatch.size) * 100 : 0) + '%' }"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Standard session -->
    <div class="card standard">
      <h2>Practice</h2>
      <p class="muted">A balanced mix — half new words, half reinforcement.</p>
      <button class="primary start-session" @click="startSession('standard')">
        Start session <small>12 practices</small>
      </button>
    </div>

    <!-- Focused sessions -->
    <div class="row focused">
      <button
        v-for="f in FOCUSED"
        :key="f.type"
        class="focus-btn"
        @click="startSession(f.type)"
      >
        <span class="icon">{{ f.icon }}</span>{{ f.label }}
      </button>
    </div>

    <!-- Slipped and at-risk words share one list; each row still explains its
         own recovery steps and opens the word card. -->
    <WordStatusCard
      v-if="problemWords.length"
      :words="problemWords"
      @select="selectedWord = $event"
    />

    <!-- Current batch word lists -->
    <div v-if="learningBatch && allLearningWords.length" class="card word-list-card">
      <div class="status-header">
        <span class="status-label learn-kind">Learning</span>
        <span class="batch-name">{{ learningBatch.name }}</span>
      </div>
      <div class="word-scroll">
        <div
          v-for="w in allLearningWords"
          :key="w.key"
          class="word-row clickable"
          :class="{ 'word-done': w.done, 'word-pending': w.pending }"
          role="button"
          tabindex="0"
          @click="selectedWord = w.key"
          @keydown.enter="selectedWord = w.key"
          @keydown.space.prevent="selectedWord = w.key"
        >
          <div class="word-label" :title="w.fullEn">
            <span class="word-ru">{{ w.ru }}</span>
            <span class="word-en muted">{{ w.en }}</span>
            <span
              v-if="w.pending"
              class="pending-mark"
              title="Learned — a review tomorrow will confirm it"
            >⏳</span>
          </div>
          <div class="word-dims">
            <span
              v-for="d in w.dims"
              :key="d.name"
              class="dim-pip"
              :class="d.met ? 'dim-met' : d.attempts > 0 ? 'dim-partial' : 'dim-empty'"
              :title="d.name"
            >{{ d.label }}</span>
          </div>
        </div>
      </div>
      <BatchSearchAdd level="learning" />
    </div>
    <div v-if="masteryBatch && allMasteryWords.length" class="card word-list-card">
      <div class="status-header">
        <span class="status-label master-kind">Mastering</span>
        <span class="batch-name">{{ masteryBatch.name }}</span>
      </div>
      <div class="word-scroll">
        <div
          v-for="w in allMasteryWords"
          :key="w.key"
          class="word-row clickable"
          :class="{ 'word-done': w.done, 'word-pending': w.pending }"
          role="button"
          tabindex="0"
          @click="selectedWord = w.key"
          @keydown.enter="selectedWord = w.key"
          @keydown.space.prevent="selectedWord = w.key"
        >
          <div class="word-label" :title="w.fullEn">
            <span class="word-ru">{{ w.ru }}</span>
            <span class="word-en muted">{{ w.en }}</span>
            <span
              v-if="w.pending"
              class="pending-mark"
              title="Learned — a review tomorrow will confirm it"
            >⏳</span>
          </div>
          <div class="word-dims">
            <span
              v-for="d in w.dims"
              :key="d.name"
              class="dim-pip"
              :class="d.met ? 'dim-met' : d.attempts > 0 ? 'dim-partial' : 'dim-empty'"
              :title="d.name"
            >{{ d.label }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Open-ended free-practice drills -->
    <details class="free">
      <summary>Free practice</summary>
      <p class="muted">Open-ended drills — these don't track progress.</p>
      <div class="row links">
        <button v-for="d in DRILLS" :key="d.to" class="pill drill" @click="openDrill(d.to)">
          {{ d.label }}
        </button>
      </div>
    </details>

    <!-- Minigames -->
    <div class="card minigames">
      <h2>Minigames</h2>
      <p class="muted">Short games to make a habit automatic. They don't track progress.</p>
      <div class="grid games">
        <button v-for="g in MINIGAMES" :key="g.to" class="game" @click="openDrill(g.to)">
          <span class="game-icon" aria-hidden="true">{{ g.icon }}</span>
          <span class="game-text">
            <strong>{{ g.label }}</strong>
            <span class="muted">{{ g.skill }}</span>
          </span>
        </button>
      </div>
    </div>

    <WordProgressModal
      v-if="selectedWord"
      :word-key="selectedWord"
      @close="selectedWord = null"
      @left="selectedWord = null"
      @open-word="selectedWord = $event"
    />
  </section>
</template>

<style scoped>
.choose-batch {
  display: grid;
  gap: 0.2rem;
  text-align: left;
  cursor: pointer;
  border-left: 4px solid var(--good);
}
.batch-list {
  display: grid;
  gap: 0.75rem;
}
.batch-row {
  display: grid;
  gap: 0.35rem;
}
.exercise-bar {
  height: 10px;
  background: var(--bg-soft);
  border-radius: 5px;
  overflow: hidden;
}
.exercise-fill {
  height: 100%;
  border-radius: 5px;
  opacity: 0.85;
  transition: width 0.3s ease;
}
.batch-meta {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}
.batch-kind {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  flex-shrink: 0;
}
.learn-kind {
  color: var(--good);
}
.master-kind {
  color: var(--gold);
}
.batch-name {
  font-weight: 500;
  flex: 1;
}
.batch-count {
  font-size: 0.85rem;
  flex-shrink: 0;
}
.batch-bar {
  height: 6px;
  background: var(--bg-soft);
  border-radius: 3px;
  overflow: hidden;
}
.batch-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.learn-fill {
  background: var(--good);
}
.master-fill {
  background: var(--gold);
}
.word-done .word-ru,
.word-done .word-en {
  opacity: 0.4;
}
/* Done by criteria but awaiting the overnight confirmation review (#313):
   dimmed like done, with an hourglass instead of full fade. */
.word-pending .word-ru,
.word-pending .word-en {
  opacity: 0.6;
}
.pending-mark {
  font-size: 0.75rem;
  cursor: help;
}
.standard h2 {
  margin: 0 0 0.25rem;
}
.start-session {
  width: 100%;
  margin-top: 0.75rem;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.9rem 0.5rem;
}
.start-session small {
  opacity: 0.8;
  font-weight: 400;
}
.focused {
  gap: 0.5rem;
}
.focus-btn {
  flex: 1 1 6rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.75rem 0.5rem;
}
.icon {
  font-size: 1.3rem;
}
.free summary {
  cursor: pointer;
  color: var(--muted);
}
.free .links {
  margin-top: 0.5rem;
  gap: 0.4rem;
}
.drill {
  cursor: pointer;
  background: var(--bg-soft);
  color: var(--text);
}
.minigames .games {
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.game {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.7rem 0.85rem;
  text-align: left;
  cursor: pointer;
  background: var(--bg-soft);
  color: var(--text);
}
.game-icon {
  font-size: 1.6rem;
  line-height: 1;
}
.game-text {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}
.game-text .muted {
  font-size: 0.85rem;
}
.update-banner {
  border-left: 4px solid var(--primary);
  padding: 0.9rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.update-title {
  margin: 0;
  font-size: 0.9rem;
  display: grid;
  gap: 0.15rem;
}
.apply-update {
  flex: 0 0 auto;
  font-size: 0.85rem;
  padding: 0.35rem 0.8rem;
  border: 1px solid var(--primary);
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  cursor: pointer;
}
.apply-update:disabled {
  opacity: 0.6;
  cursor: default;
}
.pending-reports {
  border-left: 4px solid var(--muted);
  padding: 0.9rem 1rem;
  display: grid;
  gap: 0.5rem;
}
.pending-title {
  margin: 0;
  font-size: 0.9rem;
}
.report-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.35rem;
}
.report-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.report-actions {
  display: flex;
  gap: 0.35rem;
  flex: 0 0 auto;
}
.report-label {
  font-size: 0.85rem;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.submit-report {
  flex: 0 0 auto;
  font-size: 0.8rem;
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: none;
  color: var(--text);
  cursor: pointer;
}
.submit-report:hover {
  border-color: var(--muted);
}
.dismiss-report {
  font-size: 0.75rem;
  padding: 0.2rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.dismiss-report:hover {
  color: var(--text);
  border-color: var(--muted);
}
.word-list-card {
  display: grid;
  gap: 0.6rem;
}
</style>
