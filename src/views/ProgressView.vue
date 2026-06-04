<script setup>
// Placeholder Progress screen — the chart, learned/mastered lists and weakest
// skills land in Phase 5 (#87). For now it surfaces the live counts so the
// pill's destination isn't a dead end.
import { learnedCount, masteredCount, recentlyLearned } from '../stores/progress.js'
</script>

<template>
  <section class="grid" style="gap: 1rem">
    <h1>Progress</h1>
    <div class="row">
      <span class="pill">💚 {{ learnedCount }} learned</span>
      <span class="pill">🏆 {{ masteredCount }} mastered</span>
    </div>
    <div v-if="recentlyLearned.length" class="card">
      <h2 style="margin-top: 0">Recently learned</h2>
      <ul>
        <li v-for="key in recentlyLearned" :key="key" lang="ru">{{ key }}</li>
      </ul>
    </div>
    <p class="muted">Charts and weakest-skill drills are coming soon.</p>
  </section>
</template>
