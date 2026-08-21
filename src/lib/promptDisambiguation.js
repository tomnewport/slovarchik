// Which English prompts cannot be answered, and what the corpus already knows
// that would fix them.
//
// The phrase drill runs both ways. Russian→English is safe: the learner sees the
// Russian, so nothing is hidden. English→Russian is not, because English
// collapses distinctions Russian keeps, and the corpus deliberately teaches
// synonyms. Asked to render "A stain appeared on the trousers", a learner has no
// way to know whether the answer wants брю́ки or штаны́ — both sentences exist,
// both are correct, and only one is accepted. That is a hard fail on a question
// with no answer.
//
// `phraseAmbiguity.js` already solves one slice of this: it reads the *Russian*
// for ты/вы and gender commitments and annotates the ambiguous English word in
// place. It cannot help here, because nothing in «На штана́х появи́лось пятно́»
// marks register — the distinction lives in the choice of noun, not in its form.
//
// What does distinguish them is already written down, one level up. The headword
// glosses carry exactly the note needed:
//
//   брю́ки   trousers (the standard word)
//   штаны́   trousers (the informal word)
//   врач     doctor (a medical professional)
//   до́ктор   doctor (a medical doctor, polite term of address)
//
// So for most collisions this is plumbing rather than authoring: surface the
// owning word's existing note under the prompt when — and only when — the prompt
// is otherwise unanswerable. A note that is shown on every prompt is noise; one
// shown only where two readings genuinely compete is the missing information.
//
// What is left over after that is the real backlog: pairs whose owning words
// have no distinguishing note, or the same one. `ambiguousPrompts` returns those
// so CI can hold the line (see scripts/check-prompt-ambiguity.mjs).
import { buildFormIndex, normToken, normTokenStress } from './phraseHint.js'

/** Prompts are grouped on the exact English a learner is shown. */
const normalise = (en) => String(en ?? '').trim()

/**
 * Group phrases by the English prompt they present, keeping only the groups
 * where that prompt maps to more than one distinct Russian sentence. A group of
 * one, or several rows repeating the same Russian, asks nothing ambiguous.
 *
 * @param {object[]} phrases shaped phrases (from shapePhrases)
 * @returns {Array<{en: string, phrases: object[]}>}
 */
export function collidingPrompts(phrases) {
  const byEn = new Map()
  for (const p of phrases ?? []) {
    const en = normalise(p?.en)
    if (!en) continue
    if (!byEn.has(en)) byEn.set(en, [])
    byEn.get(en).push(p)
  }
  const out = []
  for (const [en, group] of byEn) {
    if (new Set(group.map((p) => String(p?.ru ?? '').trim())).size > 1) out.push({ en, phrases: group })
  }
  return out
}

/**
 * Whether the in-place ты/вы and gender annotations already tell the members of
 * a group apart. They do only when every member carries a *different* and
 * non-empty set of notes: if two of them render identically the learner is still
 * choosing blind, and if one carries nothing it is the unmarked default with
 * nothing to mark it.
 */
export function separatedByNotes(group) {
  const ids = (group ?? []).map((p) => [...(p?.enNotes ?? [])].sort().join('+'))
  return ids.length > 1 && !ids.includes('') && new Set(ids).size === ids.length
}

/**
 * Stress-blind tokens — what two sentences are compared on. `normToken` is the
 * corpus's own normaliser and is used rather than a local one: stripping the
 * acute by hand off NFD text orphans the combining breve in «й» and the
 * diaeresis in «ё», which silently splits «кра́йне» into "краи" and "не" and
 * then hints with the wrong word entirely.
 */
function bareTokens(ru) {
  return String(ru ?? '').split(/\s+/).map(normToken).filter(Boolean)
}

/**
 * The tokens that set one member of a group apart from the others.
 *
 * It is tempting to hint with the sentence's *owning* word — the word whose
 * usage list it sits in — but that is usually the wrong word. «Я жду авто́буса»
 * is owned by авто́бус and «Я жду авто́бус» by ждать, while what actually differs
 * between them is the case of авто́бус; hinting "bus" against "to wait" describes
 * neither sentence. So the group is diffed, and only what is unique to a member
 * can explain why that member is the answer.
 */
export function distinguishingTokens(phrase, group) {
  const mine = bareTokens(phrase?.ru)
  const others = (group ?? []).filter((p) => p !== phrase).map((p) => new Set(bareTokens(p?.ru)))
  if (!others.length) return []
  return [...new Set(mine.filter((t) => others.every((o) => !o.has(t))))]
}

/**
 * Parts of speech that cannot carry the distinction on their own. «Нам
 * предстои́т до́лгий путь» differs from its rival by both «нам» and «предстои́т»,
 * and glossing the pronoun ("we: the speaker and others") explains nothing about
 * why this sentence is the answer. Content words are tried first, and a function
 * word is used only when nothing else is available.
 */
const FUNCTION_WORDS = new Set(['preposition', 'conjunction', 'pronoun', 'particle', 'interjection'])

/**
 * Function words the corpus files under a content part of speech, so `pos`
 * alone does not catch them — «не» is an adverb here, and hinting "not:
 * negation particle" for «Я не име́ю поня́тия» against «У меня́ нет
 * представле́ния» says nothing, since both sentences are negative. A closed
 * class, listed by key so a homograph cannot widen it.
 */
const FUNCTION_KEYS = new Set(['не=not', 'нет=no', 'бы=would', 'ли=whether', 'же=indeed', 'уж=already'])

/**
 * The hint for one phrase: how the corpus glosses the word that makes this
 * sentence the answer rather than its rival.
 *
 * `meaning` alone will not do when the rivals are synonyms — that is what they
 * share, and why they collide — so a word with no distinguishing note cannot be
 * told apart this way and yields nothing.
 *
 * @param {object} phrase   the phrase to hint
 * @param {object[]} group  every phrase sharing its English prompt
 * @param {(token: string) => object|undefined} resolve  surface form → word record
 */
export function hintFor(phrase, group, resolve) {
  const candidates = distinguishingTokens(phrase, group)
    .map((token) => resolve?.(token))
    .filter((w) => String(w?.meaningNote ?? w?.note ?? '').trim())
  const word = candidates.find((w) => !FUNCTION_WORDS.has(w?.pos) && !FUNCTION_KEYS.has(w?.key))
  if (!word) return ''
  const note = String(word.meaningNote ?? word.note ?? '').trim()
  const meaning = String(word.meaning ?? '').trim()
  return meaning ? `${meaning}: ${note}` : note
}

/**
 * Surface form → the word record that owns it. `buildFormIndex` maps a form to
 * its word's *key* and headline gloss but not to the note, which is the half
 * that distinguishes, so the two have to be joined.
 */
function resolver(words, formIndex) {
  const byKey = new Map((words ?? []).map((w) => [w.key, w]))
  const index = formIndex ?? buildFormIndex(words ?? [])
  return (token) => {
    const entry = index?.get?.(token)
    // A form several words share proves nothing about which one is meant.
    if (!entry || (entry.senses ?? []).length > 1) return undefined
    return byKey.get(entry.key)
  }
}

/**
 * Disambiguating hints for every prompt that needs one, keyed by phrase id.
 *
 * A hint is only issued when it actually resolves the choice: every member of
 * the group must get a hint, and the hints must differ. Issuing one to some
 * members and not others would imply the unhinted sentence is the default, which
 * the corpus does not say; issuing identical hints would add words without
 * adding information.
 *
 * @param {object[]} phrases shaped phrases
 * @param {object[]} words   shaped words (for their glosses)
 * @returns {Map<string, string>} phrase id → hint
 */
export function promptHints(phrases, words, formIndex) {
  const resolve = resolver(words, formIndex)
  const hints = new Map()
  for (const { phrases: group } of collidingPrompts(phrases)) {
    if (separatedByNotes(group)) continue
    const proposed = group.map((p) => hintFor(p, group, resolve))
    if (proposed.some((h) => !h)) continue
    if (new Set(proposed).size !== proposed.length) continue
    group.forEach((p, i) => hints.set(p.id, proposed[i]))
  }
  return hints
}

/**
 * The prompts still unanswerable after hinting — the backlog, and what CI holds
 * the line on. Each entry says why it could not be resolved, because the three
 * causes need different fixes: a missing note is authoring, identical notes mean
 * the two words are not actually being taught apart, and an aspect pair needs a
 * cue the gloss cannot carry.
 *
 * @returns {Array<{en: string, why: string, members: Array<{ru: string, source: string, hint: string}>}>}
 */
export function ambiguousPrompts(phrases, words, formIndex) {
  const resolve = resolver(words, formIndex)
  const out = []
  for (const { en, phrases: group } of collidingPrompts(phrases)) {
    if (separatedByNotes(group)) continue
    const proposed = group.map((p) => hintFor(p, group, resolve))
    if (!proposed.some((h) => !h) && new Set(proposed).size === proposed.length) continue

    // Same letters, different stress: two spellings of one sentence, which is a
    // data defect rather than a choice the learner could be helped to make.
    const bare = (s) => String(s).split(/\s+/).map(normToken).join(' ')
    const stressed = (s) => String(s).split(/\s+/).map(normTokenStress).join(' ')
    const why = new Set(group.map((p) => bare(p.ru))).size < group.length
      && new Set(group.map((p) => stressed(p.ru))).size === group.length
      ? 'the same sentence stressed two different ways — a data defect, not an ambiguity'
      : proposed.every((h) => !h)
        ? 'neither owning word carries a distinguishing note'
        : proposed.some((h) => !h)
          ? 'only some of the owning words carry a note'
          : 'the owning words carry the same note'
    out.push({
      en,
      why,
      members: group.map((p, i) => ({ ru: p.ru, source: p.source, hint: proposed[i] })),
    })
  }
  return out.sort((a, b) => a.en.localeCompare(b.en))
}
