<script setup>
// Progress screen: a words-known-by-day chart, expandable learned/mastered word
// lists, the learner's weakest skills, and achievement badges.
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { learnedCount, masteredCount, history, learnedWords, masteredWords, weakestSkills, earnedAchievements, state as progressState, batchProgress, currentStreak, longestStreak, dailyRecord, totalExercises, activityCalendar } from '../stores/progress.js'
import { ACHIEVEMENTS } from '../lib/achievements.js'
import AchievementBadge from '../components/AchievementBadge.vue'

const router = useRouter()

const points = computed(() => history())
const skills = computed(() => weakestSkills())
const showList = ref(null) // 'learned' | 'mastered' | null

const learned = computed(() => learnedWords())
const mastered = computed(() => masteredWords())

// A compact SVG line chart of cumulative learned words by day.
const W = 320
const H = 80
const chart = computed(() => {
  const pts = points.value
  if (pts.length === 0) return null
  const max = Math.max(1, ...pts.map((p) => p.learned))
  const n = pts.length
  const x = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (v) => H - (v / max) * H
  const line = (key) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  // A single day has no segment to stroke, so expose a point to render as a dot.
  const dot = n === 1 ? { x: x(0), learned: y(pts[0].learned), mastered: y(pts[0].mastered) } : null
  return { learned: line('learned'), mastered: line('mastered'), dot, max, last: pts[pts.length - 1] }
})

const earnedCount = computed(() => earnedAchievements.value.size)

// Contribution calendar (GitHub-style). `currentStreak`/`dailyRecord` etc. are
// reactive computeds; reference them so the grid re-renders as activity lands.
const calendar = computed(() => {
  void progressState.activity
  return activityCalendar()
})
const streak = computed(() => currentStreak.value)
const best = computed(() => longestStreak.value)
const record = computed(() => dailyRecord.value)
const total = computed(() => totalExercises.value)

// Open the calendar scrolled to the most recent week, the way GitHub does.
const calScroll = ref(null)
onMounted(async () => {
  await nextTick()
  if (calScroll.value) calScroll.value.scrollLeft = calScroll.value.scrollWidth
})

function cellTitle(cell) {
  if (cell.future) return ''
  if (cell.count === 0) return `${cell.day}: no exercises`
  const pct = Math.round((cell.correct / cell.count) * 100)
  return `${cell.day}: ${cell.count} exercise${cell.count === 1 ? '' : 's'}, ${pct}% correct`
}

const learningBatch = computed(() => progressState.learning)
const masteryBatch = computed(() => progressState.mastery)
const learningProgress = computed(() => batchProgress('learning'))
const masteryProgress = computed(() => batchProgress('mastery'))
const learningDone = computed(() => learningProgress.value.filter((w) => w.done).length)
const masteryDone = computed(() => masteryProgress.value.filter((w) => w.done).length)

function focus(id) {
  router.push({ path: '/session', query: { type: 'standard', focus: id } })
}

function toggle(which) {
  showList.value = showList.value === which ? null : which
}
</script>

<template>
  <section class="grid" style="gap: 1.25rem">
    <h1>Progress</h1>

    <div class="row counts">
      <span class="pill learn">💚 {{ learnedCount }} learned</span>
      <span class="pill master">🏆 {{ masteredCount }} mastered</span>
    </div>

    <!-- Streak + contribution calendar -->
    <div class="card streak-card">
      <div class="streak-head">
        <div class="streak-now" :class="{ lit: streak > 0 }">
          <span class="big-flame" aria-hidden="true">🔥</span>
          <span class="streak-num">{{ streak }}</span>
          <span class="streak-label">day streak</span>
        </div>
        <dl class="streak-stats">
          <div><dt>Best</dt><dd>{{ best }} days</dd></div>
          <div><dt>Record</dt><dd>{{ record }} / day</dd></div>
          <div><dt>Total</dt><dd>{{ total }}</dd></div>
        </dl>
      </div>
      <p class="streak-hint muted">
        Do at least one exercise every day to keep your streak alive — you can skip one
        day a week without breaking it. Each day's colour is your batch; brighter means
        more exercises, more vivid means more correct.
      </p>
      <div ref="calScroll" class="cal-scroll">
        <div class="cal-months" aria-hidden="true">
          <span v-for="m in calendar.months" :key="m.index" class="cal-month" :style="{ gridColumnStart: m.index + 1 }">{{ m.label }}</span>
        </div>
        <div class="cal-grid" role="img" aria-label="Daily exercise activity calendar">
          <div v-for="(week, wi) in calendar.weeks" :key="wi" class="cal-week">
            <span
              v-for="cell in week"
              :key="cell.day"
              class="cal-cell"
              :class="{ empty: !cell.color, future: cell.future }"
              :style="cell.color ? { background: cell.color } : null"
              :title="cellTitle(cell)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Current learning / mastery batches -->
    <div v-if="learningBatch || masteryBatch" class="card batches-card">
      <h2>Current batches</h2>
      <div class="batch-list">
        <div v-if="learningBatch" class="batch-row">
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

    <!-- Achievement badges -->
    <div class="card achievements">
      <h2>Achievements <span class="ach-count muted">{{ earnedCount }} / {{ ACHIEVEMENTS.length }}</span></h2>
      <div class="badge-grid">
        <AchievementBadge
          v-for="a in ACHIEVEMENTS"
          :key="a.id"
          :icon="a.icon"
          :label="a.label"
          :desc="a.desc"
          :unlocked="earnedAchievements.has(a.id)"
        />
      </div>
    </div>

    <!-- Words-known-by-day chart -->
    <div class="card chart-card">
      <h2>Words known by day</h2>
      <svg v-if="chart" class="chart" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" aria-label="Words known over time">
        <path :d="chart.learned" class="line-learned" fill="none" />
        <path v-if="chart.mastered" :d="chart.mastered" class="line-mastered" fill="none" />
        <template v-if="chart.dot">
          <circle :cx="chart.dot.x" :cy="chart.dot.learned" r="3" class="dot-learned" />
          <circle :cx="chart.dot.x" :cy="chart.dot.mastered" r="3" class="dot-mastered" />
        </template>
      </svg>
      <p v-else class="muted">No history yet — finish a session to start your chart.</p>
    </div>

    <!-- Learned / mastered word lists -->
    <div class="row">
      <button class="toggle" :class="{ active: showList === 'learned' }" @click="toggle('learned')">
        Show learned ({{ learned.length }})
      </button>
      <button class="toggle" :class="{ active: showList === 'mastered' }" @click="toggle('mastered')">
        Show mastered ({{ mastered.length }})
      </button>
    </div>
    <ul v-if="showList" class="words card">
      <li v-for="key in (showList === 'learned' ? learned : mastered)" :key="key" lang="ru">{{ key }}</li>
      <li v-if="(showList === 'learned' ? learned : mastered).length === 0" class="muted">Nothing yet.</li>
    </ul>

    <!-- Weakest skills → focused sessions -->
    <div v-if="skills.length" class="card">
      <h2>Worth some focus</h2>
      <p class="muted">Tap to drill these in a focused session.</p>
      <div class="row chips">
        <button v-for="s in skills" :key="s.id" class="chip" @click="focus(s.id)">
          {{ s.label }}
          <small>{{ Math.round(s.weakness * 100) }}%</small>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.batches-card h2 {
  margin: 0 0 0.75rem;
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
.streak-card {
  display: grid;
  gap: 0.75rem;
}
.streak-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.streak-now {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  opacity: 0.5;
}
.streak-now.lit {
  opacity: 1;
}
.big-flame {
  font-size: 1.5rem;
  filter: grayscale(1);
}
.streak-now.lit .big-flame {
  filter: none;
}
.streak-num {
  font-size: 1.8rem;
  font-weight: 700;
  line-height: 1;
}
.streak-label {
  font-size: 0.9rem;
  color: var(--muted, inherit);
}
.streak-stats {
  display: flex;
  gap: 1.25rem;
  margin: 0;
}
.streak-stats div {
  display: grid;
  gap: 0.1rem;
}
.streak-stats dt {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.65;
}
.streak-stats dd {
  margin: 0;
  font-weight: 600;
}
.streak-hint {
  margin: 0;
  font-size: 0.85rem;
}
.cal-scroll {
  overflow-x: auto;
  padding-bottom: 0.25rem;
}
.cal-months {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 14px;
  height: 1rem;
  font-size: 0.7rem;
  opacity: 0.7;
  min-width: max-content;
}
.cal-month {
  white-space: nowrap;
  grid-row: 1;
}
.cal-grid {
  display: flex;
  gap: 3px;
  min-width: max-content;
}
.cal-week {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.cal-cell {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  background: var(--bg-soft);
}
.cal-cell.empty {
  background: var(--bg-soft);
}
.cal-cell.future {
  visibility: hidden;
}
.pill.learn {
  border-color: var(--good);
  color: var(--good);
}
.pill.master {
  border-color: var(--gold);
  color: var(--gold);
}
.chart {
  width: 100%;
  height: 80px;
  overflow: visible;
}
.line-learned {
  stroke: var(--good);
  stroke-width: 2;
}
.line-mastered {
  stroke: var(--gold);
  stroke-width: 2;
}
.dot-learned {
  fill: var(--good);
}
.dot-mastered {
  fill: var(--gold);
}
.toggle.active {
  border-color: var(--primary);
}
.words {
  list-style: none;
  margin: 0;
  padding: 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  max-height: 14rem;
  overflow: auto;
}
.chips {
  gap: 0.5rem;
}
.chip {
  border-radius: 999px;
  border: 1px solid var(--bad);
  color: var(--text);
  background: color-mix(in srgb, var(--bad) 12%, var(--card));
}
.chip small {
  opacity: 0.7;
  margin-left: 0.3rem;
}
.achievements h2 {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}
.ach-count {
  font-size: 0.85rem;
  font-weight: 400;
}
.badge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(5rem, 1fr));
  gap: 0.5rem;
  margin-top: 0.75rem;
}
</style>
