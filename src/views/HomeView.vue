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

    <RouterLink to="/phrases" class="card" style="text-decoration: none; color: inherit">
      <h2 style="margin-top: 0">💬 Phrases</h2>
      <p>
        Translate whole sentences. <strong>Easy:</strong> tap the words into order.
        <strong>Intermediate:</strong> type with a hinting keyboard.
        <strong>Hard:</strong> type it blind.
      </p>
      <span class="pill">build → guided → blind</span>
    </RouterLink>

    <RouterLink to="/listening" class="card" style="text-decoration: none; color: inherit">
      <h2 style="margin-top: 0">🎧 Listening</h2>
      <p>
        Hear a Russian phrase read aloud and tap the English words into order. A few
        <strong>decoy</strong> words are mixed in to keep you honest.
      </p>
      <span class="pill">listen → build</span>
    </RouterLink>

    <RouterLink to="/progress" class="card" style="text-decoration: none; color: inherit">
      <h2 style="margin-top: 0">📈 Progress</h2>
      <p>
        See your strongest and weakest words, forms, genders and collections, track exam readiness
        for a collection, and preview a tailored practice session.
      </p>
      <span class="pill">skills · mastery · exam</span>
    </RouterLink>
  </section>
</template>
