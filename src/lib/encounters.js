// What a correctly-answered exercise proves the learner has *met* — as opposed
// to what it grades (#675).
//
// A drill assesses one word, but the learner reads, types or hears a whole
// sentence around it. Those other words are met long before the curriculum
// formally teaches them, and that head start is worth showing: the CEFR bars
// report encountered → learned → mastered rather than pretending a word first
// exists the day its batch comes up.
//
// The bar for an encounter is deliberately higher than "it was on screen". The
// learner had to get it right, unaided — so every route by which the app could
// have handed them the word disqualifies the exercise:
//
//   * the keyboard hint (already reported as the absence of `double`);
//   * the ❓ Dictionary panel, which glosses precisely the unlearned words of
//     the phrase — that is, exactly the encounter candidates;
//   * the inline glosses under a word-bank cue, which are not opt-in at all,
//     so only the audio variant of that drill can prove anything.
//
// The spoken drills are deliberately not a source. Their grade comes from the
// Web Speech API, which is language-model-assisted: it will happily return the
// sentence it expected from half-mumbled input, so a "correct" there is much
// weaker evidence than a typed one. Crediting it would overstate the bars in
// exactly the direction that flatters, which is the wrong way to be wrong.
//
// Pure and framework-free: no Vue, no store, no I/O.

import { alignPhraseTokens } from './phraseAlign.js'

/**
 * Does this exercise result prove the learner met the words of its phrase?
 *
 * Word-level exercises are excluded, not because they prove nothing but because
 * what they prove is the target word, which the attempt itself already records.
 * This is only about the words around it.
 *
 * @param {{content?: string, kind?: string, ru?: string, audio?: boolean}} ex
 *   the exercise descriptor
 * @param {{correct?: boolean, double?: boolean, dictUsed?: boolean}} result
 *   what the exercise component reported
 * @returns {boolean}
 */
export function phraseProvesEncounter(ex, result) {
  if (!ex || ex.content !== 'phrase' || !ex.ru) return false
  if (result?.correct !== true) return false
  switch (ex.kind) {
    // Typed the whole sentence out. `double` is first-try-correct with the
    // keyboard hint untouched, which is the unaided-recall signal the scheduler
    // already trusts (#210, #313); the Dictionary is checked separately because
    // it costs no points and so does not show up in `double`.
    case 'type':
      return result.double === true && !result.dictUsed
    // Assembled the translation of a sentence. Only worth anything when the cue
    // was audio: the visual cue renders through HintablePhrase in `inline` mode,
    // which glosses every unlearned word whether the learner wanted it or not.
    case 'wordbank':
      return ex.audio === true
    default:
      return false
  }
}

/**
 * The learnable word keys a phrase proves met, resolved through word alignment
 * (lib/phraseAlign.js).
 *
 * This used to read the hint index directly and skip any token carrying more
 * than one sense, on the reasoning that crediting the wrong homograph overstates
 * what the learner has seen. The reasoning was right; the rule was far too
 * blunt. Most multi-sense tokens are not homographs at all — «купи́=buy» is a
 * gloss-only stub of «купи́ть=to buy», and skipping it meant a learner who read
 * «Купи́ ребёнку а́тлас» was credited with neither. Measured over the corpus,
 * 5.4% of phrase tokens are contested and the old rule threw away every one.
 *
 * Alignment answers the sharper question. Where a rung settles a token, its
 * `credit` list says which curriculum words the token is evidence for — one
 * key where something decided, every member where a group collapsed, because
 * «гро́мче» is the comparative of гро́мкий and гро́мко alike and a learner who
 * read it has met both. Where nothing settles it the token is still skipped,
 * exactly as before: being a word short remains the cheaper error for a soft
 * signal, and what is skipped is the worklist `npm run check:align` prints.
 *
 * @param {string} phrase
 * @param {import('./phraseHint.js').FormIndex} index from `buildFormIndex`
 * @param {(key: string) => boolean} [isLearnable] gate for gloss-only entries,
 *   which are not part of the curriculum and are absent from the CEFR bars
 * @param {object} [opts] alignment inputs — `byKey`, the phrase's `en`, its
 *   authored `align` block and `inflectToken`/`inflectKey` (see
 *   {@link import('./phraseAlign.js').alignPhraseTokens})
 * @returns {string[]} distinct keys, in the order they appear in the phrase
 */
export function encounteredKeys(phrase, index, isLearnable = () => true, opts = {}) {
  if (!phrase || !index) return []
  const keys = new Set()
  for (const { alignment } of alignPhraseTokens(phrase, index, opts)) {
    for (const key of alignment?.credit ?? []) {
      if (isLearnable(key)) keys.add(key)
    }
  }
  return [...keys]
}
