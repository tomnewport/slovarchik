<script setup>
// Home: the launchpad for every session type, plus the current learning /
// mastery batch status. The learning batch is chosen by the user (on first
// visit and after completing a batch); the mastery batch is auto-selected.
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import { state as progress, batchProgress } from '../stores/progress.js'
import { state as reports, loadReports, removeReport } from '../stores/reports.js'
import { parseKey } from '../lib/vocabBuild.js'
import { dimensionProgress, lastAttemptAt } from '../lib/progression.js'

const router = useRouter()

function startSession(type, size) {
  if (!progress.learning) {
    // Carry the session intent so batch selection continues into practice
    // rather than dropping the learner back on the home screen.
    const query = { level: 'learning', next: 'session', type }
    if (size) query.size = size
    router.push({ path: '/batch', query })
    return
  }
  router.push({ path: '/session', query: size ? { type, size } : { type } })
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
  { to: '/listening', label: 'Listening' },
  { to: '/speaking', label: 'Speaking' },
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

const LEARNING_DIMS = ['identification', 'usage', 'hearing', 'speaking']
const MASTERY_DIMS = ['identification', 'usage', 'hearing']
const DIM_LABEL = { identification: '👁️', usage: '✍️', hearing: '👂', speaking: '🗣️' }

function buildWordList(batchWords, level, dims) {
  return batchWords
    .map((w) => {
      const events = progress.records[w.word]?.events ?? []
      const { ru, en } = parseKey(w.word)
      return {
        key: w.word,
        ru,
        en,
        done: w.done,
        lastAt: lastAttemptAt(events) ?? 0,
        dims: dims.map((d) => ({
          label: DIM_LABEL[d],
          name: d,
          ...dimensionProgress(events, level, d),
        })),
      }
    })
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      return b.lastAt - a.lastAt
    })
}

const allLearningWords = computed(() => buildWordList(learningProgress.value, 'learning', LEARNING_DIMS))
const allMasteryWords = computed(() => buildWordList(masteryProgress.value, 'mastery', MASTERY_DIMS))

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

    <!-- Current batches -->
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
        <div v-if="allLearningWords.length" class="word-scroll">
          <div v-for="w in allLearningWords" :key="w.key" class="word-row" :class="{ 'word-done': w.done }">
            <div class="word-label">
              <span class="word-ru">{{ w.ru }}</span>
              <span class="word-en muted">{{ w.en }}</span>
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
        <div v-if="masteryBatch" class="batch-row">
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
        <div v-if="masteryBatch && allMasteryWords.length" class="word-scroll">
          <div v-for="w in allMasteryWords" :key="w.key" class="word-row" :class="{ 'word-done': w.done }">
            <div class="word-label">
              <span class="word-ru">{{ w.ru }}</span>
              <span class="word-en muted">{{ w.en }}</span>
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
    </div>

    <!-- Standard session: Quick / Normal / Super -->
    <div class="card standard">
      <h2>Practice</h2>
      <p class="muted">A balanced mix — half new words, half reinforcement.</p>
      <div class="row sizes">
        <button class="primary size quick" @click="startSession('standard', 'quick')">
          Quick<small>4</small>
        </button>
        <button class="primary size normal" @click="startSession('standard', 'normal')">
          Normal<small>12</small>
        </button>
        <button class="primary size super" @click="startSession('standard', 'super')">
          Super<small>20</small>
        </button>
      </div>
    </div>

    <!-- Hands-free spoken practice -->
    <button class="card handsfree" @click="router.push('/practice')">
      <span class="hf-icon">🎤</span>
      <span class="hf-text">
        <strong>Hands-free</strong>
        <span class="muted">Eyes-up, voice-only spoken practice — just say “давай”.</span>
      </span>
    </button>

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
.word-scroll {
  display: grid;
  gap: 0.45rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--border);
  margin-top: 0.1rem;
  max-height: 13rem;
  overflow-y: auto;
  padding-right: 0.25rem;
}
.word-done .word-ru,
.word-done .word-en {
  opacity: 0.4;
}
.word-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.word-label {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  min-width: 0;
  overflow: hidden;
}
.word-ru {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.9rem;
}
.word-en {
  font-size: 0.78rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.word-dims {
  display: flex;
  gap: 0.2rem;
  flex-shrink: 0;
}
.dim-pip {
  font-size: 0.9rem;
  width: 1.4rem;
  height: 1.4rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dim-met {
  opacity: 1;
}
.dim-partial {
  opacity: 0.55;
}
.dim-empty {
  opacity: 0.2;
}
.standard h2 {
  margin: 0 0 0.25rem;
}
.sizes {
  margin-top: 0.75rem;
}
.size {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  padding: 0.9rem 0.5rem;
}
.size small {
  opacity: 0.8;
  font-weight: 400;
}
.handsfree {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  text-align: left;
  cursor: pointer;
  border-left: 4px solid var(--primary);
}
.hf-icon {
  font-size: 1.8rem;
}
.hf-text {
  display: grid;
  gap: 0.15rem;
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
</style>
