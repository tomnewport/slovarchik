// The non-finite verb forms — причастия (participles) and деепричастия
// (gerunds / verbal adverbs) — and the one place that knows their slot names,
// how each is stored, which aspect may carry it and how its agreement grid is
// derived. See docs/participles-and-gerunds.md for the decisions behind all of
// this; the short version:
//
//   - They are NOT `conjugation:` cells. `conjugation:` is a flat map of finite
//     person cells and three consumers read it that way (paradigm.assemble,
//     morphOracle.conjugationCells, personCellDuplicates — the last would fire
//     on пла́чущий vs пла́кавший). Participles live in a sibling `participles:`
//     block and the gerund in a scalar `gerund:`.
//   - Only the accented nominative is stored. A participle agrees exactly like
//     но́вый, so the other 23 cells are derived (adjectiveDeclension.js) rather
//     than stored — storing them would add ~100 lines per verb for no
//     information. The short passive IS stored per gender, because that is where
//     the stress genuinely moves (при́нятый → принята́).
//   - Every slot is optional and gappy on purpose. An intransitive has no
//     passive; plenty of common imperfectives have no gerund at all (ждать,
//     пить, петь, писа́ть, бежа́ть). Store only what exists, never pad.
//
// Pure and framework-free, like the rest of src/lib.
import { declineAdjective } from './adjectiveDeclension.js'

/** The four participles, in the order the drills offer them. */
export const PARTICIPLE_SLOTS = Object.freeze(['act_pres', 'act_past', 'pass_pres', 'pass_past'])

/** The gender/number cells of the short (predicate) passive. */
export const SHORT_GENDERS = Object.freeze(['m', 'f', 'n', 'pl'])

/**
 * Every value an `inflect: { form: … }` annotation may take: the four long
 * participles, the short passive and the gerund.
 */
export const FORM_SLOTS = Object.freeze([...PARTICIPLE_SLOTS, 'pass_short', 'gerund'])

/** Display names for the non-finite slots. */
export const FORM_LABEL = Object.freeze({
  act_pres: 'Present active participle',
  act_past: 'Past active participle',
  pass_pres: 'Present passive participle',
  pass_past: 'Past passive participle',
  pass_short: 'Short passive participle',
  gerund: 'Gerund',
})

/** One-line usage cue shown beside each option in the "which form?" step. */
export const FORM_HINT = Object.freeze({
  act_pres: '"the one who is …ing" — чита́ющий',
  act_past: '"the one who …ed" — чита́вший',
  pass_pres: '"the one being …ed" — люби́мый',
  pass_past: '"the thing that was …ed" — прочи́танный',
  pass_short: 'the predicate: «Магази́н закры́т»',
  gerund: '"while / having …ed" — чита́я, прочита́в',
})

/**
 * Which aspect may carry which slot (docs/participles-and-gerunds.md,
 * Decision 1). A perfective has no present stem, so it has neither present
 * participle; everything else is legal for both aspects, though several are rare
 * enough on one side that the data test allowlists the exceptions rather than
 * the rule.
 */
export const SLOT_ASPECTS = Object.freeze({
  act_pres: Object.freeze(['impf']),
  act_past: Object.freeze(['impf', 'pf']),
  pass_pres: Object.freeze(['impf']),
  pass_past: Object.freeze(['impf', 'pf']),
  pass_short: Object.freeze(['impf', 'pf']),
  gerund: Object.freeze(['impf', 'pf']),
})

/** The passive slots — the ones a verb with no accusative object cannot have. */
export const PASSIVE_SLOTS = Object.freeze(['pass_pres', 'pass_past', 'pass_short'])

/** Whether a slot is one of the four long (adjectivally declining) participles. */
export function isLongParticiple(slot) {
  return PARTICIPLE_SLOTS.includes(slot)
}

/**
 * The accented nominative stored for a long participle slot, or null.
 * @param {object} word a normalised word record (from buildWords)
 * @param {string} slot one of {@link PARTICIPLE_SLOTS}
 */
export function participleNominative(word, slot) {
  if (!isLongParticiple(slot)) return null
  const value = word?.participles?.[slot]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * The 24-cell agreement grid of a long participle, derived from its stored
 * nominative — `{ m_nom, m_gen, …, pl_pre }`, the same flat shape adjectives
 * store. Null when the verb carries no such participle.
 *
 * Deriving rather than storing is safe here because participial stress is fixed
 * across the long grid: -щий / -вший / -нный / -тый / -мый all keep the stress
 * on the syllable the m-nominative marks. (In the SHORT passive it is mobile,
 * which is exactly why that one is stored per gender instead.)
 */
export function participleGrid(word, slot) {
  const nom = participleNominative(word, slot)
  return nom ? declineAdjective(nom) : null
}

/**
 * Resolve one cell of a participle's grid.
 * @param {object} word
 * @param {string} slot one of {@link PARTICIPLE_SLOTS}
 * @param {{case?: string, gender?: string, animate?: boolean}} at defaults to the
 *   masculine nominative — the participle's own dictionary form
 */
export function participleCell(word, slot, { case: c = 'nom', gender = 'm', animate = false } = {}) {
  const grid = participleGrid(word, slot)
  if (!grid) return null
  // An animate accusative copies the genitive, for the masculine singular and
  // for the plural of every gender — the same rule adjectives follow.
  const animAcc = animate && c === 'acc' && (gender === 'm' || gender === 'pl')
  return grid[animAcc ? `${gender}_gen` : `${gender}_${c}`] ?? null
}

/** The stored short-passive cell for a gender, or null. */
export function shortPassiveCell(word, gender) {
  const value = word?.participles?.pass_short?.[gender]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The stored gerund, or null. */
export function gerundForm(word) {
  const value = word?.gerund
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Which non-finite slots a verb actually stores, in canonical order. The short
 * passive counts as present when it carries at least one gender cell.
 * @returns {string[]} a subset of {@link FORM_SLOTS}
 */
export function storedSlots(word) {
  return FORM_SLOTS.filter((slot) => {
    if (slot === 'gerund') return gerundForm(word) != null
    if (slot === 'pass_short') return SHORT_GENDERS.some((g) => shortPassiveCell(word, g) != null)
    return participleNominative(word, slot) != null
  })
}

/**
 * The non-finite slots a verb could plausibly build, whether or not the corpus
 * stores them: every slot its aspect allows, minus the passives when its
 * government frame leaves no accusative object to promote (помога́ть + dative
 * has no passive — the same rule verbsData.test.js enforces on the corpus).
 *
 * Deliberately distinct from {@link storedSlots}: the corpus stores only the
 * forms its own sentences drill, so "not stored" is not "cannot exist"
 * (услы́шать stores just its gerund, yet услы́шанный is perfectly good Russian).
 * That makes these the fair distractors for the "which form?" step — wrong for
 * the sentence without being impossible for the verb. Empty when the aspect is
 * unknown, since then nothing can be ruled in.
 *
 * @returns {string[]} a subset of {@link FORM_SLOTS}, in canonical order
 */
export function plausibleSlots(word) {
  const aspect = word?.aspect
  const noPassive = !!word?.governs
  return FORM_SLOTS.filter((slot) => {
    if (noPassive && PASSIVE_SLOTS.includes(slot)) return false
    return SLOT_ASPECTS[slot].includes(aspect)
  })
}

/**
 * Every non-finite form a verb stores, flattened for the coverage oracle and the
 * data guards: `{ slot, form }`, with the short passive contributing one entry
 * per gender cell (`pass_short.f`).
 * @returns {{slot: string, form: string}[]}
 */
export function storedNonFiniteForms(word) {
  const out = []
  for (const slot of PARTICIPLE_SLOTS) {
    const form = participleNominative(word, slot)
    if (form) out.push({ slot, form })
  }
  for (const g of SHORT_GENDERS) {
    const form = shortPassiveCell(word, g)
    if (form) out.push({ slot: `pass_short.${g}`, form })
  }
  const gerund = gerundForm(word)
  if (gerund) out.push({ slot: 'gerund', form: gerund })
  return out
}
