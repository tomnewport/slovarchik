<script setup>
// The session runner screen. Builds a session from the progress store, steps
// through its exercises, repeats mistakes until none remain, reports each
// result back to the store per dimension, and shows an end-of-session summary.
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { state as vocabState, phrases as vocabPhrases, initVocab } from '../stores/vocab.js'
import * as progress from '../stores/progress.js'
import { loadSettings, playCelebration } from '../stores/settings.js'
import { warmAudio } from '../lib/feedbackSound.js'
import { STATES } from '../lib/progression.js'
import { buildExercises, makeVisualReplacement } from '../lib/exerciseBuild.js'
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
import AchievementBadge from '../components/AchievementBadge.vue'
import ReportButton from '../components/ReportButton.vue'
import { submitReport } from '../stores/reports.js'

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
  // Settings are preloaded at app boot (main.js); ensure them here too for a
  // deep link straight into a session. Non-blocking — the read resolves long
  // before the first answer, and playFeedback falls back to defaults until then.
  loadSettings()
  // Assemble a mastery batch as soon as enough words are learned — this does not
  // wait for the learning batch (or a previous mastery batch) to be completed.
  await progress.ensureMasteryBatch()

  const type = String(route.query.type ?? 'standard')
  const size = route.query.size ? String(route.query.size) : undefined
  // A focused session restricts the whole session to words matching a skill.
  // An unknown skill (or one with no eligible words) yields an empty list —
  // normalise that to null so we fall back to a normal session, not an empty one.
  const resolved = route.query.focus ? progress.focusKeysFor(String(route.query.focus)) : null
  const focusKeys = resolved && resolved.length ? resolved : null
  session = progress.startSession({ type, size, focusKeys })

  // For a focused session, draw (and top up) only from the filtered words.
  let words = vocabState.words
  let phrases = vocabPhrases.value
  if (focusKeys) {
    const set = new Set(focusKeys)
    words = vocabState.words.filter((w) => set.has(w.key))
    phrases = vocabPhrases.value.filter((p) => set.has(p.source))
  }

  const exercises = buildExercises(session, { words, phrases, encounterCount: progress.encounterCount })
  for (const ex of exercises) {
    for (const key of ex.targets) {
      if (!startStates.has(key)) startStates.set(key, progress.stateOf(key))
    }
  }

  Object.assign(runner, initRunner(exercises))
  startedAt.value = Date.now()
  ready.value = true
  await finalizeIfDone()
}

setup()

// Snapshot of the batches finished this session (cleared from the store on
// entry to the summary, so leaving via "Back home" can't strand a completed
// batch and re-trigger the celebration next time).
const celebrated = ref([])
// New achievements unlocked during this session.
const newAchievements = ref([])
let finalized = false

async function finalizeIfDone() {
  if (runner.phase !== 'summary' || finalized) return
  finalized = true
  finishedAt.value = Date.now()
  // Capture pending achievements before acknowledging so they show in the summary.
  newAchievements.value = [...progress.pendingAchievements.value]
  // Capture and advance every completed batch (a session can finish both the
  // learning and the mastery batch at once).
  celebrated.value = ['learning', 'mastery']
    .filter((level) => progress.state[level] && progress.batchComplete(level))
    .map((level) => ({ level, batch: progress.state[level] }))
  for (const { level } of celebrated.value) progress.advanceBatch(level)
  if (celebrated.value.length || newAchievements.value.length) playCelebration()
  // Auto-commit next mastery batch so it is ready when the learner returns home.
  if (celebrated.value.some((c) => c.level === 'mastery')) {
    progress.autoCommitMasteryBatch()
  }
  // Mark all earned achievements as seen so they won't re-appear.
  await progress.acknowledgeAchievements()
}

async function onDone(result) {
  // Unlock/resume the AudioContext while still inside the user-gesture callback,
  // before any awaits. This ensures the celebration sound can fire later (#214).
  warmAudio()
  const ex = current.value
  if (!ex) return
  // result.wrong (matching exercises) lists the specific missed keys; everything
  // else reports a single result.correct that applies to every target.
  const wrong = result.wrong ? new Set(result.wrong) : null
  // A correct answer typed without the keyboard hint counts double: record the
  // attempt twice (in one write) so the word advances toward learned/mastered
  // faster (#210).
  const times = result.double ? 2 : 1
  let firstError = null
  for (const key of (ex.targets ?? []).filter(Boolean)) {
    try {
      await progress.recordAttempt({
        word: key,
        dimension: ex.dimension,
        level: ex.level,
        correct: wrong ? !wrong.has(key) : result.correct,
        times,
      })
    } catch (e) {
      if (!firstError) firstError = e
    }
  }
  // Always advance the session even if a persistence write failed, so the
  // exercise doesn't freeze. The error is re-thrown afterwards so Vue's global
  // errorHandler can surface it to the user.
  submit(runner, result.correct)
  await finalizeIfDone()
  if (firstError) throw firstError
}

// Honesty system: the learner overrode a "wrong" word-bank grade, claiming a
// valid alternative translation. Open a pre-filled report so it can be curated.
function onDispute({ submitted }) {
  const ex = current.value
  if (!ex) return
  submitReport({
    ru: ex.ru ?? ex.lemma,
    en: ex.en,
    kind: ex.kind,
    dimension: ex.dimension,
    content: ex.content,
    practiceType: ex.practiceType,
    submitted,
    vocabVersion: vocabState.vocabVersion,
    lastSyncedAt: vocabState.lastSyncedAt,
    commitHash: __APP_COMMIT_HASH__,
  })
}

// --- Skipping a modality (listening / speaking) -----------------------------

function makeReplacement(skipped) {
  return makeVisualReplacement(skipped, repSeq++)
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

async function skip(dimension) {
  skipDimension(runner, dimension, makeReplacement)
  await finalizeIfDone()
}

// --- Progress bar + summary -------------------------------------------------

const segments = computed(() => practiceSegments(runner))
const overall = computed(() => Math.round(firstPassProgress(runner) * 100))

const wordStatus = computed(() => {
  if (!current.value?.targets?.length) return null
  const lostSet = new Set(progress.lost.value)
  const riskSet = new Set(progress.atRisk.value)
  for (const key of current.value.targets) {
    if (lostSet.has(key)) return 'slipped'
  }
  for (const key of current.value.targets) {
    if (riskSet.has(key)) return 'at-risk'
  }
  return null
})

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

// After a learning batch completes, route to batch selection so the learner
// can choose what to study next. Mastery batches are auto-committed in
// finalizeIfDone(), so just return home.
function nextBatch(level) {
  if (level === 'mastery') {
    router.push('/')
  } else {
    router.push({ path: '/batch', query: { level } })
  }
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
      <span v-if="wordStatus" class="word-status" :class="wordStatus">
        {{ wordStatus === 'slipped' ? 'Slipped' : 'At risk' }}
      </span>
      <!-- Fold the submission count into the key so a repeated exercise (same
           id) remounts fresh instead of keeping its previous graded state. -->
      <component
        :is="currentComponent"
        :key="current.id + ':' + runner.log.length"
        :exercise="current"
        @done="onDone"
        @dispute="onDispute"
      />

      <div class="skips row">
        <button v-if="canSkipListening" class="skip" @click="skip('hearing')">Skip listening</button>
        <button v-if="canSkipSpeaking" class="skip" @click="skip('speaking')">Skip speaking</button>
        <ReportButton
          :exercise="current"
          :vocab-version="vocabState.vocabVersion"
          :last-synced-at="vocabState.lastSyncedAt"
        />
      </div>
    </div>

    <!-- Summary -->
    <div v-else class="summary card">
      <!-- Batch completion celebration takes over the summary when earned. -->
      <div v-if="celebrated.length" class="celebration" :class="celebrated[0].level">
        <CelebrationBurst :show="true" />
        <div class="heart" aria-hidden="true">💚</div>
        <h2>Batch complete!</h2>
        <p v-for="done in celebrated" :key="done.level">
          You {{ done.level === 'mastery' ? 'mastered' : 'learned' }}
          <strong class="batch-name">{{ done.batch.name }}</strong>.
        </p>
        <div v-if="newAchievements.length" class="achievements-row">
          <AchievementBadge
            v-for="a in newAchievements"
            :key="a.id"
            :icon="a.icon"
            :label="a.label"
            :desc="a.desc"
            :unlocked="true"
            variant="inline"
          />
        </div>
        <button class="primary next-batch" @click="nextBatch(celebrated[0].level)">
          {{ celebrated[0].level === 'mastery' ? 'Keep going →' : 'Choose the next batch →' }}
        </button>
        <button class="ghost" @click="router.push('/')">Back home</button>
      </div>

      <template v-else>
        <!-- Achievement-only celebration when milestones were reached. -->
        <template v-if="newAchievements.length">
          <CelebrationBurst :show="true" />
          <div class="achievement-fanfare" aria-live="polite">
            <div class="fanfare-icon">{{ newAchievements[0].icon }}</div>
            <h2>{{ newAchievements.length === 1 ? 'Achievement unlocked!' : 'Achievements unlocked!' }}</h2>
            <div class="achievements-row">
              <AchievementBadge
                v-for="a in newAchievements"
                :key="a.id"
                :icon="a.icon"
                :label="a.label"
                :desc="a.desc"
                :unlocked="true"
                variant="inline"
              />
            </div>
          </div>
        </template>
        <h2 v-else>Session complete</h2>
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
.word-status {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.15rem 0.5rem;
  border-radius: 5px;
  margin-bottom: 0.75rem;
}
.word-status.slipped {
  background: rgba(255, 92, 92, 0.15);
  color: var(--bad);
  border: 1px solid rgba(255, 92, 92, 0.3);
}
.word-status.at-risk {
  background: rgba(255, 209, 102, 0.12);
  color: var(--gold);
  border: 1px solid rgba(255, 209, 102, 0.3);
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
.achievements-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
  margin: 0.25rem 0;
}
.achievement-fanfare {
  display: grid;
  gap: 0.5rem;
  justify-items: center;
}
.fanfare-icon {
  font-size: 3rem;
  line-height: 1;
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
