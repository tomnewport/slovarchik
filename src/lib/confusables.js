// "What did the learner actually write?" — one diagnosis, several consumers
// (#584, #588).
//
// A wrong answer that is a real, related word is not gibberish. Typing «сшить»
// when the drill wants «шить» is *to sew* in the wrong aspect, and the learner
// is one sentence away from understanding why. Today that answer is rejected
// exactly like nonsense, and — because an aspect pair deliberately shares one
// gloss (#527) — the rejection can show the learner the very meaning they were
// already thinking of.
//
// The lookup costs nothing new: `buildFormIndex` (phraseHint.js) already maps
// any surface form, inflected included, to the entry it belongs to. What this
// module adds is the *ranking* — which of the several true things about the
// typed word is the one worth saying.
//
// Pure and framework-free, so the spelling drill and the flashcard drill share
// it and can't drift apart.
import { ASPECT_LABEL, MOTION_LABEL } from './phraseContext.js'
import { normToken, normTokenStress } from './phraseHint.js'
import { aspectSense } from './spellPrompt.js'
import { stripStress } from './text.js'
import { confusionNote } from './wordFacts.js'

/**
 * Verdict types, strongest first. "Strongest" means most specific: a form of the
 * target word is a better thing to say than "that's a different word", and the
 * aspect partner is a better thing to say than "same letters, different stress".
 */
export const VERDICTS = [
  'wrong-form',
  'aspect',
  'heteronym',
  'homograph',
  'synonym',
  'wrong-sense',
  'confusable',
  'other-word',
]

const rank = (type) => VERDICTS.indexOf(type)

/** Bare, case-folded spelling — the identity two forms are compared on. */
const bare = (value) => stripStress(String(value ?? '')).toLowerCase()

/**
 * Look a typed word up in the form index, preferring the stress-aware index when
 * the learner actually marked the stress. Without that, «за́мок» and «замо́к» are
 * the same key and a heteronym can never be told apart.
 */
function lookup(formIndex, typed) {
  const stressed = normTokenStress(typed)
  if (stressed !== normToken(typed)) {
    const hit = formIndex.stressIndex?.get(stressed)
    if (hit) return hit
  }
  return formIndex.get(normToken(typed)) ?? null
}

/**
 * The display facts about one word, from its record or (failing that) the index
 * sense. `form` is what the learner actually typed, kept apart from the lemma:
 * for a wrong *form* of the target the lemma is the answer, so only their own
 * spelling can be quoted back at them.
 */
function facts(record, sense, form = '') {
  return {
    key: sense?.key ?? record?.key ?? null,
    ru: record?.headword || record?.ru || sense?.ru || '',
    en: record?.meaning || record?.en || sense?.en || '',
    note: record?.meaningNote || '',
    form: String(form ?? '').trim(),
  }
}

/**
 * How one word relates to the word being asked for, whichever direction the
 * learner is answering in. Shared so the spelling drill and the flashcard drill
 * rank the same facts the same way.
 */
function relate(got, typed, want) {
  const base = { typed, want: facts(want, null) }

  // The aspect (or motion) partner: the case that most needs its own wording,
  // because for an identical-gloss pair the aspect is the entire difference.
  if (got?.key === want.aspectPair?.key) {
    return {
      ...base,
      type: 'aspect',
      dimension: 'aspect',
      gotGrade: got?.aspect,
      wantGrade: want.aspect,
    }
  }
  if (got?.key === want.motionPair?.key) {
    return {
      ...base,
      type: 'aspect',
      dimension: 'motion',
      gotGrade: got?.motion,
      wantGrade: want.motion,
    }
  }

  // Same letters. Whether stress is the difference is a question about the two
  // spellings, not an assumption: «за́мок»/«замо́к» really are told apart by it,
  // but «чай» (tea) and «чай» (I suppose) are spelled identically, stress and
  // all, and telling a learner to move the stress there is advice they cannot
  // act on (#641). `linkHeteronyms` (vocabBuild.js) draws the same line.
  const wantRu = want.headword || want.ru
  if (bare(typed.ru) === bare(wantRu)) {
    const differsByStress = normTokenStress(typed.ru) !== normTokenStress(wantRu)
    return { ...base, type: differsByStress ? 'heteronym' : 'homograph' }
  }

  // Words sharing the target's base gloss split two ways. With no notes on
  // either side they are interchangeable — the learner said something correct,
  // in the wrong slot. With notes, the notes were written precisely to separate
  // the two senses (#527), so "right word, wrong sense" is what happened, and
  // quoting them says more than "that's a synonym".
  if ((want.ambiguousEn ?? []).some((a) => bare(a.ru) === bare(typed.ru))) {
    return { ...base, type: typed.note || want.meaningNote ? 'wrong-sense' : 'synonym' }
  }

  const link = (want.confusables ?? []).find((c) => c.key === got?.key)
  if (link) return { ...base, type: 'confusable', why: link.why }

  return { ...base, type: 'other-word' }
}

/**
 * The learner wrote the word being asked for — just not the form of it that was
 * wanted. Nothing this module can say beats the drill's own error map, and no
 * *other* reading of those letters is more relevant, so this verdict silences
 * the diagnosis outright rather than yielding the floor to a homograph.
 */
const SAME_WORD = Symbol('same word, other form')

/**
 * The single verdict for one candidate sense of what the learner typed, null
 * when there is nothing to say about it, or {@link SAME_WORD}.
 */
function verdictFor(sense, want, typedForm, targetForm, byKey) {
  const got = byKey.get(sense.key) ?? null
  const typed = facts(got, sense, typedForm)
  if (!typed.ru) return null

  // No target record (a phrase token that isn't a curriculum word): all we can
  // honestly report is what they wrote.
  if (!want) return { type: 'other-word', typed, want: null }

  // A form of the very word being asked for — right lemma, wrong cell.
  if (sense.key === want.key) {
    // The wanted form itself: that would have been graded correct.
    if (bare(typedForm) === bare(targetForm)) return SAME_WORD
    // Only worth saying when the answer is the *dictionary* form, where "I want
    // the dictionary form" is precise. Inside a phrase the wanted form is some
    // inflected cell this module can't name, and the drill's own error map
    // already shows the ending that went wrong — more precisely than any
    // sentence here could. Fall through to it.
    if (bare(targetForm) !== bare(want.headword || want.ru)) return SAME_WORD
    return { typed, want: facts(want, null), type: 'wrong-form', wantForm: 'lemma' }
  }

  return relate(got ?? { key: sense.key }, typed, want)
}

/**
 * Diagnose a wrong answer: what word did the learner actually write, and how
 * does it relate to the one being asked for?
 *
 * @param {string} typed the learner's answer
 * @param {object} ctx
 * @param {string} ctx.targetKey natural key of the word being drilled
 * @param {string} ctx.target the wanted surface form (a word or a whole phrase)
 * @param {Map} ctx.formIndex from `buildFormIndex` (phraseHint.js)
 * @param {Map} ctx.byKey key → word record
 * @returns {object|null} a verdict, or null when there is no confusion to name —
 *   the answer isn't a recognisable Russian word, or it is the target word in
 *   the wrong form. Both are spelling slips, and the caller should fall through
 *   to its existing feedback.
 */
export function diagnose(typed, ctx = {}) {
  const { targetKey, target, formIndex, byKey } = ctx
  if (!formIndex || !byKey) return null
  const answer = String(target ?? '').trim()
  if (answer.includes(' ')) return diagnosePhrase(typed, answer, ctx)
  return diagnoseWord(typed, answer, byKey.get(targetKey) ?? null, ctx)
}

function diagnoseWord(typed, targetForm, want, { formIndex, byKey }) {
  const word = String(typed ?? '').trim()
  if (!word || !normToken(word)) return null
  const entry = lookup(formIndex, word)
  if (!entry) return null
  let best = null
  for (const sense of entry.senses ?? []) {
    const verdict = verdictFor(sense, want, word, targetForm, byKey)
    // The letters are a form of the target word itself. That reading outranks
    // any homograph sharing the spelling — «чай» in «В ча́е…» is tea in the
    // wrong case, not the folksy particle — so say nothing and let the drill's
    // error map show the ending that slipped.
    if (verdict === SAME_WORD) return null
    if (verdict && (!best || rank(verdict.type) < rank(best.type))) best = verdict
  }
  if (best) best.why = whyDiffers(best, want)
  return best
}

/**
 * For a phrase, diagnose the one token that differs. Alignment has to be
 * unambiguous — same token count, exactly one mismatch — or we are guessing
 * which word the learner meant, and today's whole-phrase feedback is the honest
 * answer.
 */
function diagnosePhrase(typed, target, ctx) {
  const got = String(typed ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const wanted = target.split(/\s+/).filter(Boolean)
  if (got.length !== wanted.length) return null
  const differing = wanted.map((_, i) => i).filter((i) => normToken(got[i]) !== normToken(wanted[i]))
  if (differing.length !== 1) return null
  const at = differing[0]
  // The wanted word for *this slot* is whatever entry the target token belongs
  // to, which is only the exercise's own target when the slip is on that word.
  const entry = lookup(ctx.formIndex, wanted[at])
  const wantKey = entry?.senses?.[0]?.key ?? ctx.targetKey
  return diagnoseWord(got[at], wanted[at], ctx.byKey.get(wantKey) ?? null, ctx)
}

/**
 * Build the gloss → keys lookup the English direction needs, from the flashcard
 * drill's own autocomplete pool (`buildOptionPool`, exerciseBuild.js). Both the
 * bare gloss and the disambiguated label ("hat (winter)") are indexed, so a
 * learner who types either is understood.
 *
 * @param {Array<{key: string, en: string, label: string}>} pool
 * @returns {Map<string, string[]>}
 */
export function buildGlossIndex(pool) {
  const index = new Map()
  const add = (text, key) => {
    const gloss = normalizeGloss(text)
    if (!gloss) return
    if (!index.has(gloss)) index.set(gloss, [])
    const keys = index.get(gloss)
    if (!keys.includes(key)) keys.push(key)
  }
  for (const item of pool ?? []) {
    if (!item?.key) continue
    add(item.en, item.key)
    add(item.label, item.key)
  }
  return index
}

/** Fold an English gloss for lookup: case, articles, punctuation and spacing. */
function normalizeGloss(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s()]/gu, ' ')
    .replace(/\b(a|an|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Diagnose a wrong answer in the *English* direction: the learner saw a Russian
 * word and typed an English gloss that wasn't the one wanted. Which word were
 * they describing, and how does it relate to the one on screen?
 *
 * The mirror of {@link diagnose}, sharing its ranking: shown «одева́ться» and
 * told *to put on*, the drill can say that belongs to «надева́ть» rather than
 * simply failing the card.
 *
 * @param {string} typed the English the learner gave
 * @param {object} ctx
 * @param {string} ctx.targetKey natural key of the word on the card
 * @param {Map} ctx.byKey key → word record
 * @param {Map} ctx.glossIndex from {@link buildGlossIndex}
 * @returns {object|null} a verdict tagged `direction: 'en'`, or null when the
 *   gloss belongs to no word we know — an ordinary blank, which the drill
 *   handles by revealing as it always has.
 */
export function diagnoseEnglish(typed, ctx = {}) {
  const { targetKey, byKey, glossIndex } = ctx
  if (!byKey || !glossIndex) return null
  const want = byKey.get(targetKey) ?? null
  if (!want) return null
  const keys = glossIndex.get(normalizeGloss(typed)) ?? []
  let best = null
  for (const key of keys) {
    // Their own word: they gave a gloss this very entry carries, so the drill
    // either accepted it or is asking for a different shown form. Nothing to say.
    if (key === want.key) return null
    const got = byKey.get(key)
    if (!got) continue
    const verdict = relate(got, facts(got, null, typed), want)
    if (verdict && (!best || rank(verdict.type) < rank(best.type))) best = verdict
  }
  if (!best) return null
  best.direction = 'en'
  best.why = whyDiffers(best, want)
  return best
}

/**
 * The sentence explaining the difference, drawn from what the corpus already
 * says (`confusionNote`, #585) — but never at the cost of giving the answer
 * away. A note contrast names both words, and an authored `why` may too, so
 * anything spelling out the target is dropped: the learner is still trying.
 */
function whyDiffers(verdict, want) {
  if (!want) return ''
  const { text } = confusionNote(want, {
    ru: verdict.typed.ru,
    en: verdict.typed.en,
    note: verdict.typed.note,
    why: verdict.why ?? '',
  })
  const target = bare(want.headword || want.ru)
  return text && !bare(text).includes(target) ? text : ''
}

/** Quote a Russian word the way the drills do. */
const q = (value) => `«${value}»`

/** The gloss of the word being asked for, note and all — it is already on the prompt. */
function wantGloss(want) {
  if (!want?.en) return 'a different word'
  return want.note ? `${want.en} (${want.note})` : want.en
}

/** A word as the flashcard names it: its gloss, with the note that disambiguates. */
function labelled(word) {
  return word.note ? `${word.en} (${word.note})` : word.en
}

/**
 * The English direction's wording. The learner saw the Russian and produced an
 * English gloss, so the headline names the word they actually described —
 * safely, since it is not the answer — and the detail says how it relates to the
 * word on screen. The *English* is the answer here, so no message may state it.
 */
function englishMessage(verdict) {
  const { typed } = verdict
  const headline = `${q(typed.ru)} is “${labelled(typed)}”`
  const ask = 'I want the English for the word on screen.'
  switch (verdict.type) {
    case 'aspect': {
      const label = verdict.dimension === 'motion' ? MOTION_LABEL : ASPECT_LABEL
      const sense =
        verdict.dimension === 'motion'
          ? aspectSense(null, verdict.gotGrade)
          : aspectSense(verdict.gotGrade)
      return {
        headline,
        detail: `That is this word's ${label[verdict.gotGrade] ?? 'other'} partner — ${sense}. ${ask}`,
        tier: 'lexical',
      }
    }
    case 'heteronym':
      return {
        headline,
        detail: `Same letters, but the stress is elsewhere. ${ask}`,
        tier: 'lexical',
      }
    case 'homograph':
      return {
        headline,
        detail: `Spelled the same, stress and all — but it is a different word. ${ask}`,
        tier: 'lexical',
      }
    case 'synonym':
      return {
        headline,
        detail: `That means the same thing — but I want this word's own English.`,
        tier: 'synonym',
      }
    case 'wrong-sense':
      return {
        headline,
        detail: `Right English word, wrong sense — that one is a different Russian word. ${ask}`,
        tier: 'lexical',
      }
    case 'confusable':
      return {
        headline,
        detail: verdict.why ? `${verdict.why} ${ask}` : `Easily mixed up with this one. ${ask}`,
        tier: 'lexical',
      }
    default:
      return { headline, detail: `That is a different word. ${ask}`, tier: 'lexical' }
  }
}

/**
 * Turn a verdict into the three strings a component renders — no string building
 * in the template, and the wording is unit-testable on its own.
 *
 * **The answer is never spelled out.** The learner is mid-attempt, so a message
 * may quote what *they* wrote and may restate the gloss (which the prompt is
 * already showing), but never the Russian being asked for. That is what the
 * "Show me the answer" button is for.
 *
 * @param {object|null} verdict from {@link diagnose}
 * @returns {{headline: string, detail: string, tier: string}|null}
 */
export function correctionMessage(verdict) {
  if (!verdict) return null
  if (verdict.direction === 'en') return englishMessage(verdict)
  const { typed, want } = verdict
  switch (verdict.type) {
    case 'wrong-form':
      return {
        // Their own spelling, never the lemma — the lemma is the answer.
        headline: `Right word — ${q(typed.form || typed.ru)} is a form of it`,
        detail: 'I want the dictionary form.',
        tier: 'lexical',
      }
    case 'aspect': {
      const label = verdict.dimension === 'motion' ? MOTION_LABEL : ASPECT_LABEL
      const gotSense =
        verdict.dimension === 'motion'
          ? aspectSense(null, verdict.gotGrade)
          : aspectSense(verdict.gotGrade)
      const wantSense =
        verdict.dimension === 'motion'
          ? aspectSense(null, verdict.wantGrade)
          : aspectSense(verdict.wantGrade)
      return {
        headline: `${q(typed.ru)} is the ${label[verdict.gotGrade] ?? 'other one'} — ${gotSense}`,
        detail: `I want the ${label[verdict.wantGrade] ?? 'other'}: ${wantSense}.`,
        tier: 'lexical',
      }
    }
    case 'heteronym':
      return {
        headline: `${q(typed.ru)} is ${typed.en}`,
        detail: 'Same letters — but the stress falls elsewhere in the word I want.',
        tier: 'lexical',
      }
    case 'homograph':
      return {
        // Never "move the stress": these two are spelled identically, so there
        // is nothing the learner could retype to fix it (#641).
        headline: `${q(typed.ru)} is ${typed.en}`,
        detail: `Spelled the same, but a different word — I want ${wantGloss(want)}.`,
        tier: 'lexical',
      }
    case 'wrong-sense':
      return {
        // Same English, different sense — and the notes exist to say which.
        headline: `${q(typed.ru)} is ${typed.note ? `${typed.en} (${typed.note})` : typed.en}`,
        detail: `Right word, wrong sense — I want ${wantGloss(want)}.`,
        tier: 'lexical',
      }
    case 'synonym':
      return {
        headline: `${q(typed.ru)} does mean ${want.en}`,
        detail: 'Good — but I’m after a different word here.',
        tier: 'synonym',
      }
    case 'confusable':
      return {
        headline: `${q(typed.ru)} is ${typed.en}`,
        detail: verdict.why || `I want ${wantGloss(want)}.`,
        tier: 'lexical',
      }
    default:
      return {
        headline: `${q(typed.ru)} means ${typed.en}`,
        detail: verdict.why || `I want ${wantGloss(want)}.`,
        tier: 'lexical',
      }
  }
}
