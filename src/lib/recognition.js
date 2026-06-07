// Thin wrapper around the Web Speech API's *recognition* side (speech → text),
// plus the pure helpers that grade what was heard. Like the TTS wrapper this is
// a progressive enhancement: recognition only ships in some browsers (Chrome /
// Edge, behind the `webkit` prefix, and online) so every entry point degrades
// to a safe no-op when it's missing.
import { typingSequence, phraseTokens } from './phrases.js'
import { foldYo } from './text.js'
import { cardinalNominative } from './numerals.js'

/**
 * Expand digit and time patterns in a speech-recognition transcript to their
 * Russian cardinal equivalents. The Web Speech API sometimes returns numeric
 * forms (e.g. "09:00" for "де́вять") instead of spelled-out words, causing
 * letter-level comparison against the Russian target to fail. Applying this
 * before comparison keeps grading correct.
 *
 * "HH:MM" where MM is 00 → cardinal of the hour ("09:00" → "де́вять").
 * "HH:MM" where MM ≠ 00  → hour + minute cardinals ("9:15" → "де́вять пятна́дцать").
 * Remaining bare digit sequences → their cardinal ("5" → "пять").
 * @param {string} text
 * @returns {string}
 */
export function expandNumbers(text) {
  return String(text ?? '')
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => {
      const hours = parseInt(h, 10)
      const mins = parseInt(m, 10)
      if (mins === 0) return cardinalNominative(hours)
      return `${cardinalNominative(hours)} ${cardinalNominative(mins)}`
    })
    .replace(/\b(\d+)\b/g, (_, n) => {
      const v = parseInt(n, 10)
      return v <= 999_999_999 ? cardinalNominative(v) : n
    })
}

/** True when the browser exposes a SpeechRecognition implementation. */
export function recognitionSupported() {
  return (
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  )
}

/** Content tokens of a spoken string, normalised for comparison (stress
 * stripped, lowercased, punctuation dropped, ё folded onto е). */
function tokens(text) {
  return foldYo(typingSequence(text)).split(' ').filter(Boolean)
}

/** Just the letters of an utterance — normalised and with spaces removed — so
 * comparisons count letters, not word boundaries the recogniser may guess. */
function lettersOnly(text) {
  return foldYo(typingSequence(text)).replace(/\s+/g, '')
}

/**
 * Levenshtein edit distance between two strings (insertions, deletions and
 * substitutions). Single-row dynamic programming, O(a·b) time, O(b) space.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  a = String(a ?? '')
  b = String(b ?? '')
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array(b.length + 1)
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

/**
 * Letter-level similarity: the fraction of letters that line up between two
 * utterances, as `1 − editDistance / longerLength` over their letters (spaces,
 * stress, case and punctuation ignored). 1 means identical letters; 0 means
 * completely different. This is the measure the speaking drill grades on — it
 * forgives a single mangled ending far better than word-level overlap does.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0–1
 */
export function charSimilarity(a, b) {
  const x = lettersOnly(a)
  const y = lettersOnly(b)
  if (!x.length && !y.length) return 1
  const longer = Math.max(x.length, y.length)
  if (!longer) return 0
  return 1 - levenshtein(x, y) / longer
}

/**
 * How close two utterances are, as a Sørensen–Dice coefficient over their word
 * tokens (a multiset overlap). 1 means the same words; 0 means nothing shared.
 * Used for the per-word breakdown; grading itself uses {@link charSimilarity}.
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
 * Grade a spoken answer against a target phrase. Recognisers return several
 * guesses per utterance; we score every one by letter-level similarity and keep
 * the most generous — so an answer the recogniser ranked second still counts if
 * its letters line up. Correct when ≥ `threshold` of the letters match (90% by
 * default).
 * @param {string | string[]} transcripts  the recognised guess(es)
 * @param {string} target                  the expected phrase
 * @param {number} [threshold]             min letter-similarity to pass (0–1)
 * @returns {{ correct: boolean, similarity: number, best: string }}
 */
export function gradeSpoken(transcripts, target, threshold = 0.9) {
  const candidates = (Array.isArray(transcripts) ? transcripts : [transcripts])
    .filter((c) => c != null && String(c).trim())
    .map(expandNumbers)
  let similarity = 0
  let best = candidates[0] ?? ''
  for (const candidate of candidates) {
    const s = charSimilarity(candidate, target)
    if (s > similarity) {
      similarity = s
      best = candidate
    }
  }
  return { correct: similarity >= threshold, similarity, best }
}

/**
 * Per-word feedback: walk the target phrase (keeping its original spelling and
 * punctuation) and flag each word as `hit` when the recogniser's transcript
 * contains it, consuming matches from a multiset so a repeated target word needs
 * to be said the right number of times. Also returns the words that were *heard*
 * but aren't in the target (`extra`), and the overall similarity `score`.
 * Punctuation-only tokens carry `skip: true` so callers can render them plainly.
 * @param {string} transcript
 * @param {string} target
 * @returns {{ score: number, words: Array<{ text: string, hit: boolean, skip?: boolean }>, extra: string[] }}
 */
export function wordDiff(transcript, target) {
  const expanded = expandNumbers(transcript)
  const counts = new Map()
  for (const t of tokens(expanded)) counts.set(t, (counts.get(t) ?? 0) + 1)

  const words = phraseTokens(target).map((display) => {
    const norm = foldYo(typingSequence(display))
    if (!norm) return { text: display, hit: true, skip: true } // pure punctuation
    const have = counts.get(norm) ?? 0
    if (have > 0) {
      counts.set(norm, have - 1)
      return { text: display, hit: true }
    }
    return { text: display, hit: false }
  })

  // Whatever's left in the multiset was heard but not wanted.
  const extra = []
  for (const [word, n] of counts) for (let i = 0; i < n; i += 1) extra.push(word)

  return { score: spokenSimilarity(expanded, target), words, extra }
}

/**
 * Start a single-shot recognition session. Returns a small controller with
 * `stop()` (finish and emit the final transcript) and `abort()` (drop it). When
 * recognition is unavailable the callbacks fire an 'unsupported' error and the
 * controller's methods are no-ops, so callers never need to branch.
 *
 * `onEnd` receives the best full transcript plus an array of alternative full
 * transcripts (the recogniser's other guesses, stitched across segments) so the
 * grader can score every guess and keep the most generous.
 *
 * @param {object} opts
 * @param {string} [opts.lang]        BCP-47 tag, e.g. 'ru-RU' or 'en-GB'
 * @param {(r: { transcript: string, final: boolean, alternatives: string[] }) => void} [opts.onResult]
 * @param {(err: string) => void} [opts.onError]
 * @param {(finalTranscript: string, alternatives: string[]) => void} [opts.onEnd]
 * @param {() => void} [opts.onStart]
 * @returns {{ stop: () => void, abort: () => void }}
 */
export function listen({ lang = 'ru-RU', onResult, onError, onEnd, onStart } = {}) {
  if (!recognitionSupported()) {
    onError?.('unsupported')
    onEnd?.('', [])
    return { stop() {}, abort() {} }
  }
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  let rec
  try {
    rec = new Ctor()
  } catch {
    onError?.('unsupported')
    onEnd?.('', [])
    return { stop() {}, abort() {} }
  }

  rec.lang = lang
  rec.interimResults = true
  rec.maxAlternatives = 3
  rec.continuous = false

  // One entry per final result segment, holding that segment's alternative
  // transcripts (best first). Keyed by result index so re-fired events don't
  // double-count.
  const finalAlts = []
  const bestSoFar = () => finalAlts.filter(Boolean).map((a) => a[0]).join('')

  rec.onstart = () => onStart?.()
  rec.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      const alternatives = []
      for (let j = 0; j < result.length; j += 1) alternatives.push(result[j].transcript)
      if (result.isFinal) finalAlts[i] = alternatives
      else interim += alternatives[0] ?? ''
      onResult?.({
        transcript: `${bestSoFar()}${interim}`.trim(),
        final: result.isFinal,
        alternatives,
      })
    }
  }
  rec.onerror = (event) => onError?.(event?.error || 'error')
  rec.onend = () => {
    const segments = finalAlts.filter(Boolean)
    // Build up to maxAlternatives full-phrase guesses by taking the n-th
    // alternative of each segment (falling back to its best where it has fewer).
    const depth = Math.max(0, ...segments.map((a) => a.length))
    const candidates = []
    for (let n = 0; n < depth; n += 1) {
      const guess = segments.map((a) => a[n] ?? a[0]).join('').trim()
      if (guess && !candidates.includes(guess)) candidates.push(guess)
    }
    onEnd?.(candidates[0] ?? '', candidates)
  }

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
