<script setup>
import { speak, speechSupported, SLOW_RATE } from '../lib/speech.js'

// Russian-only: all current call sites pass Russian text; lang defaults to ru-RU.
const props = defineProps({
  text: { type: String, required: true },
  lang: { type: String, default: 'ru-RU' },
  slow: { type: Boolean, default: false },
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
  <button
    v-if="canSpeak && slow"
    type="button"
    class="speak-btn"
    aria-label="Read aloud slowly"
    @click.stop="speak(props.text, props.lang, SLOW_RATE)"
  >
    🐢
  </button>
</template>
