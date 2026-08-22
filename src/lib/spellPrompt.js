// What an English→Russian spelling prompt actually shows the learner, in one
// place — so the drills that render it and the CI guard that audits it can
// never drift apart.
//
// The prompt is all the learner gets, so it has to identify exactly one Russian
// word. It didn't: 37 groups of words rendered a byte-identical prompt for two
// different required answers, making the answer a coin flip (#527). Two things
// fix that, and both live here:
//
//  - Verbs show their aspect alongside the part of speech ("verb · perfective").
//    The data already knows it, and for an aspect pair it is the only thing that
//    tells уби́ть from убива́ть. It teaches aspect while it disambiguates.
//  - Genuine synonyms need authored notes that distinguish them; that is a data
//    fix, and {@link duplicateSpellPrompts} is what keeps it done.

import { ASPECT_HINT, ASPECT_LABEL, MOTION_HINT } from './phraseContext.js'

/**
 * The part-of-speech line under a spelling prompt: which kind of word to spell
 * ("cold" the adjective vs the adverb, #503), and — for a verb — which aspect
 * ("verb · perfective", #527).
 */
export function posLabel(pos, aspect) {
  if (!pos) return ''
  const asp = ASPECT_LABEL[aspect]
  return asp ? `${pos} · ${asp}` : pos
}

/**
 * The contrast a verb's aspect (or, for a verb of motion, its directionality)
 * actually draws, in plain English — "a single completed action or its result"
 * rather than the bare label "perfective".
 *
 * {@link posLabel} names the distinction, which is enough to *pick* between two
 * entries on a prompt. Explaining a wrong answer needs the sense: for an
 * identical-gloss pair like сшить/шить the aspect is the only difference there
 * is, so quoting the two glosses would print "to sew" twice. Directionality
 * wins when a word has both, since it is the finer contrast of the two.
 *
 * @param {string} aspect `impf` | `pf`
 * @param {string} [motion] `det` | `indet` for a verb of motion
 * @returns {string} the sense, or '' when the word draws neither contrast
 */
export function aspectSense(aspect, motion) {
  return MOTION_HINT[motion] ?? ASPECT_HINT[aspect] ?? ''
}

/** First accepted English gloss; the shaped `en` may be a list or a string. */
function firstEn(en) {
  return String((Array.isArray(en) ? en[0] : en) ?? '').trim()
}

/**
 * The prompt for one shown surface form: gloss, parenthetical note, and the
 * part-of-speech/aspect line — the three things TypeExercise and the /vocab
 * EN→RU drill render, and nothing else.
 *
 * @param {object} v shaped vocab word (from `shapeVocab`)
 * @param {string} [en] the shown gloss; defaults to the word's first English
 */
export function spellPrompt(v, en = firstEn(v?.en)) {
  const note = String(v?.note ?? '').trim()
  return `${en}${note ? ` (${note})` : ''} — ${posLabel(v?.pos, v?.aspect)}`
}

/**
 * Every prompt a word can render. Usually one, but a noun annotated
 * `display_number: pl`/`mixed` shows its plural gloss (see `vocabDisplay`), so
 * that surface has to be audited too.
 */
export function spellPromptsFor(v) {
  const out = []
  const canPl = (v?.displayNumber === 'pl' || v?.displayNumber === 'mixed') && v?.ruPl && v?.enPl?.length
  if (v?.displayNumber !== 'pl' || !canPl) out.push(spellPrompt(v))
  if (canPl) out.push(spellPrompt(v, firstEn(v.enPl)))
  return [...new Set(out)]
}

/**
 * Find shaped vocab words that render the same spelling prompt as another word —
 * i.e. prompts the learner cannot answer except by guessing. The corpus guard
 * (`spellPromptData.test.js`) requires this to be empty.
 *
 * @param {object[]} vocab shaped vocab (from `shapeVocab`)
 * @returns {Array<{prompt: string, ids: string[]}>} colliding groups, sorted
 */
export function duplicateSpellPrompts(vocab) {
  const byPrompt = new Map()
  for (const v of vocab ?? []) {
    for (const prompt of spellPromptsFor(v)) {
      if (!byPrompt.has(prompt)) byPrompt.set(prompt, new Set())
      byPrompt.get(prompt).add(v.id)
    }
  }
  return [...byPrompt]
    .filter(([, ids]) => ids.size > 1)
    .map(([prompt, ids]) => ({ prompt, ids: [...ids].sort() }))
    .sort((a, b) => a.prompt.localeCompare(b.prompt))
}
