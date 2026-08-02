<script setup>
// The session runner screen. Builds a session from the progress store, steps
// through its exercises, repeats mistakes until none remain, reports each
// result back to the store per dimension, and shows an end-of-session summary.
import { computed, nextTick, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { state as vocabState, phrases as vocabPhrases, initVocab } from '../stores/vocab.js'
import * as progress from '../stores/progress.js'
import { loadSettings, playCelebration } from '../stores/settings.js'
import { warmAudio } from '../lib/feedbackSound.js'
import { STATES } from '../lib/progression.js'
import {
  buildExercises,
  makeVisualReplacement,
  makeReplacementPicker,
} from '../lib/exerciseBuild.js'
import {
  collectMatchResult,
  buildFlashcardRepeatBoards,
  orderPhrasesBySource,
  durationLabel,
} from '../lib/flashcardRepeat.js'
import { shapeVocab } from '../lib/vocabBuild.js'
import {
  initRunner,
  currentExercise,
  submit,
  skipDimension,
  startExtraRound,
  runnerSummary,
  firstPassProgress,
  isRepeating,
} from '../lib/sessionRunner.js'

import TypeExercise from '../components/exercises/TypeExercise.vue'
import WordBankExercise from '../components/exercises/WordBankExercise.vue'
import FlashcardExercise from '../components/exercises/FlashcardExercise.vue'
import SpeakExercise from '../components/exercises/SpeakExercise.vue'
import InflectExercise from '../components/exercises/InflectExercise.vue'
import PhraseFixExercise from '../components/exercises/PhraseFixExercise.vue'
import AspectDrillExercise from '../components/exercises/AspectDrillExercise.vue'
import CelebrationBurst from '../components/CelebrationBurst.vue'
import AchievementBadge from '../components/AchievementBadge.vue'
import ReportButton from '../components/ReportButton.vue'
import { submitReport } from '../stores/reports.js'

const COMPONENTS = {
  type: TypeExercise,
  wordbank: WordBankExercise,
  match: FlashcardExercise,
  speak: SpeakExercise,
  inflect: InflectExercise,
  'phrase-fix': PhraseFixExercise,
  'aspect-drill': AspectDrillExercise,
}

const route = useRoute()
const router = useRouter()

const ready = ref(false)
const showConfirm = ref(false)
const startedAt = ref(0)
const finishedAt = ref(0)

// Snapshot of each target word's state before the session, to spot slips.
const startStates = new Map()
// Words that entered the session still pending their confirmation review
// (#313) — so the summary can celebrate the ones confirmed this session.
const startPending = new Set()
// Snapshot of each batch's exercise-progress fraction before the session, so we
// can show how far the bar moved this session.
const startExercise = { learning: 1, mastery: 1 }
let session = null
let repSeq = 0
// Vocab/phrase sources for re-prioritised skip replacements (set in setup()).
let vocabById = new Map()
let sessionPhrases = []

// Flashcard word-level repeat (#472): rather than replaying whole match boards,
// every word missed on a board across the whole session is collected and
// replayed once as a combined board at the end, topped up with the weakest
// correctly-guessed words. Reading (identification) and listening (hearing)
// misses are kept apart so each replays in its own modality — a heard-word miss
// comes back as a heard-word board. Both maps are keyed by dimension:
// `flashcardWrong` is the current collection window (reset each time a board is
// built, so the board's own misses re-seed the next one); `flashcardCorrect` is
// every correctly-guessed word — the top-up candidates. `flashcardOptions` is
// the shared autocomplete pool, reused for the combined boards.
const flashcards = { wrong: new Map(), correct: new Map() }
let flashcardOptions = []

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
  // Baseline the batch bars before any answers land this session.
  for (const level of ['learning', 'mastery']) {
    startExercise[level] = progress.batchExerciseProgress(level).fraction
  }

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

  // Keep the shaped vocab + phrases around so skipping a modality can draw
  // re-prioritised replacement content (see buildReplacementPicker).
  vocabById = new Map(shapeVocab(words).map((v) => [v.id, v]))
  sessionPhrases = phrases

  const exercises = buildExercises(session, {
    words,
    phrases,
    encounterCount: progress.encounterCount,
    contextPhrases: vocabState.contextPhrases,
    rules: vocabState.rules,
  })
  for (const ex of exercises) {
    for (const key of ex.targets) {
      if (!startStates.has(key)) startStates.set(key, progress.stateOf(key))
      if (progress.isPendingConfirmation(key)) startPending.add(key)
    }
  }

  // Reuse the whole-dictionary autocomplete pool the builder attached to the
  // match boards for the combined flashcard-repeat board (#472/#473).
  flashcardOptions = exercises.find((e) => e.kind === 'match')?.options ?? []

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
// Batches whose exercise-progress bar moved more than this fraction get an
// animated "look how far you came" bar (and the celebration sound) in the
// summary. Completed batches are excluded — they get the full celebration.
const BATCH_GAIN_THRESHOLD = 0.05
const batchGains = ref([])
// Live width (%) the animated gain bars are tweening toward, keyed by level.
const gainWidth = reactive({ learning: 0, mastery: 0 })
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
  // Before advancing, note any still-open batch whose bar climbed enough this
  // session to be worth celebrating in its own right.
  batchGains.value = ['learning', 'mastery']
    .filter((level) => progress.state[level] && !progress.batchComplete(level))
    .map((level) => ({
      level,
      name: progress.state[level].name,
      from: startExercise[level],
      to: progress.batchExerciseProgress(level).fraction,
    }))
    .filter((g) => g.to - g.from > BATCH_GAIN_THRESHOLD)
  for (const { level } of celebrated.value) progress.advanceBatch(level)
  if (celebrated.value.length || newAchievements.value.length || batchGains.value.length) {
    playCelebration()
  }
  // Tween each gain bar from its start fraction up to its new one. Render at the
  // start width first, then bump to the target on the next frame so the CSS
  // width transition animates the climb.
  if (batchGains.value.length) {
    for (const g of batchGains.value) gainWidth[g.level] = g.from * 100
    nextTick(() => {
      requestAnimationFrame(() => {
        for (const g of batchGains.value) gainWidth[g.level] = g.to * 100
      })
    })
  }
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
  // One-off speaking skip: recognition is misbehaving on this word right now.
  // Advance past just this exercise without recording an attempt — so it isn't
  // marked wrong or re-queued, and nothing is waived permanently. The word stays
  // eligible for speaking again in a later session.
  if (result.skip) {
    submit(runner, true)
    injectFlashcardRepeat()
    await finalizeIfDone()
    return
  }
  // result.wrong (matching exercises) lists the specific missed keys; everything
  // else reports a single result.correct that applies to every target.
  const wrong = result.wrong ? new Set(result.wrong) : null
  // Flashcard boards report per word: collect misses (and correct guesses, as
  // top-up candidates) per modality so reading and listening replay separately
  // as combined boards (#472).
  const isMatch = ex.kind === 'match'
  if (isMatch) {
    collectMatchResult(flashcards, { dimension: ex.dimension, targets: ex.targets, wrong })
  }
  // Collateral-damage guard: a phrase spelled wrong only *outside* the word being
  // assessed still counts as a wrong exercise, but the word itself was produced
  // correctly — so don't record (and possibly slip) it. TypeExercise reports this
  // via result.wordCorrect; it's only set for phrase spelling.
  const spareWord = result.correct === false && result.wordCorrect === true
  // A correct answer typed without the keyboard hint counts double: record the
  // attempt twice (in one write) so the word advances toward learned/mastered
  // faster (#210). The same signal feeds the memory scheduler (#313): only an
  // unhinted answer demonstrates unaided recall, so it grows stability more.
  const times = result.double ? 2 : 1
  let firstError = null
  for (const key of (ex.targets ?? []).filter(Boolean)) {
    if (spareWord) continue
    try {
      await progress.recordAttempt({
        word: key,
        dimension: ex.dimension,
        level: ex.level,
        correct: wrong ? !wrong.has(key) : result.correct,
        times,
        hinted: !result.double,
      })
    } catch (e) {
      if (!firstError) firstError = e
    }
  }
  // Always advance the session even if a persistence write failed, so the
  // exercise doesn't freeze. The error is re-thrown afterwards so Vue's global
  // errorHandler can surface it to the user. Match boards are never re-queued
  // whole: their misses drive one combined repeat board instead (#472).
  submit(runner, result.correct, { requeue: !isMatch })
  injectFlashcardRepeat()
  await finalizeIfDone()
  if (firstError) throw firstError
}

// When the planned pass (and any normal repeats) are done, replay the flashcard
// words missed this window as combined boards — one per modality, so reading
// misses come back as a reading board and listening misses as a listening board
// (#472) — each topped up with the weakest correctly-guessed words to a full
// board. Runs each time the session would otherwise finish, so a board's own
// misses spawn a further board until a clean pass — mirroring the whole-session
// repeat loop but at word granularity.
function injectFlashcardRepeat() {
  if (runner.phase !== 'summary' || finalized) return
  const { boards, repSeq: nextSeq } = buildFlashcardRepeatBoards(flashcards, {
    vocabById,
    options: flashcardOptions,
    rankOf: (key) => rank(progress.stateOf(key)),
    repSeq,
  })
  repSeq = nextSeq
  if (boards.length) startExtraRound(runner, boards)
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

// Recalculate the highest-priority words for the visual replacement exercises:
// draw from the current batch worst-understood first (the same pool the builder
// front-biases), preferring words not already covered this session so a skip
// steers practice toward what still needs doing rather than re-skinning the
// skipped word. Phrases are ordered by their source word's priority.
function buildReplacementPicker() {
  const wordKeys = session?.pools?.current ?? []
  const exclude = new Set()
  for (const e of runner.plan) for (const k of e.targets ?? []) exclude.add(k)
  const phrases = orderPhrasesBySource(sessionPhrases, wordKeys)
  return makeReplacementPicker({ wordKeys, phrases, vocabById, exclude })
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

// "I know this word" (#321): only for single-target exercises — a matching board
// drills many words at once, and one button can't speak for all of them. The
// learner marks the word known and simply answers this one exercise; from now
// on a single correct answer per dimension confirms it instead of the full grind.
const currentKey = computed(() => {
  const targets = (current.value?.targets ?? []).filter(Boolean)
  return targets.length === 1 ? targets[0] : null
})
const canMarkKnown = computed(() => currentKey.value != null && !progress.isKnown(currentKey.value))

async function markCurrentKnown() {
  if (currentKey.value) await progress.markKnown(currentKey.value)
}

async function skip(dimension) {
  const picker = buildReplacementPicker()
  skipDimension(runner, dimension, (skipped) => makeVisualReplacement(skipped, repSeq++, picker))
  injectFlashcardRepeat()
  await finalizeIfDone()
}

// --- Progress bar + summary -------------------------------------------------

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
  // Words that arrived pending and passed their spaced confirmation review
  // this session — the "you still knew these the next day" beat (#313).
  const confirmed = [...startPending].filter(
    (key) => progress.state.records[key]?.confirmedAt != null,
  )
  const durationMs = finishedAt.value && startedAt.value ? finishedAt.value - startedAt.value : 0
  return { ...base, slipped, confirmed, durationMs }
})

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
      <div
        class="bar"
        role="progressbar"
        :aria-valuenow="overall"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="bar-fill" :style="{ width: overall + '%' }" />
      </div>
      <span v-if="isRepeating(runner)" class="repeat muted">Fixing mistakes…</span>
    </header>

    <p v-if="!ready" class="muted">Loading…</p>

    <!-- Active exercise -->
    <div
      v-else-if="runner.phase === 'exercise' && current"
      class="exercise"
      :data-kind="current.kind"
      :data-eid="current.id + ':' + runner.log.length"
    >
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
        <button v-if="canMarkKnown" class="skip know" @click="markCurrentKnown">I know this word</button>
        <ReportButton
          :exercise="current"
          :vocab-version="vocabState.vocabVersion"
          :last-synced-at="vocabState.lastSyncedAt"
        />
      </div>
    </div>

    <!-- Summary -->
    <div v-else class="summary card" data-testid="session-summary">
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

        <!-- Batch bars that climbed more than the threshold this session. -->
        <div v-if="batchGains.length" class="batch-gains">
          <div v-for="g in batchGains" :key="g.level" class="gain-row">
            <div class="gain-head">
              <span class="gain-kind" :class="g.level === 'mastery' ? 'master-kind' : 'learn-kind'">
                {{ g.level === 'mastery' ? 'Mastering' : 'Learning' }}
              </span>
              <span class="gain-name">{{ g.name }}</span>
              <span class="gain-delta">+{{ Math.round((g.to - g.from) * 100) }}%</span>
            </div>
            <div class="gain-bar">
              <div
                class="gain-fill"
                :class="g.level === 'mastery' ? 'master-fill' : 'learn-fill'"
                :style="{ width: gainWidth[g.level] + '%' }"
              />
            </div>
          </div>
        </div>

        <!-- Words that passed their spaced confirmation review this session. -->
        <div v-if="summary.confirmed.length" class="confirmed">
          <p class="confirmed-line">
            ✓ {{ summary.confirmed.length }} word{{ summary.confirmed.length === 1 ? '' : 's' }}
            confirmed — still remembered a day later
          </p>
          <ul>
            <li v-for="key in summary.confirmed" :key="key" lang="ru">{{ key }}</li>
          </ul>
        </div>

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
  height: 0.5rem;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 3px;
  transition: width 0.3s ease;
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
.skip.know {
  color: var(--good);
  border-color: color-mix(in srgb, var(--good) 45%, transparent);
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
.batch-gains {
  display: grid;
  gap: 0.6rem;
  margin: 0.75rem 0 0.25rem;
}
.gain-row {
  display: grid;
  gap: 0.3rem;
  text-align: left;
}
.gain-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}
.gain-kind {
  font-size: 0.7rem;
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
.gain-name {
  flex: 1;
  font-weight: 500;
  text-transform: capitalize;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gain-delta {
  flex-shrink: 0;
  font-weight: 700;
  color: var(--good);
}
.gain-bar {
  height: 10px;
  background: var(--bg-soft);
  border-radius: 5px;
  overflow: hidden;
}
.gain-fill {
  height: 100%;
  border-radius: 5px;
  transition: width 1s ease;
}
.gain-fill.learn-fill {
  background: var(--good);
}
.gain-fill.master-fill {
  background: var(--gold);
}
.slipped ul,
.confirmed ul {
  list-style: none;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: center;
}
.confirmed-line {
  margin: 0;
  color: var(--good);
  font-weight: 600;
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
