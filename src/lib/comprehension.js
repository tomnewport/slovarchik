// What the Russian says that the English translation cannot — as a question the
// learner can answer after they have already got the translation right (#597).
//
// Russian→English is safe in the way English→Russian is not: the learner sees
// the Russian, so nothing is hidden and no prompt is unanswerable. But the drill
// never checks whether they *read* it. «Она́ благодари́ла учи́теля» and «Она́
// поблагодари́ла учи́теля» are both "She thanked the teacher", and a learner can
// answer both correctly while taking them to mean the same thing.
//
// The fix is not to bend the English until it carries the distinction: that was
// tried and undone in #581, because "She was thanking the teacher" is a worse
// sentence than the one it replaced. The English stays natural and the question
// is asked separately, after the graded answer is already in.
//
// So this is a **comprehension probe, not an assessment**. The translation was
// correct; there is nothing left to mark. Getting the probe wrong teaches, and
// costs nothing — no attempt is recorded, and `progress.js` never hears about it.
//
// Everything is derived. The corpus already carries the aspect of every verb,
// its aspectual partner, and — for the verbs of motion — its directional partner;
// the `inflect:` annotation on the sentence already names which token is the verb
// and what tense it stands in. Nothing here is authored, which is what makes it
// worth ~1,900 sentences rather than the two that a purely aspect-collision
// framing would have reached.
import { phraseTokens } from './phrases.js'

/**
 * The two readings an aspect pair offers, by tense. Present is absent on
 * purpose: a Russian present tense is imperfective by definition, so there is no
 * second reading to choose between — and English carries "is doing" perfectly
 * well anyway. The contrast bites in the past and the future, where both aspects
 * exist and English collapses them onto one sentence.
 */
const ASPECT_READINGS = {
  past: {
    impf: 'it was going on, or happened more than once',
    pf: 'it happened once, and was finished',
  },
  future: {
    impf: 'it will be going on, or will happen again and again',
    pf: 'it will happen once, and then be done',
  },
}

/**
 * The two readings a verb of motion offers. Unlike aspect this holds in every
 * tense, because both members are imperfective — the contrast is direction and
 * habit, not completion.
 */
const MOTION_READINGS = {
  det: 'one journey, going one way',
  indet: 'a regular trip, or there and back',
}

/** How to name the form the sentence actually used, in the explanation. */
const LABELS = {
  impf: 'imperfective',
  pf: 'perfective',
  det: 'the determinate verb',
  indet: 'the indeterminate verb',
}

/** The `inflect:` annotation for this exact sentence, or null. */
function annotationFor(phrase, annotations) {
  const list = annotations?.get?.(phrase?.source) ?? []
  return list.find((c) => c.ru === phrase?.ru) ?? null
}

/** The surface word the annotation points at, so the explanation can name it. */
function targetToken(ru, annotation) {
  const at = Number(annotation?.target?.token)
  if (!Number.isInteger(at) || at < 1) return ''
  return phraseTokens(ru)[at - 1] ?? ''
}

/**
 * Build the probe from a pair of readings: two options in a fixed order, the
 * one matching the sentence marked as the answer, and an explanation that names
 * the partner the learner did *not* see.
 */
function probe({ kind, readings, mine, partner, token, lemma }) {
  const theirs = Object.keys(readings).find((k) => k !== mine)
  if (!theirs || !readings[mine]) return null
  // Ordered by the readings map, not by which one is right, so the answer is not
  // always in the same place.
  const options = Object.entries(readings).map(([id, text]) => ({ id, text }))
  const named = token ? `«${token}»` : lemma
  return {
    kind,
    question: 'What does the Russian say that your English does not?',
    options,
    answer: mine,
    why:
      `${named} is ${LABELS[mine]}.` +
      (partner ? ` Its partner ${partner.ru} would say: ${readings[theirs]}.` : ''),
  }
}

/**
 * The comprehension probe for a phrase the learner has just translated into
 * English, or null when the sentence hides nothing worth asking about.
 *
 * Null is the common case and the right one: a probe on every sentence would be
 * noise, and one asked where the English *does* carry the distinction teaches
 * the learner that it doesn't.
 *
 * @param {{ru: string, source: string}} phrase a shaped phrase (shapePhrases)
 * @param {object} ctx
 * @param {Map<string, object>} ctx.byKey key → word record (buildWords)
 * @param {Map<string, object[]>} ctx.annotations key → context phrases
 *   (indexPhrases over shapeContextPhrases) — where the `inflect:` tense lives
 * @returns {?{kind: string, question: string, options: Array<{id, text}>,
 *   answer: string, why: string}}
 */
export function comprehensionCheck(phrase, { byKey, annotations } = {}) {
  const word = byKey?.get?.(phrase?.source)
  if (!word || word.pos !== 'verb') return null
  const annotation = annotationFor(phrase, annotations)
  if (!annotation) return null
  const token = targetToken(phrase.ru, annotation)
  const lemma = word.headword || word.ru

  // Motion first where a verb has both partners. Aspect is a distinction English
  // can at least gesture at with a progressive; идти́ against ходи́ть is one it
  // cannot make at all, so it is the more useful question of the two.
  if (word.motionPair && MOTION_READINGS[word.motion]) {
    return probe({
      kind: 'motion',
      readings: MOTION_READINGS,
      mine: word.motion,
      partner: word.motionPair,
      token,
      lemma,
    })
  }

  const readings = ASPECT_READINGS[annotation.target?.tense]
  if (!readings || !word.aspectPair || !readings[word.aspect]) return null
  return probe({
    kind: 'aspect',
    readings,
    mine: word.aspect,
    partner: word.aspectPair,
    token,
    lemma,
  })
}
