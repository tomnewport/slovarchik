<script setup>
import { ref, computed } from 'vue'

import { state as vocabState } from '@/stores/vocab.js'
import { state as progressState, commitBatch, stateOf } from '@/stores/progress.js'
import { COLLECTIONS } from '@/lib/collections.js'
import { learnableWords } from '@/lib/vocabBuild.js'
import { isEligible, batchSize, refineToLowest } from '@/lib/batches.js'

const props = defineProps({
  level: { type: String, default: 'learning' },
})

const query = ref('')
const focused = ref(false)
const justAdded = ref('')

const batch = computed(() => progressState[props.level])
const batchWordSet = computed(() => new Set(batch.value?.words ?? []))

function eligibleCollectionWords(collectionName) {
  const words = learnableWords(vocabState.words)
  return words.filter(
    (w) =>
      isEligible(stateOf(w.key), props.level) &&
      (w.collections ?? []).includes(collectionName) &&
      !batchWordSet.value.has(w.key),
  )
}

const results = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q || !vocabState.words.length) return []

  const wordMatches = learnableWords(vocabState.words)
    .filter(
      (w) =>
        w.ru?.toLowerCase().includes(q) ||
        w.en?.toLowerCase().includes(q) ||
        w.meaning?.toLowerCase().includes(q),
    )
    .slice(0, 5)
    .map((w) => ({
      type: 'word',
      key: w.key,
      ru: w.headword || w.ru,
      en: w.meaning || w.en,
      cefr: w.cefr,
      inBatch: batchWordSet.value.has(w.key),
    }))

  const collectionMatches = COLLECTIONS.filter((c) => c.toLowerCase().includes(q))
    .slice(0, 3)
    .map((c) => {
      const newWords = eligibleCollectionWords(c)
      return { type: 'collection', name: c, newCount: Math.min(newWords.length, 5) }
    })
    .filter((c) => c.newCount > 0)

  return [...wordMatches, ...collectionMatches]
})

const showDropdown = computed(() => focused.value && results.value.length > 0)

let addedTimer = null

async function selectWord(result) {
  if (!batch.value || result.inBatch) return
  const updated = JSON.parse(JSON.stringify(batch.value))
  updated.words.push(result.key)
  updated.size = updated.words.length
  await commitBatch(updated)
  flash(`+ ${result.ru}`)
}

async function selectCollection(result) {
  if (!batch.value || result.newCount === 0) return
  const eligible = eligibleCollectionWords(result.name)
  const pool = refineToLowest(eligible, batchSize(props.level))
  const toAdd = pool.slice(0, 5).map((w) => w.key)
  const updated = JSON.parse(JSON.stringify(batch.value))
  updated.words.push(...toAdd)
  updated.size = updated.words.length
  await commitBatch(updated)
  flash(`+ ${toAdd.length} from ${result.name}`)
}

function flash(msg) {
  clearTimeout(addedTimer)
  justAdded.value = msg
  // Clearing the query empties `results`, which closes the dropdown on its own.
  // We deliberately leave `focused` untouched: the `@mousedown.prevent` on each
  // item keeps the input focused, so a matching `@focus` event never fires. If
  // we forced `focused = false` here it would desync from the real DOM focus and
  // the dropdown would stay hidden on the next keystroke until a manual blur +
  // re-focus. Leaving it true lets the learner keep adding words in one go.
  query.value = ''
  addedTimer = setTimeout(() => (justAdded.value = ''), 2000)
}

async function selectResult(result) {
  if (result.type === 'word') await selectWord(result)
  else await selectCollection(result)
}

function handleBlur() {
  setTimeout(() => (focused.value = false), 150)
}
</script>

<template>
  <div class="batch-search">
    <div class="input-wrap">
      <input
        v-model="query"
        type="text"
        class="search-input"
        placeholder="Add a word or collection…"
        autocomplete="off"
        @focus="focused = true"
        @blur="handleBlur"
      />
      <span v-if="justAdded" class="added-flash">{{ justAdded }}</span>
    </div>
    <ul v-if="showDropdown" class="dropdown">
      <li
        v-for="r in results"
        :key="r.type + (r.key ?? r.name)"
        class="item"
        :class="{ disabled: r.type === 'word' && r.inBatch }"
        @mousedown.prevent="selectResult(r)"
      >
        <template v-if="r.type === 'word'">
          <span class="ru">{{ r.ru }}</span>
          <span class="en muted">{{ r.en }}</span>
          <span v-if="r.inBatch" class="tag muted">✓ in batch</span>
          <span v-else class="cefr muted">{{ r.cefr }}</span>
        </template>
        <template v-else>
          <span class="col-name">{{ r.name }}</span>
          <span class="tag muted">+{{ r.newCount }} words</span>
        </template>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.batch-search {
  position: relative;
  margin-top: 0.6rem;
}

.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.search-input {
  font-size: 0.82rem;
  padding: 0.38rem 0.65rem;
  border-radius: 8px;
}

.added-flash {
  position: absolute;
  right: 0.65rem;
  font-size: 0.78rem;
  color: var(--good);
  pointer-events: none;
  white-space: nowrap;
}

.dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  list-style: none;
  padding: 0.3rem;
  margin: 0;
  z-index: 200;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  display: grid;
  gap: 0.1rem;
}

.item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.42rem 0.6rem;
  border-radius: 7px;
  cursor: pointer;
  font-size: 0.83rem;
  transition: background 0.1s ease;
}

.item:hover:not(.disabled) {
  background: var(--bg-soft);
}

.item.disabled {
  opacity: 0.45;
  cursor: default;
}

.ru {
  font-weight: 500;
  flex-shrink: 0;
}

.en {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
}

.col-name {
  flex: 1;
  font-style: italic;
}

.cefr {
  font-size: 0.72rem;
  flex-shrink: 0;
}

.tag {
  font-size: 0.72rem;
  flex-shrink: 0;
}
</style>
