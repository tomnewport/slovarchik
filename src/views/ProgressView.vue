<script setup>
// Progress screen: a words-known-by-day chart, expandable learned/mastered word
// lists, per-CEFR-level coverage bars, the learner's weakest skills, and
// achievement badges.
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'

import { learnedCount, masteredCount, history, learnedWords, masteredWords, weakestSkills, earnedAchievements, state as progressState, batchProgress, currentStreak, longestStreak, dailyRecord, totalExercises, activityCalendar, cefrStats } from '../stores/progress.js'
import { ACHIEVEMENTS } from '../lib/achievements.js'
import { buildChart } from '../lib/progressChart.js'
import { CEFR_ORDER } from '../lib/batches.js'
import AchievementBadge from '../components/AchievementBadge.vue'

const router = useRouter()

const points = computed(() => history())
const skills = computed(() => weakestSkills())
const showList = ref(null) // 'learned' | 'mastered' | null

const learned = computed(() => learnedWords())
const mastered = computed(() => masteredWords())

// One bar per CEFR level, drawn as three nested slices: met, then learned, then
// mastered. "Met" is the head start (#675) — words the learner has read, typed
// or understood correctly inside a phrase, long before the curriculum formally
// teaches them. The counts nest by construction (see buildCefrStats), so the
// wider slice is always behind the narrower one. Levels the corpus has no words
// for are left out rather than shown as empty bars.
const cefrLevels = computed(() => {
  const stats = cefrStats.value
  return CEFR_ORDER.map((level) => {
    const s = stats[level] ?? { total: 0, met: 0, learned: 0, mastered: 0 }
    const pctOf = (n) => (s.total ? (n / s.total) * 100 : 0)
    return {
      level,
      total: s.total,
      met: s.met,
      learned: s.learned,
      mastered: s.mastered,
      pct: pctOf(s.learned),
      metPct: pctOf(s.met),
      masteredPct: pctOf(s.mastered),
    }
  }).filter((l) => l.total > 0)
})

// A line chart of cumulative learned/mastered words, on real scales in both
// directions: geometry (ticks, gridlines, stepped paths) comes from
// lib/progressChart.js. The SVG is drawn at its true pixel size rather than
// being stretched by a viewBox, so labels stay the same size on every screen.
const CHART_H = 190
const chartBox = ref(null)
const chartWidth = ref(360)
let chartObserver = null

const today = new Date().toISOString().slice(0, 10)
const chart = computed(() => buildChart(points.value, { today, width: chartWidth.value, height: CHART_H }))
const chartLabel = computed(() => {
  const c = chart.value
  if (!c) return 'Words known over time'
  return `Words known over time: ${c.last.learned} learned, ${c.last.mastered} mastered as of ${c.last.day}`
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
  const measure = () => {
    const w = chartBox.value?.clientWidth
    if (w) chartWidth.value = w
  }
  measure()
  if (chartBox.value && typeof ResizeObserver !== 'undefined') {
    chartObserver = new ResizeObserver(measure)
    chartObserver.observe(chartBox.value)
  }
})
onBeforeUnmount(() => chartObserver?.disconnect())

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

    <!-- CEFR level coverage -->
    <div v-if="cefrLevels.length" class="card cefr-card">
      <h2>CEFR levels</h2>
      <p class="muted cefr-hint">
        How much of each level's vocabulary you've learned. The brighter slice is what
        you've mastered; the faint one behind is words you've met in a sentence but
        haven't been taught yet.
      </p>
      <div class="cefr-list">
        <div v-for="l in cefrLevels" :key="l.level" class="cefr-row">
          <div class="cefr-meta">
            <span class="cefr-level">{{ l.level }}</span>
            <span class="cefr-pct">{{ Math.round(l.pct) }}%</span>
            <span class="cefr-count muted">{{ l.learned }} / {{ l.total }} learned<template v-if="l.mastered">, {{ l.mastered }} mastered</template><template v-if="l.met > l.learned">, {{ l.met }} met</template></span>
          </div>
          <div
            class="cefr-bar"
            role="progressbar"
            :aria-valuenow="Math.round(l.pct)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${l.level}: ${l.learned} of ${l.total} words learned, ${l.met} met`"
          >
            <div class="cefr-fill met-fill" :style="{ width: l.metPct + '%' }" />
            <div class="cefr-fill learn-fill" :style="{ width: l.pct + '%' }" />
            <div class="cefr-fill master-fill" :style="{ width: l.masteredPct + '%' }" />
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
      <div class="chart-head">
        <h2>Words known by day</h2>
        <ul class="legend">
          <li><span class="swatch learn-fill" />learned</li>
          <li><span class="swatch master-fill" />mastered</li>
        </ul>
      </div>
      <div ref="chartBox" class="chart-box">
        <svg
          v-if="chart"
          class="chart"
          :width="chart.width"
          :height="chart.height"
          :viewBox="`0 0 ${chart.width} ${chart.height}`"
          role="img"
          :aria-label="chartLabel"
        >
          <g class="grid">
            <line
              v-for="t in chart.yTicks"
              :key="`y${t.value}`"
              :class="{ axis: t.value === 0 }"
              :x1="chart.plot.x"
              :x2="chart.plot.x + chart.plot.w"
              :y1="t.y"
              :y2="t.y"
            />
            <line
              v-for="t in chart.xTicks"
              :key="`x${t.time}`"
              class="v"
              :x1="t.x"
              :x2="t.x"
              :y1="chart.plot.y"
              :y2="chart.plot.y + chart.plot.h"
            />
          </g>
          <text
            v-for="t in chart.yTicks"
            :key="`yl${t.value}`"
            class="tick"
            text-anchor="end"
            :x="chart.plot.x - 6"
            :y="t.y + 3.5"
          >{{ t.value }}</text>
          <text
            v-for="(t, i) in chart.xTicks"
            :key="`xl${t.time}`"
            class="tick"
            :text-anchor="i === 0 ? 'start' : i === chart.xTicks.length - 1 ? 'end' : 'middle'"
            :x="t.x"
            :y="chart.height - 7"
          >{{ t.label }}</text>
          <text
            class="axis-title"
            text-anchor="middle"
            :transform="`translate(10, ${chart.plot.y + chart.plot.h / 2}) rotate(-90)`"
          >words</text>
          <path v-if="chart.area" :d="chart.area" class="area-learned" />
          <path v-if="chart.learned" :d="chart.learned" class="line-learned" fill="none" />
          <path v-if="chart.mastered" :d="chart.mastered" class="line-mastered" fill="none" />
          <template v-for="m in chart.markers" :key="m.key">
            <circle :cx="m.x" :cy="m.mastered" r="2.5" class="dot-mastered"><title>{{ m.label }}</title></circle>
            <circle :cx="m.x" :cy="m.learned" r="2.5" class="dot-learned"><title>{{ m.label }}</title></circle>
          </template>
        </svg>
        <p v-else class="muted">No history yet — finish a session to start your chart.</p>
      </div>
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
/* Met but untaught: the same hue as learned, faded, so it reads as a lesser
   degree of the same thing rather than a fourth category. */
.met-fill {
  background: var(--good);
  opacity: 0.3;
}
.learn-fill {
  background: var(--good);
}
.master-fill {
  background: var(--gold);
}
.cefr-card h2 {
  margin: 0 0 0.25rem;
}
.cefr-hint {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
}
.cefr-list {
  display: grid;
  gap: 0.75rem;
}
.cefr-row {
  display: grid;
  gap: 0.35rem;
}
.cefr-meta {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}
.cefr-level {
  font-weight: 700;
  letter-spacing: 0.03em;
  min-width: 2rem;
}
.cefr-pct {
  font-weight: 600;
  color: var(--good);
}
.cefr-count {
  font-size: 0.85rem;
  margin-left: auto;
  text-align: right;
}
.cefr-bar {
  position: relative;
  height: 8px;
  background: var(--bg-soft);
  border-radius: 4px;
  overflow: hidden;
}
.cefr-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 4px;
  transition: width 0.3s ease;
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
.chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.chart-head h2 {
  margin: 0;
}
.legend {
  list-style: none;
  display: flex;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  font-size: 0.8rem;
  color: var(--muted);
}
.legend li {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.swatch {
  width: 0.7rem;
  height: 0.2rem;
  border-radius: 1px;
}
.chart-box {
  width: 100%;
}
.chart {
  display: block;
  max-width: 100%;
}
.grid line {
  stroke: var(--border);
  stroke-width: 1;
}
.grid line.v {
  stroke-dasharray: 2 3;
  opacity: 0.6;
}
.grid line.axis {
  stroke: var(--muted);
  opacity: 0.7;
}
.tick {
  fill: var(--muted);
  font-size: 10px;
}
.axis-title {
  fill: var(--muted);
  font-size: 10px;
  letter-spacing: 0.04em;
}
.area-learned {
  fill: var(--good);
  opacity: 0.12;
}
.line-learned {
  stroke: var(--good);
  stroke-width: 2;
  stroke-linejoin: round;
}
.line-mastered {
  stroke: var(--gold);
  stroke-width: 2;
  stroke-linejoin: round;
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
