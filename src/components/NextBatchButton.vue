<script setup>
// One action shared by translated words in the reader, minigames and Progress.
import { computed, ref } from 'vue'
import { wordsByKey } from '../stores/vocab.js'
import { state, stateOf, loadProgress, queueForNextBatch, removeFromNextBatch } from '../stores/progress.js'

const props = defineProps({ wordKey: { type: String, required: true } })
const busy = ref(false)
const word = computed(() => wordsByKey.value.get(props.wordKey))
const queued = computed(() => state.learningWishlist.includes(props.wordKey))
const eligible = computed(() => word.value?.learnable !== false && !!word.value &&
  ['unknown', 'learning'].includes(stateOf(props.wordKey)) &&
  !state.learning?.words.includes(props.wordKey))

async function toggle() {
  if (busy.value) return
  busy.value = true
  try {
    if (!state.loaded) await loadProgress()
    if (queued.value) await removeFromNextBatch(props.wordKey)
    else if (eligible.value) await queueForNextBatch(props.wordKey)
  } finally { busy.value = false }
}
</script>

<template>
  <button v-if="queued || eligible" type="button" class="next-batch" :aria-pressed="queued"
    :aria-label="`${queued ? 'Remove' : 'Add'} ${word?.headword || word?.ru || wordKey} ${queued ? 'from' : 'to'} next batch wishlist`"
    :disabled="busy" @click.stop="toggle">
    {{ queued ? '✓ Next batch' : '+ Next batch' }}
  </button>
</template>

<style scoped>
button.next-batch { font-size: .8rem; padding: .35rem .55rem; border: 1px solid var(--good); border-radius: .45rem; background: color-mix(in srgb, var(--good) 12%, transparent); color: inherit; }
button.next-batch[aria-pressed='true'] { background: color-mix(in srgb, var(--good) 25%, transparent); }
</style>
