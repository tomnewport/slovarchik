// What a word has lost, and what it would take to win it back.
//
// The engine already knows when a word has slipped (`lost`) or sits one miss
// from slipping (`atRisk`), but both arrive as bare lists of keys: the screen
// could say *that* a word had dropped and not *what* dropped or what would fix
// it. This module turns a word's attempt history into that answer — the level
// being repaired, the dimensions still owed, and how many correct answers each
// one wants — so the home rows and the word card can say the same thing from
// one derivation.
//
// Framework-free (no Vue, no store, no DOM) like the rest of `src/lib/`.

import {
  STATES,
  applicableDimensions,
  borderlineDimensions,
  criteriaFor,
  dimensionShortfall,
  needsAnotherDay,
  wordHasInflections,
  wordState,
} from './progression.js'

/** Display names for the skill dimensions, for the sentences built here. */
export const DIM_NAME = Object.freeze({
  identification: 'Identification',
  usage: 'Usage',
  hearing: 'Hearing',
  speaking: 'Speaking',
  context: 'Context',
})

/** What each dimension asks the learner to do, in the learner's terms. */
export const DIM_ASK = Object.freeze({
  identification: 'recognise it',
  usage: 'write it',
  hearing: 'hear it',
  speaking: 'say it',
  context: 'use it in a phrase',
})

const STATE_LABEL = Object.freeze({
  unknown: 'Not started',
  learning: 'Learning',
  learned: 'Learned',
  mastered: 'Mastered',
})

/** The state name for a peak given as either a name or a {@link STATES} rank. */
function stateName(value) {
  if (typeof value === 'number') return STATES[value] ?? null
  return STATES.includes(value) ? value : null
}

function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * Which level's criteria a word still owes: the one that has something to say.
 * A word reaches these cards because a criterion broke, so the useful level is
 * the level the break is at — take the lower one when both have an unmet
 * dimension, since learning must be repaired before mastery means anything.
 *
 * Reading the level off the word's *current state* instead (mastered → mastery,
 * anything else → learning) is what made a word that slipped out of mastery
 * render as four met learning pips: it is `learned`, so the row showed the
 * learning criteria — every one of which it still meets — under a heading saying
 * it had dropped below its best state, with nothing on the row to say what
 * dropped or what would fix it. Falls back to the state-derived level for a word
 * with no unmet dimension at all (an at-risk word: still met, one miss away).
 */
export function repairLevel(events, word = {}, state = null) {
  // A word with no inflection table has no mastery level of its own — mastery
  // collapses onto the learning criteria (see `wordState`) — so its mastery
  // dimensions read as permanently unmet and must never be what a row shows.
  // Only decided when the vocab record is actually to hand: a key missing from
  // the vocab map tells us nothing about whether it inflects.
  if (word.pos && !wordHasInflections(word)) return 'learning'
  const unmet = (level) =>
    applicableDimensions(level, word).some((d) => dimensionShortfall(events, level, d, word) > 0)
  if (unmet('learning')) return 'learning'
  if (unmet('mastery')) return 'mastery'
  return (state ?? wordState(events, word)) === 'mastered' ? 'mastery' : 'learning'
}

/**
 * One line of a recovery plan: a dimension that owes answers (`kind: 'recover'`)
 * or one still met but riding on a wrong last answer (`kind: 'defend'`).
 *
 * `need` is the best case — every added answer correct — so it is a floor, not a
 * forecast. `anotherDay` marks the case where no amount of practice today can
 * finish the job because the day-spacing rule (#313) is what remains.
 */
function step(events, level, dimension, word, kind, now) {
  const crit = criteriaFor(word)[level]?.[dimension] ?? null
  const need = kind === 'defend' ? 1 : dimensionShortfall(events, level, dimension, word)
  const anotherDay = kind === 'recover' && needsAnotherDay(events, level, dimension, now, word)
  const noun = crit?.type === 'attempts' ? 'attempt' : 'correct answer'
  let text = plural(need, noun)
  if (anotherDay) text += need === 1 ? ', tomorrow at the earliest' : ', spread over two days'
  const name = DIM_NAME[dimension] ?? dimension
  return { level, dimension, name, ask: DIM_ASK[dimension] ?? null, need, kind, anotherDay, text }
}

/**
 * What a word has lost and what would win it back.
 *
 * `status` is `slipped` when the word sits below the best state it ever reached,
 * `at-risk` when it still meets every criterion but the most recent answer in
 * some graded dimension was wrong, and `steady` otherwise. The two are ordered,
 * not exclusive: a slipped word can also be borderline elsewhere, and the drop
 * is the thing worth saying first.
 *
 * @param {Array} events the word's recorded attempts
 * @param {PlainObject} word the vocab record (`known`, `pos`, inflection/context flags)
 * @param {{peak?: string|number, state?: string, now?: number}} [opts]
 * @returns {{status: string, state: string, peak: string|null, from: string|null,
 *   to: string|null, level: string, steps: Array, total: number, headline: string}}
 */
export function recoveryPlan(events, word = {}, opts = {}) {
  const now = opts.now ?? Date.now()
  const state = opts.state ?? wordState(events, word)
  const peak = stateName(opts.peak) ?? state
  const slipped = STATES.indexOf(peak) > STATES.indexOf(state)
  const repair = repairLevel(events, word, state)

  const owed = applicableDimensions(repair, word)
    .map((d) => step(events, repair, d, word, 'recover', now))
    .filter((s) => s.need > 0)

  // Nothing outstanding at the repair level: the word is whole but riding on a
  // wrong last answer somewhere, and holding on to it takes one correct answer
  // in exactly that drill (a correct answer elsewhere leaves the wrong attempt
  // as the pair's most recent — see `borderlineDimensions`).
  const borderline = borderlineDimensions(events, word)
  const steps = owed.length
    ? owed
    : borderline.map(({ level: l, dimension }) => step(events, l, dimension, word, 'defend', now))

  // The level the row's pips should show. `repairLevel` only speaks for a word
  // that still owes something; for a word that owes nothing the interesting
  // level is wherever the risk sits — and the lower one when it sits at both,
  // since a learning-level slip is the more consequential.
  const level = owed.length || !borderline.length
    ? repair
    : borderline.some((b) => b.level === 'learning')
      ? 'learning'
      : 'mastery'

  const status = slipped ? 'slipped' : borderline.length ? 'at-risk' : 'steady'
  const total = steps.reduce((sum, s) => sum + s.need, 0)
  return {
    status,
    state,
    peak,
    from: slipped ? STATE_LABEL[peak] : null,
    to: slipped ? STATE_LABEL[state] : null,
    level,
    steps,
    total,
    headline: headlineFor(status, peak, state, steps),
  }
}

/**
 * The plan in one sentence, for a card heading or a row's hover title. Says the
 * drop first (it is why the word is on the card), then the price of undoing it,
 * because "Slipped from Mastered back to Learned" on its own leaves the learner
 * with no idea whether that is an evening's work or a minute's.
 */
function headlineFor(status, peak, state, steps) {
  const total = steps.reduce((sum, s) => sum + s.need, 0)
  if (status === 'slipped') {
    const cost = total ? ` — ${plural(total, 'correct answer')} to go` : ''
    return `Slipped from ${STATE_LABEL[peak]} back to ${STATE_LABEL[state]}${cost}`
  }
  if (status === 'at-risk') {
    const names = steps.map((s) => s.name)
    if (!names.length) return 'One wrong answer from slipping'
    const where = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
    const verb = names.length > 1 ? 'are' : 'is'
    return `One wrong answer from slipping — ${where} ${verb} riding on a miss`
  }
  return total ? `${plural(total, 'correct answer')} to go` : 'Every criterion met'
}
