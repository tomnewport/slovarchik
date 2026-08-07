// Degree-coverage oracle: stored comparatives that no drill can reach (#536).
//
// The corpus stores a `forms.comparative` on 180-odd adjectives and adverbs —
// carefully stressed, irregulars and all. A stored form only becomes something
// the learner is ever asked to *produce* when some usage example annotates it
// (`inflect: { degree: comparative }`); without that it is inert data, visible
// only as a phrase hint. This module enumerates the inert ones so a test can
// keep data and drills from drifting apart again.
//
// Pure and framework-free, like the other corpus oracles.
import { shapeContextPhrases } from './vocabBuild.js'

/** Every learnable word that stores a comparative, as `{ key, form }`. */
export function storedComparatives(words) {
  return (words ?? [])
    .filter((w) => w.learnable !== false && w.extra?.forms?.comparative)
    .map((w) => ({ key: w.key, form: w.extra.forms.comparative }))
}

/**
 * Stored comparatives that no `degree: comparative` annotation teaches — the
 * holes this guard exists to keep at zero.
 *
 * The annotation has to sit on the word's OWN usage example: a context phrase's
 * target is its owner, so a sentence that merely contains бо́льше teaches
 * whichever word authored it, not большо́й.
 *
 * @param {object[]} words normalised word records (from buildWords)
 * @returns {{key: string, form: string}[]} busiest-first is meaningless here, so
 *   the order is the word list's own
 */
export function unreachableComparatives(words) {
  const taught = new Set(
    shapeContextPhrases(words)
      .filter((p) => p.target?.degree === 'comparative')
      .map((p) => p.target.key),
  )
  return storedComparatives(words).filter((c) => !taught.has(c.key))
}
