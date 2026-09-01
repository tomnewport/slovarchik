<script setup>
// Everything the app can say *about* a word, as opposed to testing the learner
// on it (#584, #586): how it is built, what root it shares, where it came from,
// a mnemonic — and the other words it belongs with.
//
// One component, several homes: the word modal, the vocab drill's answer, the
// intro card and every exercise's resolved state. It is never behind a
// disclosure: once there is something to say about a word, saying it is the
// point — a panel the learner has to remember to open is one they never read.
// Timing is the callers' job instead: a `build` fact routinely gives an answer
// away, so an exercise renders this only once its answer is resolved (right,
// wrong or passed).
//
// A word with neither authored facts nor derived relations renders **nothing** —
// no "no facts available" chrome. Most of the corpus carries no authored facts
// yet, and the derived relations alone have to look deliberate.
import { computed } from 'vue'

import { state as vocabState } from '../stores/vocab.js'
import { stateOf } from '../stores/progress.js'
import { wordFacts, factParts, relatedWords, hasWordFacts, NUMERAL_LABEL } from '../lib/wordFacts.js'
import { ASPECT_LABEL, MOTION_LABEL } from '../lib/phraseContext.js'
import SpeakButton from './SpeakButton.vue'

const props = defineProps({
  wordKey: { type: String, required: true },
  // Whether a related word can actually be opened from here. Only a host that
  // has somewhere to go — the word modal — can honour `open-word`; mid-drill
  // there is nowhere to navigate to and nothing should look tappable. Off by
  // default so a host has to opt in, rather than silently rendering dead
  // buttons.
  navigable: { type: Boolean, default: false },
})
const emit = defineEmits(['open-word'])

/** Icon per fact kind — the closed set from vocabBuild.FACT_KINDS. */
const KIND_ICON = { build: '🧩', root: '🌱', origin: '📜', memory: '💡', note: '✎' }

const byKey = computed(() => new Map(vocabState.words.map((w) => [w.key, w])))
const record = computed(() => byKey.value.get(props.wordKey) ?? null)

const facts = computed(() => wordFacts(record.value))
const related = computed(() => relatedWords(record.value, byKey.value))
// "Easily confused" keeps its own block: these are the pairs the correction
// messages (#588) draw on, and meeting the same wording here is what makes one
// recognisable from the other later.
const confusables = computed(() => related.value.filter((r) => r.relation === 'confusable'))
const family = computed(() => related.value.filter((r) => r.relation !== 'confusable'))

const isEmpty = computed(() => !hasWordFacts(record.value, byKey.value))

/** The morpheme chips of a `build` fact, plus the joined word for a reader. */
function parts(fact) {
  return factParts(fact)
}

/** How a related word relates, in words. */
function relationLabel(row) {
  const other = row.key ? byKey.value.get(row.key) : null
  switch (row.relation) {
    case 'aspect':
      return `${ASPECT_LABEL[other?.aspect] ?? 'aspect'} partner`
    case 'motion':
      return `${MOTION_LABEL[other?.motion] ?? 'motion'} partner`
    case 'participle':
      return 'the verb it comes from'
    case 'manner':
      // One word in two parts of speech, so which way round depends on which
      // end the learner is standing at.
      return other?.pos === 'adverb' ? 'the adverb from it' : 'the adjective it comes from'
    case 'numeral':
      return NUMERAL_LABEL[`${row.via}:${row.role}`] ?? 'the same family'
    case 'heteronym':
      return 'same spelling, different stress'
    case 'same-meaning':
      return `also means “${record.value?.meaning || row.en}”`
    case 'root':
      return 'same root'
    case 'see-also':
      // A `see:` on a note is a pointer, not a claim about morphology.
      return 'see also'
    default:
      return 'easily confused'
  }
}

/** Has the learner met this word yet? Shown, either way — but marked. */
function met(row) {
  return !!row.key && stateOf(row.key) !== 'unknown'
}
</script>

<template>
  <div v-if="!isEmpty" class="word-facts">
    <p class="facts-heading">💡 About this word</p>

    <div class="facts-body">
      <!-- The breakdown leads: it is the piece that does the most work on a
           long word, and it is worth seeing before any prose. -->
      <template v-for="(fact, i) in facts" :key="i">
        <div v-if="fact.parts.length" class="breakdown">
          <div class="chips" :aria-label="parts(fact).label">
            <span v-for="(p, j) in fact.parts" :key="j" class="morph" aria-hidden="true">
              <span lang="ru" class="morph-ru">{{ p.ru }}</span>
              <span class="morph-en">{{ p.en }}</span>
            </span>
          </div>
          <p class="fact-text">{{ fact.text }}</p>
        </div>
        <p v-else class="fact-line">
          <span class="fact-icon" aria-hidden="true">{{ KIND_ICON[fact.kind] }}</span>
          <span class="fact-text">{{ fact.text }}</span>
        </p>
        <ul v-if="fact.see.length" class="see">
          <li v-for="link in fact.see" :key="link.key">
            <component
              :is="navigable ? 'button' : 'span'"
              :type="navigable ? 'button' : null"
              class="word-link"
              @click="navigable && emit('open-word', link.key)"
            >
              <span lang="ru">{{ link.ru }}</span>
              <span class="muted">{{ link.en }}</span>
            </component>
          </li>
        </ul>
      </template>

      <section v-if="family.length" class="related">
        <h4 class="facts-title">Related words</h4>
        <ul class="word-rows">
          <li v-for="row in family" :key="row.key ?? row.ru" :class="{ unmet: !met(row) }">
            <component
              :is="navigable && row.key ? 'button' : 'span'"
              :type="navigable && row.key ? 'button' : null"
              class="word-link"
              @click="navigable && row.key && emit('open-word', row.key)"
            >
              <span lang="ru" class="row-ru">{{ row.ru }}</span>
              <span class="muted row-en">{{ row.en }}</span>
              <span class="relation">{{ relationLabel(row) }}</span>
            </component>
            <SpeakButton :text="row.ru" />
          </li>
        </ul>
      </section>

      <section v-if="confusables.length" class="related confused">
        <h4 class="facts-title">Easily confused</h4>
        <ul class="word-rows">
          <li v-for="row in confusables" :key="row.key ?? row.ru" :class="{ unmet: !met(row) }">
            <component
              :is="navigable && row.key ? 'button' : 'span'"
              :type="navigable && row.key ? 'button' : null"
              class="word-link"
              @click="navigable && row.key && emit('open-word', row.key)"
            >
              <span lang="ru" class="row-ru">{{ row.ru }}</span>
              <span class="muted row-en">{{ row.en }}</span>
            </component>
            <SpeakButton :text="row.ru" />
            <p v-if="row.why" class="why">{{ row.why }}</p>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.word-facts {
  display: grid;
  gap: 0.5rem;
}
.facts-heading {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}
.facts-body {
  display: grid;
  gap: 0.75rem;
}
.breakdown {
  display: grid;
  gap: 0.35rem;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.morph {
  display: grid;
  justify-items: center;
  gap: 0.1rem;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-soft);
}
.morph-ru {
  font-weight: 600;
}
.morph-en {
  font-size: 0.75rem;
  color: var(--muted);
}
.fact-line {
  display: flex;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.9rem;
}
.fact-text {
  margin: 0;
  font-size: 0.9rem;
}
.facts-title {
  margin: 0 0 0.35rem;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.see,
.word-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.3rem;
}
.word-rows li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}
.word-link {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  background: none;
  border: none;
  padding: 0;
  color: var(--text);
  font-size: 0.95rem;
  text-align: left;
  cursor: pointer;
}
span.word-link {
  cursor: default;
}
.row-ru {
  font-weight: 600;
}
.relation {
  font-size: 0.75rem;
  color: var(--muted);
}
/* A word the learner hasn't met yet is still shown — seeing that a word has
   relatives ahead of it is part of the point — but it reads as not-yet-theirs. */
.word-rows li.unmet .row-ru {
  font-weight: 400;
  opacity: 0.75;
}
.why {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
}
</style>
