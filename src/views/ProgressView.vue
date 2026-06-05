<script setup>
// Progress screen: a words-known-by-day chart, expandable learned/mastered word
// lists, the learner's weakest skills, and achievement badges.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import { learnedCount, masteredCount, history, learnedWords, masteredWords, weakestSkills, earnedAchievements, state as progressState, batchProgress } from '../stores/progress.js'
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
