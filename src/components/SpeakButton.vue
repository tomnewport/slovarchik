<script setup>
import { speak, speechSupported } from '../lib/speech.js'

// Russian-only: all current call sites pass Russian text; lang defaults to ru-RU.
const props = defineProps({
  text: { type: String, required: true },
  lang: { type: String, default: 'ru-RU' },
})

const canSpeak = speechSupported()
</script>

<template>
  <button
    v-if="canSpeak"
    type="button"
    class="speak-btn"
    aria-label="Read aloud"
    @click.stop="speak(props.text, props.lang)"
  >
    🔊
  </button>
</template>
