// Curated morphology oracle data (issue #446).
//
// This is the hand-authored half of the oracle in morphOracle.js: a small,
// deliberately-curated table of correct and defective forms for the entries
// that ordinary structural tests can't judge — irregular, defective,
// impersonal, mobile-stress and special-ending paradigms. It is seeded from
// concrete corrections (the `случай`/`некий`/`комментарий`/`задать`/`осветить`/
// `рассмеяться`/`убедиться` defects, plus the #444 verb batch —
// `вздохнуть`/`отдохнуть`/`обмануть`/`рисковать`/`поглядеть`/`совершить`/
// `сообразить`) so those exact bugs can never silently return.
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

  // ─── #448 noun corrections ───────────────────────────────────────────────
  // ё-stem feminine noun: the stressed vowel is ё in every form, never a plain
  // stressed е. The whole paradigm was mechanically written `реше́тк-` while the
  // headword declares `решётка` — this is the required-ё regression guard
  // (comparison here is ё-sensitive, so `реше́тка` fails against `решётка`).
  'решётка=grating': {
    sg_nom: 'решётка',
    sg_gen: 'решётки',
    sg_dat: 'решётке',
    sg_acc: 'решётку',
    sg_ins: 'решёткой',
    sg_pre: 'решётке',
    pl_nom: 'решётки',
    pl_gen: 'решёток',
    pl_dat: 'решёткам',
    pl_acc: 'решётки',
    pl_ins: 'решётками',
    pl_pre: 'решётках',
  },

  // Animate neuter noun: in the plural the accusative of an animate noun of any
  // gender copies the genitive (суще́ств), so a stored nominative-shaped
  // существа́ in the acc cell is the animacy defect this pins shut.
  'существо=creature': {
    pl_gen: 'суще́ств',
    pl_acc: 'суще́ств',
  },

  // Ghost sense is animate: sg/pl accusative both copy the genitive (ду́ха /
  // ду́хов). Pinning the animate acc keeps the sense-split from collapsing back
  // into the inanimate `дух`/`ду́хи` forms that belong to `дух=spirit`.
  'дух=ghost': {
    sg_acc: 'ду́ха',
    pl_acc: 'ду́хов',
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

  // ─── #444 verb corrections ───────────────────────────────────────────────
  // Mobile-stress -нуть perfectives: the stress falls on the ё-bearing ending
  // in 2sg–2pl, not on the stem. A stored `вздо́хнешь`/`отдо́хнешь` (no ё) is the
  // stem-stressed miscopy.
  'вздохнуть=to sigh': {
    'future.2sg': 'вздохнёшь',
    'future.3sg': 'вздохнёт',
    'future.1pl': 'вздохнём',
    'future.2pl': 'вздохнёте',
  },
  'отдохнуть=to rest': {
    'future.2sg': 'отдохнёшь',
    'future.3sg': 'отдохнёт',
    'future.1pl': 'отдохнём',
    'future.2pl': 'отдохнёте',
  },

  // Opposite mobile-stress pattern: обману́ retracts the stress to the stem from
  // 2sg on, so the ending is plain -е-, not ё. A stored `обманёшь` (ё) fabricates
  // the never-stressed ending.
  'обмануть=to deceive': {
    'future.2sg': 'обма́нешь',
    'future.3sg': 'обма́нет',
    'future.1pl': 'обма́нем',
    'future.2pl': 'обма́нете',
  },

  // -овать imperfective: the -ова- alternates to -у- + plain vowel endings
  // (риску́ешь), never a ё (`рискуёшь` is a fabricated ё on an unstressed ending).
  'рисковать=to risk': {
    'present.2sg': 'риску́ешь',
    'present.3sg': 'риску́ет',
    'present.1pl': 'риску́ем',
    'present.2pl': 'риску́ете',
  },

  // 3pl is поглядя́т — a stored `погладя́т` swaps the stem vowel я→а.
  'поглядеть=to look': {
    'future.3pl': 'поглядя́т',
  },

  // 1sg is совершу́ (the -ить ending is clipped and the personal ending added);
  // a stored `соверши́ть` is the bare infinitive left in the 1sg cell.
  'совершить=to commit': {
    'future.1sg': 'совершу́',
  },

  // 1sg is соображу́ — a stored `сображу́` drops the second о of the соо- prefix.
  'сообразить=to figure out': {
    'future.1sg': 'соображу́',
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
