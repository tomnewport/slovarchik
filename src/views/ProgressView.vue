<script setup>
// Progress screen: a words-known-by-day chart, expandable learned/mastered word
// lists, and the learner's weakest skills — each a chip that launches a focused
// session over the matching words.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import { learnedCount, masteredCount, history, learnedWords, masteredWords, weakestSkills } from '../stores/progress.js'

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
</style>
