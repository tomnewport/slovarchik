// Curated stress oracle data (issue #457).
//
// The hand-authored half of the stress-golden check in stressAudit.js
// (`stressGoldenMismatches`). Where morphGolden.js pins the correct *letters* of
// a paradigm cell (stress-insensitive, ё-sensitive), this table pins the correct
// *syllable* of the stress — the meaning-changing homograph class that ordinary
// shape tests, and even the phrase-vs-paradigm divergence check, can miss.
//
// It exists because two of the checks around it have blind spots:
//
//   • annotatedStressDivergences only fires when a phrase token disagrees with
//     its own paradigm cell. If a whole paradigm drifts onto the wrong syllable
//     *and* its usage examples echo the drift, both sides agree and nothing
//     catches it (this is exactly how `вы́глядеть`'s paradigm rotted into
//     `выгля́деть` while CI stayed green).
//
//   • morphOracle is deliberately stress-insensitive, so a homograph flipped
//     into its twin (`замо́к` lock → `за́мок` castle, `сто́ит` costs → `стои́т`
//     stands) reads as the same letters and passes.
//
// This table is the independent reference that closes both gaps. Seed it from
// concrete corrections and from the stress homographs that do the most
// learner-facing damage, so those exact bugs can never silently return.
//
// ─── How to review and extend ───────────────────────────────────────────────
// Comparison is stress-sensitive but case- and ё-folded (normTokenStress): only
// the accent *position* is judged here — a wrong letter or missing ё is
// morphOracle's job. When the check fires it's almost always a real data bug;
// fix the vocab YAML. Add an entry here whenever you (a) correct a wrong-syllable
// stress that a shape test would let back in, or (b) want to lock a stress
// minimal pair so neither member can drift into the other.
//
// Slot keys: `headword` (the entry's accented form), a dotted conjugation slot
// (`present.3sg`, `future.1sg`), a bare conjugation slot (`past_m`), or a flat
// declension slot (`sg_gen`).

/** key → { slot → correct stressed form }. */
export const STRESS_GOLDEN = {
  // ─── Stress minimal pairs — same letters, meaning set by the accent ───────
  // Lock vs castle: end-stressed mobile paradigm vs fixed stem stress. Pinned on
  // both so neither collapses into the other.
  'замок=lock': { headword: 'замо́к', sg_gen: 'замка́', pl_nom: 'замки́' },
  'замок=castle': { headword: 'за́мок', sg_gen: 'за́мка', pl_nom: 'за́мки' },

  // Costs vs stands — the сто́ит/стои́т, сто́ят/стоя́т pair the stress-aware gloss
  // resolver mishandled in #456 because the source stress was wrong.
  'стоить=to cost': {
    headword: 'сто́ить',
    'present.2sg': 'сто́ишь',
    'present.3sg': 'сто́ит',
    'present.3pl': 'сто́ят',
  },
  'стоять=to stand': {
    headword: 'стоя́ть',
    'present.2sg': 'стои́шь',
    'present.3sg': 'стои́т',
    'present.3pl': 'стоя́т',
  },

  // Stem-vs-ending shift across one paradigm: gen-sg го́рода vs nom-pl города́
  // (the #456 «це́нтре города́» slip used the plural stress for a genitive).
  'город=city': { sg_gen: 'го́рода', pl_nom: 'города́' },

  // ─── #457 proof-reading pass: infinitives stress-marked on the wrong syllable
  // while their own past/present cells and usage examples carried the correct
  // end stress. All uniformly end-stressed -ить/-ать verbs.
  'доходить=to reach': { headword: 'доходи́ть' },
  'заходить=to drop in': { headword: 'заходи́ть' }, // impf of зайти; cf. pf захо́дить "start pacing"
  'означать=to mean': { headword: 'означа́ть' },
  'полагать=to suppose': { headword: 'полага́ть' },
  'полагаться=to rely on': { headword: 'полага́ться' },
  'развиваться=to develop': { headword: 'развива́ться' },
  'видать=to see': { headword: 'вида́ть' },
  'догадаться=to guess': { headword: 'догада́ться' },
  'покачать=to rock': { headword: 'покача́ть' },
  'расположить=to arrange': { headword: 'расположи́ть', 'future.1sg': 'расположу́' },

  // выглядеть "to appear" carries FIXED stress on the вы- prefix through the
  // whole paradigm. The headword was right, but every conjugation cell and usage
  // example had drifted onto the stem (выгля́дишь / выгля́дел) — and because the
  // phrases echoed the bad cells, the divergence check stayed green. Pin the
  // paradigm so this can't silently regrow.
  'выглядеть=to look': {
    headword: 'вы́глядеть',
    'present.1sg': 'вы́гляжу',
    'present.2sg': 'вы́глядишь',
    'present.3sg': 'вы́глядит',
    'present.1pl': 'вы́глядим',
    'present.2pl': 'вы́глядите',
    'present.3pl': 'вы́глядят',
    past_m: 'вы́глядел',
    past_f: 'вы́глядела',
    past_n: 'вы́глядело',
    past_pl: 'вы́глядели',
  },

  // End-stressed adverbs whose stem-stressed miswrite (впо́лне / высо́ко) had
  // leaked into usage sentences.
  'вполне=quite': { headword: 'вполне́' },
  'высоко=high': { headword: 'высоко́' },

  // ─── Reference-cell corrections surfaced by the corpus-wide stress cross-check
  // (a stored headword/cell that a lone correct usage token contradicted).
  //
  // заговори́ть "begin speaking" is a stress homograph of загово́рить "talk (someone)
  // into a stupor / bewitch"; the whole paradigm had the second verb's stem stress.
  'заговорить=to start speaking': {
    headword: 'заговори́ть',
    'future.3sg': 'заговори́т',
    past_m: 'заговори́л',
    past_pl: 'заговори́ли',
  },
  // допро́с is end-stressed throughout; the paradigm had been written до́прос-.
  'допрос=interrogation': { sg_nom: 'допро́с', sg_pre: 'допро́се' },
  // земля has a mobile paradigm: end-stressed singular, STEM-stressed plural obliques
  // (зе́млям/зе́млями/зе́млях). The plural obliques had leaked the singular's end stress.
  'земля=earth': { sg_acc: 'зе́млю', pl_dat: 'зе́млям', pl_ins: 'зе́млями', pl_pre: 'зе́млях' },
  // сража́лся (stem жа́), matching its sibling сража́лись; the entry stored сра́жался.
  'сражался=fought': { headword: 'сража́лся' },
}
