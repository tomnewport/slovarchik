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
// `allowed` gates whether the hint may be used at all: phrase spelling withholds
// it until the learner has tried the spelling once unaided (see TypeExercise),
// so the 💡 key is inert (and lights nothing) on that first attempt.
export const keyboard = reactive({ on: false, allowed: true })

/** Flip the keyboard hint on/off (the keyboard's hint button). Inert when the
 * hint is currently withheld. */
export function toggleHint() {
  if (!keyboard.allowed) return
  keyboard.on = !keyboard.on
}

/** Turn the hint off and re-allow it — drills call this when a lesson starts or
 * ends, restoring the default (hint available, switched off). */
export function resetHint() {
  keyboard.on = false
  keyboard.allowed = true
}

/**
 * Withhold or permit the keyboard hint. Withholding also switches any active
 * hint off, so a phrase's first attempt is always unaided.
 * @param {boolean} allowed
 */
export function setHintAllowed(allowed) {
  keyboard.allowed = allowed
  if (!allowed) keyboard.on = false
}
