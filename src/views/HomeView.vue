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
      <h2 style="margin-top: 0">🧩 Inflection drills</h2>
      <p>
        Master the forms of <strong>nouns</strong>, <strong>adjectives</strong>,
        <strong>pronouns</strong> and <strong>verbs</strong> with four exercises:
        <strong>identify</strong> a form, <strong>build</strong> the table,
        add endings with <strong>guided</strong> hints, then <strong>type</strong> them blind.
      </p>
      <span class="pill">identify → build → guided → type</span>
    </RouterLink>

    <div class="row" style="gap: 0.5rem">
      <RouterLink to="/adjectives" class="pill">Adjectives →</RouterLink>
      <RouterLink to="/pronouns" class="pill">Pronouns →</RouterLink>
      <RouterLink to="/verbs" class="pill">Verbs →</RouterLink>
    </div>

    <RouterLink to="/numbers" class="card" style="text-decoration: none; color: inherit">
      <h2 style="margin-top: 0">🔢 Numbers</h2>
      <p>
        Generated on the fly and declined by rule, so they never run out. Read
        <strong>years</strong> ("I was born in 1987"), spell <strong>whole numbers</strong>,
        and get <strong>ages, prices and dates</strong> with the right agreement.
      </p>
      <span class="pill">years · cardinals · dates</span>
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
