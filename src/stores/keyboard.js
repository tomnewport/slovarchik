// Shared on-screen keyboard hint.
//
// A drill can ask the keyboard to highlight a set of letters — the vocab
// "intermediate" mode uses this to show which letters the answer is made of
// without revealing their order. The keyboard lives globally in App.vue while
// the drills live in routed views, so this tiny reactive store is how they talk.
import { reactive } from 'vue'

import { hintLetters } from '../lib/quiz.js'

// `letters` is a Set of lowercased, stress-free letters to light up.
export const keyboardHint = reactive({ letters: new Set() })

/** Highlight the letters that make up `word` (replaces any previous hint). */
export function setHintLetters(word) {
  keyboardHint.letters = hintLetters(word)
}

/** Clear the keyboard hint. */
export function clearHintLetters() {
  if (keyboardHint.letters.size) keyboardHint.letters = new Set()
}
