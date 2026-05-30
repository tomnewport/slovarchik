// Thin wrapper around the Web Speech API's *recognition* side (speech → text),
// plus the pure helpers that grade what was heard. Like the TTS wrapper this is
// a progressive enhancement: recognition only ships in some browsers (Chrome /
// Edge, behind the `webkit` prefix, and online) so every entry point degrades
// to a safe no-op when it's missing.
import { typingSequence } from './phrases.js'

/** True when the browser exposes a SpeechRecognition implementation. */
export function recognitionSupported() {
  return (
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  )
}

/** Content tokens of a spoken string, normalised the same way typed answers are
 * (stress stripped, lowercased, ё→е, punctuation dropped). */
function tokens(text) {
  return typingSequence(text).split(' ').filter(Boolean)
}

/**
 * How close two utterances are, as a Sørensen–Dice coefficient over their word
 * tokens (a multiset overlap). 1 means the same words; 0 means nothing shared.
 * Word-level — not character-level — because recognisers return whole words and
 * we want "almost the right words" to score well even with a wrong ending.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0–1
 */
export function spokenSimilarity(a, b) {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.length && !tb.length) return 1
  if (!ta.length || !tb.length) return 0
  const counts = new Map()
  for (const t of ta) counts.set(t, (counts.get(t) ?? 0) + 1)
  let inter = 0
  for (const t of tb) {
    const c = counts.get(t) ?? 0
    if (c > 0) {
      inter += 1
      counts.set(t, c - 1)
    }
  }
  return (2 * inter) / (ta.length + tb.length)
}

/** Words that mean "I don't know, move on" — spoken to skip hands-free. */
const PASS_WORDS = new Set([
  'pass',
  'skip',
  'next',
  'dunno',
  'пас',
  'пасс',
  'дальше',
  'пропустить',
  'пропуск',
  'не',
  'знаю',
  'незнаю',
])

/**
 * True when the whole utterance is just a "pass" word (so a real answer that
 * merely contains "next" isn't swallowed). Accepts e.g. "pass", "не знаю".
 * @param {string} transcript
 * @returns {boolean}
 */
export function isPass(transcript) {
  const t = tokens(transcript)
  if (!t.length || t.length > 2) return false
  return t.every((w) => PASS_WORDS.has(w))
}

/**
 * Grade a spoken answer against a target phrase.
 * @param {string} transcript  what the recogniser heard
 * @param {string} target      the expected phrase
 * @param {number} [threshold] minimum similarity to count as correct (0–1)
 * @returns {{ correct: boolean, similarity: number }}
 */
export function gradeSpoken(transcript, target, threshold = 0.7) {
  const wanted = typingSequence(target)
  const heard = typingSequence(transcript)
  const exact = wanted.length > 0 && heard === wanted
  const similarity = spokenSimilarity(transcript, target)
  return { correct: exact || similarity >= threshold, similarity }
}

/**
 * Start a single-shot recognition session. Returns a small controller with
 * `stop()` (finish and emit the final transcript) and `abort()` (drop it). When
 * recognition is unavailable the callbacks fire an 'unsupported' error and the
 * controller's methods are no-ops, so callers never need to branch.
 *
 * @param {object} opts
 * @param {string} [opts.lang]        BCP-47 tag, e.g. 'ru-RU' or 'en-GB'
 * @param {(r: { transcript: string, final: boolean, alternatives: string[] }) => void} [opts.onResult]
 * @param {(err: string) => void} [opts.onError]
 * @param {(finalTranscript: string) => void} [opts.onEnd]
 * @param {() => void} [opts.onStart]
 * @returns {{ stop: () => void, abort: () => void }}
 */
export function listen({ lang = 'ru-RU', onResult, onError, onEnd, onStart } = {}) {
  if (!recognitionSupported()) {
    onError?.('unsupported')
    onEnd?.('')
    return { stop() {}, abort() {} }
  }
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  let rec
  try {
    rec = new Ctor()
  } catch {
    onError?.('unsupported')
    onEnd?.('')
    return { stop() {}, abort() {} }
  }

  rec.lang = lang
  rec.interimResults = true
  rec.maxAlternatives = 3
  rec.continuous = false

  let final = ''
  rec.onstart = () => onStart?.()
  rec.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      if (result.isFinal) final += result[0].transcript
      else interim += result[0].transcript
      const alternatives = []
      for (let j = 0; j < result.length; j += 1) alternatives.push(result[j].transcript)
      onResult?.({
        transcript: `${final}${interim}`.trim(),
        final: result.isFinal,
        alternatives,
      })
    }
  }
  rec.onerror = (event) => onError?.(event?.error || 'error')
  rec.onend = () => onEnd?.(final.trim())

  try {
    rec.start()
  } catch {
    // start() throws if called while already running; treat as a soft error.
    onError?.('start-failed')
  }

  return {
    stop() {
      try {
        rec.stop()
      } catch {
        // already stopped
      }
    },
    abort() {
      try {
        rec.abort()
      } catch {
        // already stopped
      }
    },
  }
}

/** Human-readable explanation for a recognition error code. */
export function recognitionErrorMessage(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked — allow it in your browser to use speaking drills.'
    case 'no-speech':
      return 'Didn’t catch that — try again.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'network':
      return 'Speech recognition needs a network connection in this browser.'
    case 'unsupported':
      return 'This browser can’t do speech recognition (try Chrome or Edge).'
    default:
      return 'Something went wrong with speech recognition — try again.'
  }
}
