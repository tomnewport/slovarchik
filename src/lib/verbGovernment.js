// Verb government: which case (and, optionally, which preposition) a verb puts
// its object in.
//
// Russian splits into two halves here and the corpus has to model both:
//
//   1. BARE case government — the verb alone forces a non-accusative case on its
//      object: помога́ть + dative, ждать + genitive, горди́ться + instrumental.
//   2. PREPOSITIONAL government — the verb demands a fixed preposition, and that
//      preposition brings its own case: зави́сеть **от** + genitive, наде́яться
//      **на** + accusative, ду́мать **о** + prepositional.
//
// The second half is the one an English gloss actively misleads on: "to depend
// ON" is `от`, not `на`. A frame is authored as `governs:` on the verb —
// `governs: dat` for a bare case, `governs: { prep: от, case: gen }` for a
// prepositional one, or a list when a verb has more than one frame (проси́ть
// де́нег / проси́ть о по́мощи).
//
// This module is the single place that knows the frame vocabulary: which
// frames are legal, which grammar rule teaches each one, how a frame reads on a
// word card, and which surface spellings of a preposition count as the same
// preposition (о / об / обо).
//
// Framework-free and data-free — the corpus is the source of truth, this just
// interprets it.

import { CASE_LABELS } from './declension.js'

/** Cases a verb can govern on a bare (preposition-less) object. */
export const BARE_CASES = Object.freeze(['dat', 'gen', 'ins'])

/** The grammar rule that teaches each bare-case government. */
const BARE_RULES = Object.freeze({
  dat: 'verb-gov-dative',
  gen: 'verb-gov-genitive',
  ins: 'verb-gov-instrumental',
})

/**
 * The prepositions that can head a government frame: canonical spelling → the
 * ASCII slug used in its rule ids, plus every surface spelling that counts as
 * the same preposition. Russian lengthens a one-consonant preposition before an
 * awkward cluster (о → об/обо, в → во, к → ко), and those variants are the same
 * word, so a frame authored as `о` is satisfied by «об исто́рии».
 */
const PREPOSITIONS = Object.freeze({
  о: { slug: 'o', forms: ['о', 'об', 'обо'] },
  на: { slug: 'na', forms: ['на'] },
  от: { slug: 'ot', forms: ['от', 'ото'] },
  к: { slug: 'k', forms: ['к', 'ко'] },
  в: { slug: 'v', forms: ['в', 'во'] },
})

/**
 * The prepositional frames the curriculum teaches, each backed by its own
 * `verb-gov-prep-*` rule in `grammar-rules.yml`. Deliberately a closed list
 * rather than "any preposition × any case": a frame only earns a place here
 * once there is a rule explaining it, so an annotation can never reference a
 * government the app has nothing to say about. Adding a frame means adding its
 * rule in the same edit.
 */
export const PREP_FRAMES = Object.freeze([
  Object.freeze({ prep: 'о', case: 'pre' }),
  Object.freeze({ prep: 'на', case: 'acc' }),
  Object.freeze({ prep: 'от', case: 'gen' }),
  Object.freeze({ prep: 'к', case: 'dat' }),
  Object.freeze({ prep: 'в', case: 'pre' }),
])

/** Every surface spelling of a frame's preposition (о → о / об / обо). */
export function prepositionForms(prep) {
  return PREPOSITIONS[prep]?.forms ?? (prep ? [prep] : [])
}

/**
 * The grammar-rule id that teaches a frame: the three bare-case rules, or
 * `verb-gov-prep-<slug>-<case>` for a prepositional one (verb-gov-prep-ot-gen).
 * Returns null for anything that isn't a taught frame.
 */
export function governmentRuleId(frame) {
  if (!frame?.case) return null
  if (!frame.prep) return BARE_RULES[frame.case] ?? null
  const slug = PREPOSITIONS[frame.prep]?.slug
  if (!slug || !PREP_FRAMES.some((f) => f.prep === frame.prep && f.case === frame.case)) return null
  return `verb-gov-prep-${slug}-${frame.case}`
}

/** Every government rule id the corpus may reference (bare cases + taught frames). */
export const GOVERNMENT_RULES = Object.freeze(
  new Set([...Object.values(BARE_RULES), ...PREP_FRAMES.map(governmentRuleId)]),
)

/** The frame a government rule id stands for, or null if the id isn't one. */
export function frameForRule(ruleId) {
  for (const [c, id] of Object.entries(BARE_RULES)) {
    if (id === ruleId) return { prep: null, case: c }
  }
  return PREP_FRAMES.find((f) => governmentRuleId(f) === ruleId) ?? null
}

/** Whether a value is one of the governments the curriculum teaches. */
export function isValidFrame(frame) {
  return governmentRuleId(frame) != null
}

/** One authored frame → `{ prep, case }`, or null if it isn't shaped like one. */
function toFrame(value) {
  if (typeof value === 'string') {
    const c = value.trim()
    return c ? { prep: null, case: c } : null
  }
  if (value && typeof value === 'object') {
    const c = String(value.case ?? '').trim()
    if (!c) return null
    const prep = String(value.prep ?? '').trim()
    return { prep: prep || null, case: c }
  }
  return null
}

/**
 * Normalise an authored `governs:` value into a list of frames. Accepts the
 * bare-case shorthand (`dat`), a single prepositional frame
 * (`{ prep: от, case: gen }`) and a list mixing the two. Returns null — not an
 * empty array — when the verb governs nothing, so `governs` stays falsy for the
 * overwhelming majority of verbs that take a plain accusative.
 */
export function normalizeGoverns(value) {
  const raw = Array.isArray(value) ? value : [value]
  const frames = raw.map(toFrame).filter(Boolean)
  return frames.length ? frames : null
}

/**
 * How a frame reads next to a headword: `+ dative`, `от + genitive`. Short
 * enough to sit beside the word itself, which is the point — seeing
 * «зави́сеть от + genitive» everywhere the verb appears teaches the frame
 * passively.
 */
export function governmentLabel(frame) {
  if (!frame?.case) return ''
  const c = (CASE_LABELS[frame.case] ?? frame.case).toLowerCase()
  return frame.prep ? `${frame.prep} + ${c}` : `+ ${c}`
}

/** All of a verb's frames rendered as labels, e.g. ["+ genitive", "о + prepositional"]. */
export function governmentLabels(governs) {
  return (governs ?? []).map(governmentLabel).filter(Boolean)
}
