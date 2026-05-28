<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="grid" style="gap: 1.25rem">
    <p class="muted" style="margin: 0">
      Drill Russian without the artificial limits. Pick a mode — everything runs locally and
      offline.
    </p>

    <RouterLink to="/vocab" class="card" style="text-decoration: none; color: inherit">
      <h2 style="margin-top: 0">📚 Vocabulary</h2>
      <p>
        Translate words both directions. Ramps from <strong>match</strong> (multiple choice) to
        <strong>hinted typing</strong> to <strong>blind typing</strong>.
      </p>
      <span class="pill">easy → intermediate → advanced</span>
    </RouterLink>

    <RouterLink to="/declension" class="card" style="text-decoration: none; color: inherit">
      <h2 style="margin-top: 0">🧩 Noun declension</h2>
      <p>
        Master the six cases. <strong>Easy:</strong> pick valid case(s) for a form.
        <strong>Intermediate:</strong> fill the number × case table.
        <strong>Advanced:</strong> type the endings.
      </p>
      <span class="pill">6 cases · 2 numbers</span>
    </RouterLink>
  </section>
</template>
