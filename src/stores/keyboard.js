// Shared on-screen keyboard hint state.
//
// The on-screen keyboard (RussianKeyboard) carries a "hint" button. Once the
// learner switches it on it stays on for the rest of the lesson and the
// keyboard lights up the next character to type (plus a couple of decoys) for
// whichever field is focused. The keyboard lives globally in App.vue while the
// drills live in routed views, so this tiny reactive store is how they share
// the toggle — the drills reset it when a lesson starts or ends.
import { reactive } from 'vue'

// `on` is the sticky hint toggle, flipped by the keyboard's hint button.
export const keyboard = reactive({ on: false })

/** Flip the keyboard hint on/off (the keyboard's hint button). */
export function toggleHint() {
  keyboard.on = !keyboard.on
}

/** Turn the hint off — drills call this when a lesson starts or ends. */
export function resetHint() {
  keyboard.on = false
}
