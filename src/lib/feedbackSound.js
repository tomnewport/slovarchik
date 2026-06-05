// Procedurally synthesised end-of-exercise feedback sounds (issue #111): a
// brief, bright chime when an exercise is completed correctly and a softer,
// neutral tone when mistakes were made. The sounds are generated with the Web
// Audio API rather than shipped as audio files, so they add nothing to the
// bundle and work fully offline. Like speech, audio is a progressive
// enhancement: when the Web Audio API is unavailable (older browsers, tests,
// SSR) every call is a safe no-op.
//
// Each sound is a short sequence of notes. A note is
//   { freq, start, dur, type, gain }
// where `start`/`dur` are seconds relative to playback start, `type` the
// oscillator waveform (default 'sine') and `gain` its peak volume (0–1,
// default 0.2). A tiny attack/release envelope is applied so notes don't click.

// Five bright, upward-moving options for a correct answer.
export const SUCCESS_SOUNDS = [
  {
    id: 'chime',
    label: 'Chime',
    notes: [
      { freq: 659.25, start: 0, dur: 0.13, type: 'triangle', gain: 0.2 },
      { freq: 987.77, start: 0.1, dur: 0.22, type: 'triangle', gain: 0.18 },
    ],
  },
  {
    id: 'sparkle',
    label: 'Sparkle',
    notes: [
      { freq: 523.25, start: 0, dur: 0.09, type: 'triangle', gain: 0.16 },
      { freq: 659.25, start: 0.08, dur: 0.09, type: 'triangle', gain: 0.16 },
      { freq: 783.99, start: 0.16, dur: 0.09, type: 'triangle', gain: 0.16 },
      { freq: 1046.5, start: 0.24, dur: 0.2, type: 'triangle', gain: 0.16 },
    ],
  },
  {
    id: 'bell',
    label: 'Bell',
    notes: [{ freq: 1046.5, start: 0, dur: 0.4, type: 'sine', gain: 0.22 }],
  },
  {
    id: 'pop',
    label: 'Pop',
    notes: [
      { freq: 392.0, start: 0, dur: 0.06, type: 'triangle', gain: 0.18 },
      { freq: 783.99, start: 0.05, dur: 0.14, type: 'triangle', gain: 0.2 },
    ],
  },
  {
    id: 'fanfare',
    label: 'Fanfare',
    notes: [
      { freq: 523.25, start: 0, dur: 0.12, type: 'triangle', gain: 0.2 },
      { freq: 783.99, start: 0.11, dur: 0.24, type: 'triangle', gain: 0.2 },
    ],
  },
]

// Five soft, neutral options for when mistakes were made — gentle, never harsh.
export const NEUTRAL_SOUNDS = [
  {
    id: 'soft',
    label: 'Soft',
    notes: [{ freq: 440.0, start: 0, dur: 0.18, type: 'sine', gain: 0.16 }],
  },
  {
    id: 'tap',
    label: 'Tap',
    notes: [{ freq: 349.23, start: 0, dur: 0.1, type: 'sine', gain: 0.16 }],
  },
  {
    id: 'knock',
    label: 'Knock',
    notes: [
      { freq: 261.63, start: 0, dur: 0.09, type: 'sine', gain: 0.18 },
      { freq: 261.63, start: 0.12, dur: 0.09, type: 'sine', gain: 0.16 },
    ],
  },
  {
    id: 'settle',
    label: 'Settle',
    notes: [
      { freq: 440.0, start: 0, dur: 0.1, type: 'sine', gain: 0.16 },
      { freq: 349.23, start: 0.09, dur: 0.16, type: 'sine', gain: 0.16 },
    ],
  },
  {
    id: 'hum',
    label: 'Hum',
    notes: [{ freq: 293.66, start: 0, dur: 0.22, type: 'triangle', gain: 0.14 }],
  },
]

/** True when the browser can synthesise audio. */
export function audioSupported() {
  return (
    typeof window !== 'undefined' &&
    !!(window.AudioContext || window.webkitAudioContext)
  )
}

// One shared AudioContext, created lazily on first playback (and only after a
// user gesture, so autoplay policies don't block it).
let ctx = null
function audioContext() {
  if (!audioSupported()) return null
  const Ctor = window.AudioContext || window.webkitAudioContext
  try {
    if (!ctx) ctx = new Ctor()
    return ctx
  } catch {
    return null
  }
}

/**
 * Play a sequence of synthesised notes. Resolves to true if playback was
 * scheduled. A no-op (resolving to false) when the Web Audio API is unavailable.
 */
export async function playNotes(notes) {
  if (!Array.isArray(notes) || !notes.length) return false
  const ac = audioContext()
  if (!ac) return false
  try {
    // Wait for a suspended context (e.g. backgrounded tab) to actually resume
    // before reading currentTime, or the notes would be scheduled in the past.
    if (ac.state === 'suspended') await ac.resume?.()
    const t0 = ac.currentTime
    for (const note of notes) {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = note.type || 'sine'
      osc.frequency.value = note.freq
      const start = t0 + (note.start || 0)
      const dur = note.dur || 0.15
      const peak = note.gain ?? 0.2
      // Short attack/release so notes fade in and out rather than clicking.
      const attack = Math.min(0.01, dur / 4)
      const release = Math.min(0.08, dur / 2)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(peak, start + attack)
      gain.gain.setValueAtTime(peak, start + Math.max(attack, dur - release))
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
      osc.connect(gain).connect(ac.destination)
      osc.start(start)
      osc.stop(start + dur + 0.02)
    }
    return true
  } catch {
    // Never let an audio failure break a drill.
    return false
  }
}

/** Look up a sound by kind ('success' → bright, 'neutral' → soft) and id. */
export function soundById(kind, id) {
  const list = kind === 'success' ? SUCCESS_SOUNDS : NEUTRAL_SOUNDS
  return list.find((s) => s.id === id) ?? null
}

/** Play a named feedback sound. Resolves to true if playback was scheduled. */
export function playSound(kind, id) {
  const sound = soundById(kind, id)
  if (!sound) return false
  return playNotes(sound.notes)
}

/** Drop the cached AudioContext so a fresh `window.AudioContext` is picked up (tests). */
export function _resetForTests() {
  ctx = null
}
