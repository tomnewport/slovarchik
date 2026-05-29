<script setup>
import { speak, speechSupported } from '../lib/speech.js'
defineProps({ text: { type: String, required: true } })
const canSpeak = speechSupported()
</script>

<template>
  <button
    v-if="canSpeak"
    type="button"
    class="speak-btn"
    aria-label="Read aloud"
    @click.stop="speak(text)"
  >
    🔊
  </button>
</template>
