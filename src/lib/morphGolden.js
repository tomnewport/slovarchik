// Curated morphology oracle data (issue #446).
//
// This is the hand-authored half of the oracle in morphOracle.js: a small,
// deliberately-curated table of correct and defective forms for the entries
// that ordinary structural tests can't judge — irregular, defective,
// impersonal, mobile-stress and special-ending paradigms. It is seeded from
// concrete corrections (the `случай`/`некий`/`комментарий`/`задать`/`осветить`/
// `рассмеяться`/`убедиться` defects) so those exact bugs can never silently
// return.
//
// ─── How to review and allowlist a disagreement ─────────────────────────────
// The oracle is meant to stay high-signal: a green run must mean "no known-bad
// forms", not "noise we've learned to ignore". When a check fires:
//
//   • It's a real data bug → fix the vocab YAML. That's the common case; the
//     oracle exists to make this the path of least resistance.
//   • The form is a legitimate accepted variant (both spellings are correct
//     Russian, e.g. маха́ю / машу́) → list every accepted form for that cell as
//     an array in `GOLDEN`. The stored cell must match *one* of them.
//   • The word is genuinely impersonal and every person cell holds the single
//     impersonal form on purpose (хотеться) → add its key to `IMPERSONAL_VERBS`
//     so the person-duplicate check skips it.
//   • A slot truly doesn't exist in the language (defective paradigm) → list it
//     in `DEFECTIVE`; the check then fails if the slot is *filled*, not empty.
//
// Never silence a finding by loosening a check globally — narrow it to the one
// key/cell here, with a comment saying why, so the next reader can audit it.
//
// Comparison is stress-insensitive but ё-sensitive (see morphOracle.js): pin
// the correct letters and ё here; stress placement is proof-read separately by
// stressAudit.js. Golden forms are still written with their stress mark for
// legibility and so they double as copy-paste-ready corrections.

/**
 * key → { slot → accepted form | [accepted forms] }.
 *
 * Declension slots use the flat cell keys (`sg_pre`, `m_gen`, …); conjugation
 * slots use a dotted `block.person` path (`future.1pl`, `present.1sg`).
 */
export const GOLDEN = {
  // -ий masculine nouns take prepositional -ии, never -ие (the "-ие" cell is
  // the impossible one CI kept missing).
  'комментарий=comment': {
    sg_pre: 'коммента́рии',
  },

  // й-stem masculine noun: every oblique ending softens (й+vowel → я/ю/е/и), so
  // the whole soft paradigm is pinned as the regression baseline for the
  // `слу́чайа`-class orthography bug.
  'случай=case': {
    sg_gen: 'слу́чая',
    sg_dat: 'слу́чаю',
    sg_ins: 'слу́чаем',
    sg_pre: 'слу́чае',
    pl_nom: 'слу́чаи',
    pl_gen: 'слу́чаев',
    pl_dat: 'слу́чаям',
    pl_acc: 'слу́чаи',
    pl_ins: 'слу́чаями',
    pl_pre: 'слу́чаях',
  },

  // Pronominal adjective: the masc/neut oblique stem is неко-ег-/неко-ем-, not
  // неко-. `не́кого`/`не́кому`/`не́ком` belong to the negative pronoun не́кто —
  // storing them here is a homonym confusion.
  'некий=certain': {
    m_gen: 'не́коего',
    m_dat: 'не́коему',
    m_pre: 'не́коем',
    n_gen: 'не́коего',
    n_dat: 'не́коему',
    n_pre: 'не́коем',
  },

  // Conjugates like дать: 1pl/2pl are задади́м/задади́те, not the stem-clipped
  // *зади́м/*зади́те.
  'задать=to assign': {
    'future.1pl': 'задади́м',
    'future.2pl': 'задади́те',
  },

  // 3pl is осветя́т — a stored `освети́т` is the 3sg copied into the 3pl cell.
  'осветить=to illuminate': {
    'future.3pl': 'осветя́т',
  },

  // 2sg is рассмеёшься — a stored `рассмеётесь` is the 2pl copied into the 2sg
  // cell.
  'рассмеяться=to burst out laughing': {
    'future.2sg': 'рассмеёшься',
  },

  // Accepted-variant example: махать has two standard present paradigms. Either
  // spelling of a person cell is correct, so both are allowed and neither the
  // stored маха́ю nor a future switch to машу́ trips the oracle.
  'махать=to wave': {
    'present.1sg': ['маха́ю', 'машу́'],
  },
}

/**
 * key → conjugation slots that must stay EMPTY. Perfective verbs of the
 * убедить/убедиться/победить class have no standard 1st-person-singular future;
 * a filled cell (`убежду́сь`) is a fabricated form.
 */
export const DEFECTIVE = {
  'убедиться=to make sure': ['future.1sg'],
}

/**
 * Impersonal verbs whose present/future cells are deliberately all the single
 * impersonal form. The person-duplicate check skips these (their "duplicates"
 * are correct, not copy-paste errors).
 */
export const IMPERSONAL_VERBS = ['хотеться=to feel like']

/** The bundle morphOracle.morphologyViolations expects. */
export const MORPH_ORACLE = {
  golden: GOLDEN,
  defective: DEFECTIVE,
  impersonalVerbs: IMPERSONAL_VERBS,
}
