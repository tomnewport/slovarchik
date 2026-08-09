// Participle-coverage oracle: stored non-finite forms no drill can reach (#564).
//
// A direct sibling of degreeCoverage.js, and it exists for the same failure mode
// #536 found for comparatives: a form can be carefully authored, correctly
// stressed and completely inert. Storing a participle puts it on the verb's
// `#nonfinite` paradigm and makes it hintable inside a phrase, but the learner
// is only ever asked to PRODUCE it when some usage example annotates it
// (`inflect: { form: act_pres }`). Without that the corpus has quietly grown a
// form nothing teaches.
//
// This module enumerates those holes so a test can keep the count at zero, and
// the corpus can never again accumulate stored forms no drill reaches.
//
// Pure and framework-free, like the other corpus oracles.
import { shapeContextPhrases } from './vocabBuild.js'
import { FORM_SLOTS, storedSlots } from './participles.js'

/**
 * Every learnable verb's stored non-finite slots, as `{ key, slot }` — one entry
 * per slot, so a verb storing a participle and a gerund contributes two.
 */
export function storedNonFiniteSlots(words) {
  const out = []
  for (const w of words ?? []) {
    if (w.learnable === false || w.pos !== 'verb') continue
    for (const slot of storedSlots(w)) out.push({ key: w.key, slot })
  }
  return out
}

/**
 * Which `<key>#<slot>` pairs an `inflect: { form: … }` annotation teaches.
 *
 * The annotation has to sit on the verb's OWN usage example: a context phrase's
 * target is its owner, so a sentence that merely contains поду́мав teaches
 * whichever word authored it, not поду́мать.
 */
function taughtSlots(words) {
  return new Set(
    shapeContextPhrases(words)
      .filter((p) => FORM_SLOTS.includes(p.target?.form))
      .map((p) => `${p.target.key}#${p.target.form}`),
  )
}

/**
 * Stored participles/gerunds that no `form:` annotation teaches — the holes this
 * guard exists to keep at zero.
 *
 * @param {object[]} words normalised word records (from buildWords)
 * @returns {{key: string, slot: string}[]} in the word list's own order
 */
export function unreachableNonFiniteForms(words) {
  const taught = taughtSlots(words)
  return storedNonFiniteSlots(words).filter((s) => !taught.has(`${s.key}#${s.slot}`))
}

/**
 * The mirror hole: a `form:` annotation whose verb stores nothing for that slot,
 * so the drill has no answer to grade against. `phrasesData.test.js` catches
 * this too (via `storedForm`), but reporting it here keeps the two halves of the
 * participle contract — stored and taught — in one place.
 *
 * @returns {{key: string, slot: string, id: string}[]}
 */
export function untaughtFormAnnotations(words) {
  const stored = new Set(storedNonFiniteSlots(words).map((s) => `${s.key}#${s.slot}`))
  return shapeContextPhrases(words)
    .filter((p) => FORM_SLOTS.includes(p.target?.form))
    .filter((p) => !stored.has(`${p.target.key}#${p.target.form}`))
    .map((p) => ({ key: p.target.key, slot: p.target.form, id: p.id }))
}
