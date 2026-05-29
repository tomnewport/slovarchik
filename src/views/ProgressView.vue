<script setup>
import { computed, ref } from 'vue'

import { state as vocabState } from '../stores/vocab.js'
import {
  describedStats,
  progressQueries,
  skills,
  skillsByBreadth,
  weakSkills,
  examReadiness,
  completedCollections,
  currentCollection,
  setCurrentCollection,
  composePractice,
} from '../stores/progress.js'

const GENDER_LABELS = { m: 'Masculine', f: 'Feminine', n: 'Neuter' }

const hasData = computed(() => describedStats.value.some((s) => s.attempts > 0))
const pct = (x) => `${Math.round((x ?? 0) * 100)}%`

// The four headline rankings (only meaningful once there are attempts).
const topWords = computed(() => progressQueries.words({ limit: 6 }))
const topForms = computed(() => progressQueries.forms({ limit: 6 }))
const byGender = computed(() =>
  progressQueries.byFacet('gender').map((b) => ({ ...b, label: GENDER_LABELS[b.key] ?? b.key })),
)
const topCollections = computed(() => progressQueries.collections({ limit: 6 }))

// Collections offered in the "currently learning" picker.
const collectionNames = computed(() =>
  skills.value
    .filter((s) => s.kind === 'collection')
    .map((s) => s.label)
    .sort(),
)
function onPickCollection(e) {
  setCurrentCollection(e.target.value || null)
}

// Practice-session preview. A nonce lets the learner reshuffle the selection.
const sessionSize = ref('medium')
const nonce = ref(0)
const session = computed(() => {
  nonce.value // depend on the reshuffle button
  return composePractice(sessionSize.value)
})

// Strength colour: green when strong, red when weak (null = never attempted).
function strengthColor(strength) {
  if (strength == null) return 'var(--muted)'
  return `color-mix(in srgb, var(--good) ${Math.round(strength * 100)}%, var(--bad))`
}

// A breadth band can hold many skills (one per word); show the most informative
// first — attempted-and-weakest, then the broadest untried — and cap the list.
const SKILL_CAP = 12
function sortedSkills(list) {
  return [...list].sort((a, b) => {
    const aTried = a.attempts > 0
    const bTried = b.attempts > 0
    if (aTried !== bTried) return aTried ? -1 : 1
    if (aTried) return b.errorRate - a.errorRate || b.attempts - a.attempts
    return b.breadth - a.breadth || a.label.localeCompare(b.label)
  })
}
</script>

<template>
  <section class="grid" style="gap: 1.5rem">
    <h2 style="margin: 0">Progress</h2>

    <p v-if="vocabState.status === 'loading' && !hasData" class="muted">Loading…</p>
    <p v-else-if="!hasData" class="feedback bad" style="margin: 0">
      No attempts recorded yet — play a few rounds of Vocab, Declension or Phrases and your
      strengths and weak spots will show up here.
    </p>

    <template v-else>
      <!-- Current collection + exam readiness -->
      <div class="card grid" style="gap: 0.9rem">
        <div class="row" style="justify-content: space-between">
          <strong>Current collection</strong>
          <select
            :value="currentCollection ?? ''"
            @change="onPickCollection"
            style="background: var(--bg-soft); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 0.4rem 0.6rem"
          >
            <option value="">— none —</option>
            <option v-for="name in collectionNames" :key="name" :value="name">{{ name }}</option>
          </select>
        </div>

        <template v-if="currentCollection">
          <div class="row" style="justify-content: space-between">
            <span class="muted">
              Exam readiness · {{ examReadiness.mastered }} / {{ examReadiness.words }} words mastered
            </span>
            <span>{{ pct(examReadiness.readiness) }}</span>
          </div>
          <div class="bar"><i :style="{ width: pct(examReadiness.readiness) }" /></div>
          <p v-if="examReadiness.eligible" class="feedback good" style="margin: 0">
            🎓 Exam unlocked — every word is mastered. Complete 20 on intermediate to finish the
            collection.
          </p>
        </template>
        <p v-else class="muted" style="margin: 0">
          Pick a collection to track exam readiness towards it.
        </p>

        <p v-if="completedCollections.length" class="muted" style="margin: 0">
          Completed: <span v-for="c in completedCollections" :key="c" class="pill">{{ c }}</span>
        </p>
      </div>

      <!-- Practice session preview -->
      <div class="card grid" style="gap: 0.9rem">
        <div class="row" style="justify-content: space-between">
          <strong>Practice session</strong>
          <div class="row" style="gap: 0.4rem">
            <button
              v-for="s in ['small', 'medium', 'large']"
              :key="s"
              :class="{ primary: sessionSize === s }"
              style="padding: 0.35rem 0.7rem"
              @click="sessionSize = s"
            >
              {{ s }}
            </button>
            <button style="padding: 0.35rem 0.7rem" @click="nonce++">↻</button>
          </div>
        </div>
        <p class="muted" style="margin: 0">
          {{ session.size }} questions per section · a preview of what a session would drill.
        </p>
        <div v-for="sec in session.sections" :key="sec.id" class="grid" style="gap: 0.3rem">
          <div class="row" style="justify-content: space-between">
            <strong>{{ sec.title }}</strong>
            <span class="muted" style="font-size: 0.8rem">
              {{ sec.help }} · {{ sec.levels.join(' / ') }}
            </span>
          </div>
          <div class="row" style="gap: 0.4rem">
            <span v-for="item in sec.items" :key="item.key + (item.slot || '')" class="pill" lang="ru">
              {{ item.label }}
            </span>
          </div>
        </div>
        <p v-if="!session.sections.length" class="muted" style="margin: 0">
          Nothing to drill yet — pick a current collection above.
        </p>
      </div>

      <!-- Skills grouped by breadth -->
      <div class="card grid" style="gap: 1rem">
        <strong>Skills by breadth</strong>
        <p class="muted" style="margin: 0">
          How many words each skill covers — from a single word up to a whole gender.
        </p>
        <div v-for="group in skillsByBreadth" :key="group.id" class="grid" style="gap: 0.4rem">
          <div class="row" style="justify-content: space-between">
            <span class="pill">{{ group.label }}</span>
            <span class="muted" style="font-size: 0.8rem">{{ group.skills.length }} skills</span>
          </div>
          <table v-if="group.skills.length" class="skills">
            <tr v-for="sk in sortedSkills(group.skills).slice(0, SKILL_CAP)" :key="sk.id">
              <td>{{ sk.label }}</td>
              <td class="muted" style="white-space: nowrap">{{ sk.breadth }}w</td>
              <td style="width: 40%">
                <div class="bar">
                  <i
                    :style="{
                      width: sk.strength == null ? '0%' : pct(sk.strength),
                      background: strengthColor(sk.strength),
                    }"
                  />
                </div>
              </td>
              <td class="muted" style="white-space: nowrap; text-align: right">
                {{ sk.attempts ? pct(sk.strength) + ' · ' + sk.attempts + 'x' : 'untried' }}
              </td>
            </tr>
          </table>
          <p v-else class="muted" style="margin: 0 0 0.5rem; font-size: 0.85rem">None yet.</p>
          <p
            v-if="group.skills.length > SKILL_CAP"
            class="muted"
            style="margin: 0 0 0.5rem; font-size: 0.8rem"
          >
            +{{ group.skills.length - SKILL_CAP }} more
          </p>
        </div>
      </div>

      <!-- Weakest skills -->
      <div v-if="weakSkills.length" class="card grid" style="gap: 0.5rem">
        <strong>Weakest skills</strong>
        <p class="muted" style="margin: 0">The bottom 25% a practice session would target.</p>
        <table class="skills">
          <tr v-for="sk in weakSkills" :key="sk.id">
            <td>{{ sk.label }}</td>
            <td class="muted">{{ sk.kind }}</td>
            <td class="feedback bad" style="text-align: right; white-space: nowrap">
              {{ pct(sk.errorRate) }} wrong · {{ sk.attempts }}x
            </td>
          </tr>
        </table>
      </div>

      <!-- The four headline rankings -->
      <div class="grid rankings">
        <div class="card grid" style="gap: 0.4rem">
          <strong>Most mistaken words</strong>
          <div v-for="b in topWords" :key="b.id" class="rank">
            <span lang="ru" class="truncate">{{ b.label }}</span>
            <span class="muted">{{ pct(b.errorRate) }} · {{ b.attempts }}x</span>
          </div>
          <p v-if="!topWords.length" class="muted" style="margin: 0">No word attempts yet.</p>
        </div>
        <div class="card grid" style="gap: 0.4rem">
          <strong>Most mistaken forms</strong>
          <div v-for="b in topForms" :key="b.id" class="rank">
            <span lang="ru" class="truncate">{{ b.label }}</span>
            <span class="muted">{{ pct(b.errorRate) }} · {{ b.attempts }}x</span>
          </div>
          <p v-if="!topForms.length" class="muted" style="margin: 0">No form attempts yet.</p>
        </div>
        <div class="card grid" style="gap: 0.4rem">
          <strong>By gender</strong>
          <div v-for="b in byGender" :key="b.key" class="rank">
            <span class="truncate">{{ b.label }}</span>
            <span class="muted">{{ pct(b.errorRate) }} · {{ b.attempts }}x</span>
          </div>
          <p v-if="!byGender.length" class="muted" style="margin: 0">No gendered attempts yet.</p>
        </div>
        <div class="card grid" style="gap: 0.4rem">
          <strong>Most mistaken collections</strong>
          <div v-for="b in topCollections" :key="b.key" class="rank">
            <span class="truncate">{{ b.key }}</span>
            <span class="muted">{{ pct(b.errorRate) }} · {{ b.attempts }}x</span>
          </div>
          <p v-if="!topCollections.length" class="muted" style="margin: 0">No collection attempts yet.</p>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.bar {
  height: 8px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 999px;
  overflow: hidden;
}
.bar > i {
  display: block;
  height: 100%;
  background: var(--primary);
  border-radius: 999px;
  transition: width 0.3s ease;
}
.skills {
  width: 100%;
  border-collapse: collapse;
}
.skills td {
  padding: 0.2rem 0.4rem 0.2rem 0;
  vertical-align: middle;
  font-size: 0.9rem;
}
.rankings {
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.rank {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.9rem;
}
.rank .muted {
  white-space: nowrap;
}
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 540px) {
  .rankings {
    grid-template-columns: 1fr;
  }
}
</style>
