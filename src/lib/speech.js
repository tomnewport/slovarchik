// Thin wrapper around the Web Speech API for reading Russian words and
// phrases aloud. Speech is a progressive enhancement: when the API is
// unavailable (older browsers, tests, SSR) every call is a safe no-op.
import { stripStress } from './text.js'

export function speechSupported() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  )
}

// Speak `text` in `lang` (defaults to Russian). Stress marks are stripped so
// the synthesiser reads the word cleanly. Returns true if speech was started.
export function speak(text, lang = 'ru-RU', rate = 0.9) {
  if (!speechSupported()) return false
  const clean = stripStress(text).trim()
  if (!clean) return false
  try {
    window.speechSynthesis.cancel()
    const utter = new window.SpeechSynthesisUtterance(clean)
    utter.lang = lang
    utter.rate = rate
    window.speechSynthesis.speak(utter)
    return true
  } catch {
    // Never let a speech failure break the drill.
    return false
  }
}
