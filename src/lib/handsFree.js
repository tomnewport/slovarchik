// Pure orchestration engine for the fully hands-free spoken practice (issue #25).
//
// Framework-free (no Vue, no DOM, no I/O) so it stays trivially unit-testable,
// mirroring the other `src/lib/*` modules. The view layer (PracticeView.vue)
// drives the microphone and speech synthesis; everything here just decides
// *what* to say, *what* to listen for, and *how* to grade it.
//
// The practice is a continuous loop: pick a random eligible activity, read its
// prompt aloud, listen for the spoken answer, grade it, give audio feedback,
// and move on — entirely by voice. The learner can say "pass" to skip a single
// item or "quit" to end the session, and (during the welcome) "давай" to begin.

import { SLOW_RATE } from './speech.js'
import { gradeSpoken, isPass } from './recognition.js'
import { sample } from './quiz.js'

export { isPass }

const RU = 'ru-RU'
const EN = 'en-GB'

/** The six spoken activities described in issue #25, in a stable order. */
export const ACTIVITY_TYPES = Object.freeze([
  'new-words', // repeat after me: hear RU / EN / RU-slow, say the Russian
  'word-test', // hear English, say the Russian
  'translate-word', // hear Russian, say the English
  'repeat-phrase', // repeat a whole phrase after hearing it
  'translate-phrase', // hear a Russian phrase, say the English
  'phrase-to-russian', // hear an English phrase, say the Russian
])

/** One part of a spoken sequence (text in a language, at a playback rate). */
function part(text, lang, rate = 0.9) {
  return { text: String(text ?? '').trim(), lang, rate }
}

/** First/primary English gloss for a vocab item (its `en` may be an array). */
function primaryEn(item) {
  if (Array.isArray(item.en)) return item.en.find(Boolean) ?? ''
  return String(item.en ?? '')
}

/** All acceptable English answers for a vocab item, as a non-empty-ish list. */
function englishTargets(item) {
  const list = Array.isArray(item.en) ? item.en : [item.en]
  return list.map((s) => String(s ?? '').trim()).filter(Boolean)
}

/**
 * Build the activity descriptor the view runs: what to read before listening
 * (`prompt`), which language to recognise (`recLang`), the acceptable answers
 * (`targets`), the correction to read when wrong or passed (`model`), how many
 * tries the learner gets (`maxAttempts`), and where to record the result
 * (`recordKey` + `dimension` + `level`). Returns null for a missing item.
 *
 * Vocab items are `{ id, ru, en }` (en may be an array of accepted glosses);
 * phrase items are `{ id, ru, en, source }` where `source` is the owning word.
 */
export function buildActivity(type, item) {
  if (!item) return null
  switch (type) {
    case 'new-words': {
      // Repeat after me: Russian, English, then Russian slowly — say it back.
      const en = primaryEn(item)
      return {
        type,
        recordKey: item.id,
        dimension: 'speaking',
        level: 'learning',
        recLang: RU,
        targets: [item.ru],
        maxAttempts: 3,
        prompt: [part(item.ru, RU), part(en, EN), part(item.ru, RU, SLOW_RATE)],
        model: [part(item.ru, RU, SLOW_RATE)],
        display: { ru: item.ru, en },
        say: 'ru',
      }
    }
    case 'word-test': {
      // Quick-fire translation into Russian (word must already be known).
      const en = primaryEn(item)
      return {
        type,
        recordKey: item.id,
        dimension: 'usage',
        level: 'learning',
        recLang: RU,
        targets: [item.ru],
        maxAttempts: 1,
        prompt: [part(en, EN)],
        model: [part(en, EN), part(item.ru, RU), part(item.ru, RU, SLOW_RATE)],
        display: { ru: item.ru, en },
        say: 'ru',
      }
    }
    case 'translate-word': {
      // Hear the Russian, say the English translation.
      const targets = englishTargets(item)
      return {
        type,
        recordKey: item.id,
        dimension: 'hearing',
        level: 'learning',
        recLang: EN,
        targets,
        maxAttempts: 1,
        prompt: [part(item.ru, RU)],
        model: [part(item.ru, RU), part(targets[0] ?? '', EN)],
        display: { ru: item.ru, en: targets[0] ?? '' },
        say: 'en',
      }
    }
    case 'repeat-phrase': {
      // Hear Russian, English, then Russian slowly — repeat the Russian. The
      // Russian comes first (and again, slowly) so there's a clear model to
      // echo before the learner has to produce it.
      return {
        type,
        recordKey: item.source,
        dimension: 'speaking',
        level: 'learning',
        recLang: RU,
        targets: [item.ru],
        maxAttempts: 3,
        prompt: [part(item.ru, RU), part(item.en, EN), part(item.ru, RU, SLOW_RATE)],
        model: [part(item.ru, RU, SLOW_RATE)],
        display: { ru: item.ru, en: item.en },
        say: 'ru',
      }
    }
    case 'translate-phrase': {
      // Hear a Russian phrase, say the English.
      return {
        type,
        recordKey: item.source,
        dimension: 'hearing',
        level: 'learning',
        recLang: EN,
        targets: [item.en],
        maxAttempts: 1,
        prompt: [part(item.ru, RU)],
        model: [part(item.ru, RU), part(item.en, EN)],
        display: { ru: item.ru, en: item.en },
        say: 'en',
      }
    }
    case 'phrase-to-russian': {
      // Hear an English phrase, produce the Russian.
      return {
        type,
        recordKey: item.source,
        dimension: 'usage',
        level: 'learning',
        recLang: RU,
        targets: [item.ru],
        maxAttempts: 1,
        prompt: [part(item.en, EN)],
        model: [part(item.en, EN), part(item.ru, RU), part(item.ru, RU, SLOW_RATE)],
        display: { ru: item.ru, en: item.en },
        say: 'ru',
      }
    }
    default:
      return null
  }
}

/**
 * Grade one or more recogniser guesses against an activity's acceptable
 * answers, keeping the most generous letter-similarity match across every
 * target. Correct when any target is matched at/above the grader's threshold.
 * @returns {{ correct: boolean, similarity: number, best: string }}
 */
export function gradeActivity(activity, guesses) {
  const list = (Array.isArray(guesses) ? guesses : [guesses]).filter(
    (g) => g != null && String(g).trim(),
  )
  let similarity = 0
  let best = list[0] ?? ''
  let correct = false
  for (const target of activity.targets ?? []) {
    const r = gradeSpoken(list, target)
    if (r.similarity > similarity) {
      similarity = r.similarity
      best = r.best
    }
    if (r.correct) correct = true
  }
  return { correct, similarity, best }
}

/**
 * Build a short "warm-up" of `new-words` activities drawn from the current
 * batch, so every session opens by easing the learner in with familiar words
 * before the random mix begins. Picks up to `count` distinct words; returns an
 * empty array when the pool is empty.
 */
export function warmupActivities(items, count, rng = Math.random) {
  return sample(items ?? [], count, rng)
    .map((item) => buildActivity('new-words', item))
    .filter(Boolean)
}

/** Activity types that currently have at least one eligible item. */
export function availableTypes(pools) {
  return ACTIVITY_TYPES.filter((t) => Array.isArray(pools?.[t]) && pools[t].length > 0)
}

/**
 * Pick the next activity at random: choose a random eligible type, then a
 * random item within it. `avoid` (the previous activity's recordKey) is skipped
 * within the chosen type when an alternative exists, so the same word doesn't
 * come up twice in a row. Returns null when nothing is eligible.
 */
export function nextActivity(pools, rng = Math.random, avoid = null) {
  const avail = availableTypes(pools)
  if (!avail.length) return null
  const type = avail[Math.floor(rng() * avail.length)]
  let items = pools[type]
  if (avoid != null && items.length > 1) {
    const filtered = items.filter((i) => (i.id ?? i.source) !== avoid)
    if (filtered.length) items = filtered
  }
  const item = items[Math.floor(rng() * items.length)]
  return buildActivity(type, item)
}

// --- Spoken control words ----------------------------------------------------

/** Content words of an utterance, normalised (lowercased, ё→е, punctuation out). */
function words(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Words that begin the session from the welcome screen. The welcome mic
 * listens in Russian (`ru-RU`), so only Russian "let's go" cues belong here. */
const START_WORDS = new Set([
  'давай',
  'давайте',
  'поехали',
  'начали',
  'начать',
  'погнали',
])

/** Words that end the whole session. */
const QUIT_WORDS = new Set([
  'quit',
  'stop',
  'exit',
  'end',
  'finish',
  'done',
  'хватит',
  'стоп',
  'выход',
  'закончить',
  'конец',
])

function isOnlyFrom(text, set) {
  const w = words(text)
  if (!w.length || w.length > 2) return false
  return w.every((x) => set.has(x))
}

/** True when the whole utterance is a "let's start" cue (e.g. "давай"). */
export function isStart(text) {
  return isOnlyFrom(text, START_WORDS)
}

/** True when the whole utterance is a "quit" cue (e.g. "quit", "стоп"). */
export function isQuit(text) {
  return isOnlyFrom(text, QUIT_WORDS)
}
