// Pure logic for the mode-based Speaking drill (SpeakingView.vue).
//
// Framework-free (no Vue, no DOM, no I/O) so it stays trivially unit-testable,
// mirroring the sibling `handsFree.js` engine that drives PracticeView. The view
// still owns the microphone, speech synthesis and timers; everything here just
// decides *what* to say, *when* to warm up, *how* to grade, and *whether* to
// retry — the parts worth testing in isolation.

import { SLOW_RATE } from './speech.js'
import { isPass, gradeSpoken, wordDiff } from './recognition.js'

// How long the ✓ celebration shows before the hands-free loop moves on.
export const CELEBRATE_MS = 2500
// How long to pause after the model answer is read aloud (incorrect / passed),
// giving enough time to read the phrase and attempt to repeat it.
export const REVIEW_MS = 4000
// Phrases with this many Russian words or more get a word-by-word warm-up in
// hands-free mode before the first full-phrase listening attempt.
export const LONG_PHRASE_WORDS = 5
// Auto re-listens after a silent result, capped so a blocked mic can't spin.
export const MAX_EMPTY_RETRIES = 5

// Errors that won't fix themselves — never auto-retry listening on these.
export const FATAL_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
  'network',
  'unsupported',
])

// The three speaking challenges. `recLang` is what the recogniser listens for;
// `target` is the field of the phrase the spoken answer is graded against;
// `promptRu` reads the Russian aloud when the question appears; `showRu`/`showEn`
// decide what's on screen before the answer is revealed.
export const MODES = [
  {
    id: 'echo',
    emoji: '🗣️',
    label: 'Echo · say it in Russian',
    help: 'See the Russian and English, hear it read out, then say it back. Checks your pronunciation.',
    recLang: 'ru-RU',
    target: 'ru',
    promptRu: true,
    showRu: true,
    showEn: true,
  },
  {
    id: 'produce',
    emoji: '🇷🇺',
    label: 'Produce · translate into Russian',
    help: 'See the English, say the Russian. The correct phrase is then read aloud.',
    recLang: 'ru-RU',
    target: 'ru',
    promptRu: false,
    showRu: false,
    showEn: true,
  },
  {
    id: 'interpret',
    emoji: '🎧',
    label: 'Interpret · translate into English',
    help: 'Hear a Russian phrase, say the English — or say "pass". Hands-free with spoken feedback.',
    recLang: 'en-GB',
    target: 'en',
    promptRu: true,
    showRu: false,
    showEn: false,
  },
]

/** The mode config for an id, or null when unknown. */
export function findMode(id) {
  return MODES.find((m) => m.id === id) ?? null
}

/** The Russian words of a phrase, whitespace-split with blanks dropped. */
export function ruWords(ru) {
  return String(ru ?? '')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Whether a Russian prompt gets the word-by-word warm-up: only in hands-free
 * mode, and only for phrases of `LONG_PHRASE_WORDS` words or more.
 */
export function needsWarmUp(ru, handsFree) {
  return Boolean(handsFree) && ruWords(ru).length >= LONG_PHRASE_WORDS
}

/**
 * Warm-up sequence for long phrases: full Russian → English → slow Russian →
 * "Repeat each word:" → each word individually (letters only, slowly). Callers
 * play this before opening the mic on the first attempt.
 */
export function buildWarmUpSequence(phrase) {
  const wordItems = ruWords(phrase?.ru)
    .map((w) => ({ text: w.replace(/[^\p{L}]/gu, ''), lang: 'ru-RU', rate: 0.7 }))
    .filter((item) => item.text)
  return [
    { text: phrase.ru, lang: 'ru-RU', rate: 0.9 },
    { text: phrase.en, lang: 'en-GB', rate: 1 },
    { text: phrase.ru, lang: 'ru-RU', rate: SLOW_RATE },
    { text: 'Repeat each word:', lang: 'en-GB', rate: 1 },
    ...wordItems,
  ]
}

/**
 * Grade the recogniser's guesses for a question against the mode's target text.
 * Mirrors the view's previous inline logic exactly:
 *  - "pass" utterances score 0 and are never counted correct;
 *  - otherwise grade on the most generous of all guesses (`gradeSpoken`);
 *  - a per-word diff is built for a real attempt, and skipped on a pass.
 * @returns {{ passed, correct, similarity, best, diff }}
 */
export function gradeGuesses(finalText, alternatives, target) {
  const passed = isPass(finalText)
  const guesses = alternatives?.length ? alternatives : [finalText]
  const { correct, similarity, best } = passed
    ? { correct: false, similarity: 0, best: finalText }
    : gradeSpoken(guesses, target)
  const diff = passed ? null : wordDiff(best, target)
  return { passed, correct, similarity, best, diff }
}

/**
 * The spoken feedback after grading: a short English cue, then the Russian
 * phrase (slow when wrong so there's a clear model to echo). Returns both the
 * cue and the full sequence to hand to speech synthesis.
 */
export function buildFeedbackSequence({ correct, passed }, ru) {
  const cue = correct ? 'Correct.' : passed ? 'Passed.' : 'Not quite.'
  const ruRate = correct ? 0.9 : SLOW_RATE
  return {
    cue,
    sequence: [
      { text: cue, lang: 'en-GB', rate: 1 },
      { text: ru, lang: 'ru-RU', rate: ruRate },
    ],
  }
}

/**
 * Whether an empty (silent) recognition result should re-open the mic:
 * hands-free only, never on a fatal error, and only while under the retry cap.
 */
export function shouldRetryEmpty(handsFree, recError, retries) {
  return Boolean(handsFree) && !FATAL_ERRORS.has(recError) && retries < MAX_EMPTY_RETRIES
}
