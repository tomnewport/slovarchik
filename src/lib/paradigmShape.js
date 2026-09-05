// Why an inflection table is the shape it is.
//
// `buildParadigm` prunes every empty row and column, so a verb whose paradigm
// the language itself leaves gappy arrives at the drill looking *wrong*: a
// perfective has no Present column, нача́ться has no «я / ты» rows, повезти́ is
// two cells. A learner meeting that has no way to tell a fact of Russian from a
// hole in the app's data, so this module says which it is, in a sentence, next
// to the table.
//
// Everything here is derived from the shape of the table plus the aspect the
// corpus already stores — nothing new to author, and a table that fills in
// later stops explaining itself automatically. That derivation has one blind
// spot it cannot close on its own: it sees *that* a row is absent, never *why*.
// Absence is only good evidence where the corpus is complete, which is why the
// rules below fire on the person axis (every verb stores its whole
// present/future — `defective:` in public/vocab/CONTRIBUTING.md is how a gap is
// declared deliberate) and never on the imperative, which under half the verbs
// carry. Where the derived reason would be right about the shape and wrong
// about the cause — говори́ться is third-person because it is a passive, not
// because lessons can't speak — an authored `paradigm_note:` on the word
// replaces it.
//
// Verbs only, and only their primary table: the participle and short-passive
// variants are gappy for their own reasons (aspect decides which participles
// exist at all), which is a separate explanation this doesn't attempt.

import { normalize } from './text.js'

/** Person rows whose absence makes a finite table "third person only". */
const PERSONAL_ROWS = new Set(['1sg', '2sg', '1pl', '2pl'])

const cellsIn = (paradigm, col) => paradigm.cells.filter((c) => c.col === col)

/**
 * Why this table has no present tense: it belongs to a perfective verb, whose
 * person forms *are* the future. Named after the column the reader is looking
 * at ("Simple Future" where every other verb says "Present").
 */
function futureNote(word) {
  const partner = word.aspectPair?.aspect === 'impf' ? word.aspectPair : null
  const text =
    'No present tense: a perfective verb frames the action as one finished whole, and ' +
    'nothing finished is going on right now — so these person forms are its simple future.' +
    (partner ? ' For what is happening now, use the imperfective partner:' : '')
  return { key: 'no-present', text, ru: partner?.ru ?? null }
}

/**
 * Why the person rows are missing (or all the same). One note at most, from the
 * strongest evidence available:
 *
 *  - every person cell holds one form (хо́чется) → the verb doesn't mark person;
 *  - a lone 3sg over a neuter-only past (повезёт / повезло́) → the signature of
 *    an impersonal verb: no subject at all, a dative experiencer;
 *  - no 1st/2nd person at all (начнётся / начну́тся) → a verb whose subject is a
 *    thing or an event.
 *
 * The dative in the middle case is inferred from that signature rather than
 * from an authored government frame; `paradigm_note:` overrides the whole note
 * for a verb it reads wrong.
 */
function personNote(finite, past) {
  if (!finite.length) return null
  const rows = new Set(finite.map((c) => c.row))
  const forms = new Set(finite.map((c) => normalize(c.form)))
  if (rows.size > 1 && forms.size === 1) {
    return {
      key: 'invariant-person',
      text:
        'One form for every person: this verb is impersonal, so the person is carried by a ' +
        'dative pronoun beside it rather than by the ending — which is why every cell of the ' +
        'column holds the same form.',
      ru: `мне ${finite[0].form}`,
    }
  }
  if ([...rows].some((r) => PERSONAL_ROWS.has(r))) return null

  const pastRows = new Set(past.map((c) => c.row))
  const neuterPastOnly = past.length > 0 && pastRows.size === 1 && pastRows.has('past_n')
  if (rows.size === 1 && rows.has('3sg') && neuterPastOnly) {
    return {
      key: 'impersonal',
      text:
        'Impersonal: there is no subject at all, so the only forms that exist are a ' +
        'third-person singular and a neuter past. The person it happens to goes in the dative:',
      ru: `мне ${past[0].form}`,
    }
  }
  const noGenderedPast = past.length > 0 && !pastRows.has('past_m') && !pastRows.has('past_f')
  return {
    key: 'third-person',
    text:
      'Third person only: what this verb describes happens to a thing or an event rather ' +
      'than to a person, so «я …» and «ты …» forms are not used.' +
      (noGenderedPast ? ' In the past it agrees as a neuter or a plural, never as a он or a она́.' : '') +
      ' The rows are missing from the language, not from the app.',
    ru: null,
  }
}

/**
 * The notes explaining one paradigm's shape — possibly none, at most one per
 * axis (tense, then person). Each is `{ key, text, ru }`, where `ru` is an
 * optional Russian illustration to render in its own `lang="ru"` span.
 * @param {object|null} paradigm from buildParadigm()
 * @returns {{key: string, text: string, ru: string|null}[]}
 */
export function paradigmNotes(paradigm) {
  if (!paradigm || paradigm.pos !== 'verb' || paradigm.variant) return []
  const word = paradigm.word ?? {}
  const conj = word.extra?.conjugation ?? {}
  const finite = cellsIn(paradigm, 'finite')
  const notes = []
  if (finite.length && !conj.present && conj.future) notes.push(futureNote(word))
  const authored = word.extra?.paradigm_note
  const person = authored
    ? { key: 'authored', text: String(authored).trim(), ru: null }
    : personNote(finite, cellsIn(paradigm, 'past'))
  if (person) notes.push(person)
  return notes
}
