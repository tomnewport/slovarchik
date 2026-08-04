#!/usr/bin/env node
/**
 * annotate-inflect.mjs — auto-add `inflect:` annotations to usage examples that
 * lack them, for the in-context inflection drill (issue #325 follow-up).
 *
 * Safety principle: only annotate a token when the annotation is provably
 * correct. A token is annotated only if its normalized surface form matches
 * EXACTLY ONE cell of the owner word's paradigm (so the grammatical slot is
 * unambiguous), or, for a few common syncretisms, when a governing preposition
 * pins the case. Nominative subjects (nouns) are never annotated — matching the
 * hand-authored convention (annotations teach oblique forms). Genuinely
 * ambiguous sentences are left untouched rather than guessed.
 *
 * `--apply` writes the files; without it, prints a dry-run report.
 * `--file <name>` restricts to one vocab file. `--sample N` prints N decisions.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

export const dir = 'public/vocab';
export const norm = (s) =>
  String(s ?? '').replace(/́/g, '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
export const core = (t) => String(t ?? '').replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '');
export const tokenize = (ru) => String(ru ?? '').trim().split(/\s+/).filter(Boolean);


// Prepositions and the case(s) each can govern (lower-cased, stress-stripped).
// Used only to disambiguate a token that is case-ambiguous within its paradigm:
// the case is taken to be the single overlap between what the preposition allows
// and the token's candidate cells. So в + a form that is only ever dat-or-pre
// (fem `-е`) resolves to prepositional, since в never governs the dative.
export const PREP_CASES = {
  без: ['gen'], до: ['gen'], из: ['gen'], 'из-за': ['gen'], 'из-под': ['gen'],
  от: ['gen'], ото: ['gen'], у: ['gen'], для: ['gen'], около: ['gen'], возле: ['gen'],
  вокруг: ['gen'], кроме: ['gen'], среди: ['gen'], против: ['gen'], ради: ['gen'],
  мимо: ['gen'], вместо: ['gen'], сверх: ['gen'], насчёт: ['gen'], позади: ['gen'],
  к: ['dat'], ко: ['dat'],
  над: ['ins'], надо: ['ins'], перед: ['ins'], передо: ['ins'], между: ['ins'],
  // о/об/обо: 'about' (+pre) and the contact sense 'against' (+acc, обжёгся о крапи́ву).
  о: ['acc', 'pre'], об: ['acc', 'pre'], обо: ['acc', 'pre'], при: ['pre'],
  в: ['acc', 'pre'], во: ['acc', 'pre'], на: ['acc', 'pre'],
  за: ['acc', 'ins'], под: ['acc', 'ins'], подо: ['acc', 'ins'],
  про: ['acc'], через: ['acc'], сквозь: ['acc'],
  с: ['gen', 'ins'], со: ['gen', 'ins'],
};

// Words that govern the genitive on the noun to their right (reaching across an
// agreeing modifier, like a preposition). Two families: quantity words and the
// negation «нет». Used only to classify skips into confirmable genitive buckets,
// never to auto-annotate — so this can't change the auto-annotator's output.
export const GENITIVE_QUANTIFIERS = new Set([
  'много', 'немного', 'мало', 'немало', 'несколько', 'сколько', 'столько',
  'больше', 'меньше', 'достаточно', 'полно', 'масса', 'куча', 'пара',
]);
// Cardinal numerals (2+) take the genitive: 2–4 → gen sg, 5+ → gen pl. The
// surface form already encodes which, so we only need to recognise the numeral.
export const GENITIVE_NUMERALS = new Set([
  'два', 'две', 'три', 'четыре', 'оба', 'обе',
  'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять',
  'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать',
  'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'сто', 'тысяча',
]);
export const GENITIVE_NEGATION = new Set(['нет', 'нету']);

// --- Direct-object accusative detection ---------------------------------
// Many object nouns take an accusative spelled exactly like the nominative
// (inanimate masc/neuter, and every noun's nom/acc plural), so no governing
// preposition can pin the case. We annotate accusative only when the syntax
// makes the token an unambiguous direct object: it follows an imperative, or a
// nominative subject plus a transitive finite verb — and never in a
// pointing/copular/predicate frame. Restricted to nom≡acc syncretic forms
// (inanimate); an animate acc (== gen) is left to the hand bucket, because its
// surface form is shared with the genitive of negation («не ви́жу дру́га») and
// the partitive («вы́пить ча́ю»), which this syntax test cannot tell apart.
// Conservative by design: unsure → left for `accusative-object` to confirm.
export const NOM_SUBJ_PRON = new Set(['я', 'ты', 'он', 'она', 'оно', 'мы', 'вы', 'они', 'кто']);
export const POINTERS = new Set(['это', 'этот', 'эта', 'эти', 'вот', 'вон', 'то', 'тот']);
// Oblique (non-nominative) pronouns: an experiencer like «Его́ охвати́ло …» is
// not the subject, so it must not license the post-verbal noun as an object.
export const OBLIQUE_PRON = new Set([
  'меня', 'тебя', 'его', 'её', 'ее', 'нас', 'вас', 'их', 'мне', 'тебе', 'ему', 'ей',
  'нам', 'вам', 'им', 'мной', 'тобой', 'ею', 'нами', 'вами', 'ими', 'себя', 'себе',
  'собой', 'кого', 'кому', 'кем', 'чего', 'чему', 'чем', 'мою', 'твою',
]);

// Linking / intransitive verbs: a nominative-shaped noun beside one of these is
// the subject, not an object. (Reflexive `-ся/-сь` verbs are excluded too.)
// Also lists verbs that govern a case OTHER than the accusative (dat/ins/gen),
// so their nominative-shaped neighbour is never their object.
export const INTRANS_LEMMAS = new Set([
  // linking
  'быть', 'стать', 'становиться', 'являться', 'казаться', 'оставаться', 'оказаться',
  'называться', 'выглядеть', 'оказываться',
  // intransitive activity / position / motion (impf + pf)
  'работать', 'служить', 'жить', 'учиться', 'заниматься', 'находиться', 'лежать',
  'стоять', 'сидеть', 'висеть', 'расти', 'спать', 'гореть', 'светить', 'дышать',
  'идти', 'ходить', 'ехать', 'ездить', 'бежать', 'бегать', 'лететь', 'летать',
  'плыть', 'плавать', 'гулять', 'путешествовать', 'спешить', 'торопиться', 'цвести',
  'течь', 'дуть', 'войти', 'выйти', 'прийти', 'уйти', 'зайти', 'отойти', 'подойти',
  'перейти', 'пройти', 'дойти', 'приехать', 'уехать', 'поехать', 'въехать', 'выехать',
  'побежать', 'прибежать', 'убежать', 'прилететь', 'улететь', 'полететь',
  'встать', 'сесть', 'лечь', 'упасть', 'подняться', 'спуститься', 'вернуться',
  'проснуться', 'уснуть', 'заснуть', 'родиться', 'умереть', 'погибнуть',
  'остаться', 'появиться', 'исчезнуть', 'случиться', 'произойти', 'наступить',
  'стоить', 'вырасти', 'возникнуть', 'возникать', 'вырастать', 'опуститься',
  'происходить', 'случаться', 'наступать', 'существовать', 'появляться',
  'приходить', 'уходить', 'приезжать', 'уезжать', 'входить', 'выходить', 'возвращаться',
  // government other than accusative (dat / ins / gen / prep)
  'звонить', 'позвонить', 'помогать', 'помочь', 'мешать', 'помешать', 'верить', 'поверить',
  'принадлежать', 'зависеть', 'править', 'следить', 'управлять', 'руководить', 'владеть',
  'гордиться', 'пользоваться', 'воспользоваться', 'интересоваться', 'улыбаться', 'смеяться',
  'доверять', 'угрожать', 'грозить', 'завидовать', 'радоваться', 'учиться', 'научиться',
  'обладать', 'дорожить', 'наслаждаться', 'заведовать', 'командовать', 'дирижировать',
  // psych / experiencer verbs: nom stimulus + acc/dat experiencer, so a
  // nominative-shaped noun beside them is the (nominative) stimulus subject
  'нравиться', 'понравиться', 'радовать', 'интересовать', 'удивлять', 'удивить',
  'беспокоить', 'волновать', 'пугать', 'испугать', 'злить', 'раздражать', 'восхищать',
  'привлекать', 'хотеться', 'требоваться', 'удаваться', 'удаться', 'сниться', 'присниться',
]);

// Imperative forms that are also common non-verbs (мой = possessive, три = 3).
export const IMPER_HOMOGRAPHS = new Set(['мой', 'три']);

/**
 * Every surface form that is UNAMBIGUOUSLY nominative — its nominative differs
 * from its accusative in the same lexeme (feminine `-а`, animate, …). A subject
 * candidate must be one of these, which rejects both oblique nouns mistaken for
 * subjects (e.g. «слова́х») and nominative-shaped objects fronted before the
 * verb (OSV: «Письмо́ написа́л челове́к», «Реше́ние при́нял штаб»).
 */
function buildNomIndex() {
  const nom = new Set();
  const addIf = (n, a) => { if (n && norm(n) !== norm(a)) nom.add(norm(n)); };
  for (const f of ['nouns.yml', 'calendar.yml']) {
    const doc = yaml.load(readFileSync(`${dir}/${f}`, 'utf8'));
    for (const w of Object.values(doc.words || {})) {
      addIf(w.declension?.sg_nom, w.declension?.sg_acc);
      addIf(w.declension?.pl_nom, w.declension?.pl_acc);
    }
  }
  const adj = yaml.load(readFileSync(`${dir}/adjectives.yml`, 'utf8'));
  for (const w of Object.values(adj.words || {})) {
    for (const g of ['m', 'n', 'f', 'pl']) addIf(w.declension?.[`${g}_nom`], w.declension?.[`${g}_acc`]);
  }
  const pr = yaml.load(readFileSync(`${dir}/pronouns.yml`, 'utf8'));
  for (const w of Object.values(pr.words || {})) {
    for (const g of ['m', 'n', 'f', 'pl']) addIf(w.declension?.[`${g}_nom`], w.declension?.[`${g}_acc`]);
    addIf(w.forms?.nom, w.forms?.acc);
  }
  return nom;
}

/** Build the transitive-finite and imperative form indexes from verbs.yml. */
function buildVerbIndex() {
  const doc = yaml.load(readFileSync(`${dir}/verbs.yml`, 'utf8'));
  const finite = new Set();
  const imper = new Set();
  for (const [key, w] of Object.entries(doc.words || {})) {
    const lemma = key.split('=')[0];
    if (INTRANS_LEMMAS.has(lemma) || /с[яь]$/.test(lemma)) continue;
    const c = w.conjugation || {};
    for (const t of ['present', 'future']) {
      if (c[t]) for (const f of Object.values(c[t])) if (f) finite.add(norm(f));
    }
    for (const p of ['past_m', 'past_f', 'past_n', 'past_pl']) if (c[p]) finite.add(norm(c[p]));
    if (c.imperative) {
      // Skip imperative forms that collide with a common non-verb word: «мой»
      // is also the possessive, «три» the number — both would false-fire.
      if (c.imperative.sg && !IMPER_HOMOGRAPHS.has(norm(c.imperative.sg))) {
        imper.add(norm(c.imperative.sg));
      }
      if (c.imperative.pl) imper.add(norm(c.imperative.pl));
    }
  }
  return { finite, imper };
}

// The nom/verb indexes are derived from the whole vocab, so build them once and
// cache. Lazy: only the direct-object path touches them, so a caller reasoning
// about a synthetic word without that path never reads the corpus files.
let _accContext = null;
export function accContext() {
  return _accContext ??= { nomForms: buildNomIndex(), verbIdx: buildVerbIndex() };
}

/**
 * Whether the token at `idx` (0-based) reads as a bare accusative direct object,
 * using the nom/verb indexes in `ctx` (defaults to the cached corpus context).
 * `analyze`/`decide` accept the same `ctx` so tests can inject a hand-built one.
 */
export function isAccObject(tokens, idx, ctx = accContext()) {
  const { nomForms, verbIdx } = ctx;
  if (idx === 0) return false; // sentence-initial → topic/subject
  if (PREP_CASES[norm(core(tokens[idx - 1]))]) return false; // prep-governed, handled elsewhere
  if (POINTERS.has(norm(core(tokens[0])))) return false; // «Это …», «Вот …» → predicate nominative
  if (tokens.some((t) => /^[—–-]$/.test(t))) return false; // «X — Y» predicate
  let hasImper = false;
  let hasSubjPron = false;
  for (let j = 0; j < idx; j++) {
    const n = norm(core(tokens[j]));
    if (verbIdx.imper.has(n)) hasImper = true;
    if (NOM_SUBJ_PRON.has(n)) hasSubjPron = true;
  }
  if (hasImper) return true;
  const hasTransVerb = tokens.some((t) => verbIdx.finite.has(norm(core(t))));
  if (hasSubjPron && hasTransVerb) return true;
  // General S–V–O: a transitive finite verb sits before the owner, preceded by
  // a plausible nominative subject. Rejects V–S inversion («В собо́ре игра́л
  // орга́н») and experiencer fronting («Его́ охвати́ло отча́яние») by requiring
  // the subject not to be a preposition-object or an oblique pronoun.
  const isSubject = (j) => {
    const n = norm(core(tokens[j]));
    if (!n || PREP_CASES[n] || POINTERS.has(n) || OBLIQUE_PRON.has(n)) return false;
    if (j > 0 && PREP_CASES[norm(core(tokens[j - 1]))]) return false; // prep-object
    return NOM_SUBJ_PRON.has(n) || nomForms.has(n); // must be nominative-capable
  };
  for (let k = 1; k < idx; k++) {
    if (!verbIdx.finite.has(norm(core(tokens[k])))) continue;
    for (let j = 0; j < k; j++) if (isSubject(j)) return true;
  }
  return false;
}

/**
 * Pin an unresolved candidate to its accusative cell when the syntax makes it a
 * direct object. Only for a nom≡acc syncretic form (inanimate noun, or an
 * agreeing adjective whose gender the form already fixes). Returns the acc cell
 * or null.
 */
function directObjectAccCell(pos, cand, tokens, ctx) {
  const cases = new Set(cand.cells.map((x) => x.case));
  if (!(cases.size === 2 && cases.has('nom') && cases.has('acc'))) return null;
  if (pos === 'noun') {
    if (!isAccObject(tokens, cand.idx, ctx)) return null;
    const accCells = cand.cells.filter((x) => x.case === 'acc');
    return accCells.length === 1 ? accCells[0] : null;
  }
  if (pos === 'adjective') {
    const genders = new Set(cand.cells.map((x) => x.gender));
    if (genders.size !== 1 || !isAccObject(tokens, cand.idx, ctx)) return null;
    return cand.cells.find((x) => x.case === 'acc');
  }
  return null;
}

/** Build norm(form) -> list of paradigm cells, from a flat key→form map. */
function cellsFromFlat(obj, keyRe, shape) {
  const map = new Map();
  for (const [k, v] of Object.entries(obj || {})) {
    const m = k.match(keyRe);
    if (!m) continue;
    const n = norm(v);
    if (!map.has(n)) map.set(n, []);
    map.get(n).push(shape(m));
  }
  return map;
}

export function nounCells(w) {
  return cellsFromFlat(w.declension, /^(sg|pl)_(nom|gen|dat|acc|ins|pre|loc)$/, (m) => ({
    number: m[1], case: m[2],
  }));
}
export function adjCells(w) {
  return cellsFromFlat(w.declension, /^(m|n|f|pl)_(nom|gen|dat|acc|ins|pre)$/, (m) => ({
    gender: m[1], case: m[2], number: m[1] === 'pl' ? 'pl' : 'sg',
  }));
}
export function verbCells(w) {
  const c = w.conjugation || {};
  const map = new Map();
  const add = (form, tense, person) => {
    if (!form) return;
    const n = norm(form);
    if (!map.has(n)) map.set(n, []);
    map.get(n).push({ tense, person });
  };
  for (const t of ['present', 'future']) {
    if (c[t]) for (const [p, f] of Object.entries(c[t])) add(f, t, p);
  }
  for (const p of ['past_m', 'past_f', 'past_n', 'past_pl']) add(c[p], 'past', p);
  if (c.imperative) {
    add(c.imperative.sg, 'imperative', 'imp_sg');
    add(c.imperative.pl, 'imperative', 'imp_pl');
  }
  return map;
}
// Third-person personal pronouns take an н- prefix on their oblique forms after
// any preposition: его → у него́, и́ми → с ни́ми. The prepositional is already
// stored with the н (нём, них); the others (gen/dat/acc/ins) are stored bare, so
// we add the н-variant as a separate `prep`-flagged reading of the same case.
const THIRD_PERSON = new Set(['он', 'она', 'оно', 'они']);

export function pronounCells(w) {
  if (w.declension) return { map: adjCells(w), gendered: true };
  const map = new Map();
  const add = (form, cell) => {
    const n = norm(form);
    (map.get(n) ?? map.set(n, []).get(n)).push(cell);
  };
  const thirdPerson = THIRD_PERSON.has(norm(w.forms?.nom ?? ''));
  for (const c of ['nom', 'gen', 'dat', 'acc', 'ins', 'pre']) {
    if (!w.forms?.[c]) continue;
    add(w.forms[c], { case: c });
    if (thirdPerson && c !== 'nom' && c !== 'pre') add(`н${norm(w.forms[c])}`, { case: c, prep: true });
  }
  return { map, gendered: false };
}

export const PRONOUN_RULE = {
  pers: 'pronoun-personal', refl: 'pronoun-personal',
  poss: 'pronoun-possessive', demo: 'pronoun-demonstrative',
  det: 'pronoun-demonstrative', inter: 'pronoun-interrogative', neg: null,
};

/**
 * Build the paradigm view for a word: its form→cells map plus the closures that
 * name the grammar rule and the inflect fields for a resolved cell. Returns null
 * for a POS the drill doesn't cover. Shared by `analyze` (below), so the triage
 * report and the auto-annotator reason about the exact same cells.
 */
export function paradigmFor(pos, word) {
  if (pos === 'noun') {
    const decl = word.declension || {};
    return {
      map: nounCells(word), gendered: false,
      ruleFor: (cell) => {
        // Animate accusative (acc syncretic with genitive) gets its own rule.
        if (cell.case === 'acc' && word.animacy === 'a' &&
            norm(decl[`${cell.number}_acc`]) === norm(decl[`${cell.number}_gen`])) {
          return 'noun-acc-animate';
        }
        return `noun-${cell.case}-${cell.number}`;
      },
      extraFields: (cell) => ({ case: cell.case, number: cell.number }),
    };
  }
  if (pos === 'adjective') {
    return {
      map: adjCells(word), gendered: true,
      ruleFor: () => 'adj-agreement',
      extraFields: (cell) => ({ case: cell.case, number: cell.number, gender: cell.gender }),
    };
  }
  if (pos === 'verb') {
    return {
      map: verbCells(word), gendered: false,
      ruleFor: (cell) => `verb-${cell.tense}`,
      extraFields: (cell) => ({ tense: cell.tense, person: cell.person }),
    };
  }
  if (pos === 'pronoun') {
    const pc = pronounCells(word);
    return {
      map: pc.map, gendered: pc.gendered,
      ruleFor: () => PRONOUN_RULE[word.type] ?? null,
      extraFields: (cell) =>
        pc.gendered
          ? { case: cell.case, number: cell.number, gender: cell.gender }
          : { case: cell.case, ...(cell.prep ? { prep: true } : {}) },
    };
  }
  return null;
}

/** A cell we never annotate for nouns/pronouns (dictionary form / 2nd locative). */
function isSkippableCase(pos, gendered, cell) {
  if (pos === 'noun' && (cell.case === 'nom' || cell.case === 'loc')) return true;
  if (pos === 'pronoun' && !gendered && cell.case === 'nom') return true;
  return false;
}

/**
 * Classify one usage sentence of `word` for the in-context inflection drill.
 * Returns { status, bucket, dec?, candidates } where:
 *   - status: 'annotate' (script can prove the slot) or 'skip'
 *   - bucket: WHY it lands where it does — the triage key. For 'annotate':
 *       'single-cell' | 'prep-pinned' | 'direct-object-acc'. For 'skip':
 *       'no-paradigm' | 'no-matching-cell' | 'indeclinable' |
 *       'nominative-subject' | 'prep-pinnable-multi-token' | 'number-only' |
 *       'animate-accusative' | 'genuinely-ambiguous'.
 *   - dec: { token, fields, rule } when the case (and, for a suggestion, a
 *       proposed number) is pinned; the `confirm` array names fields a human
 *       must still check (e.g. ['number'] for the number-only bucket).
 * This is the single source of truth: `decide` returns dec only when
 * status === 'annotate', and the triage tool reads bucket/dec/candidates.
 */
/**
 * Match a short-form (predicate) adjective. The short form (боле́н, закры́т,
 * рад) agrees by gender/number only and lives in a separate `short:` block, not
 * the case declension — so it never appears among the regular candidates. If
 * exactly one token is exactly one gender's short form, propose it. Returns an
 * `annotate` result (degree: short, no case) or null.
 */
function shortAnnotate(pos, word, tokens) {
  if (pos !== 'adjective' || !word.short) return null;
  const byForm = new Map();
  for (const g of ['m', 'f', 'n', 'pl']) {
    if (!word.short[g]) continue;
    const n = norm(word.short[g]);
    (byForm.get(n) ?? byForm.set(n, []).get(n)).push(g);
  }
  const hits = [];
  for (let i = 0; i < tokens.length; i++) {
    const gs = byForm.get(norm(core(tokens[i])));
    if (gs) hits.push({ i, gs });
  }
  if (hits.length !== 1 || hits[0].gs.length !== 1) return null;
  return {
    status: 'annotate', bucket: 'short-form', candidates: [],
    dec: { token: hits[0].i + 1, fields: { degree: 'short', gender: hits[0].gs[0] }, rule: 'adj-short-form' },
  };
}

export function analyze(pos, word, ru, ctx) {
  const tokens = tokenize(ru);
  const setup = paradigmFor(pos, word);
  if (!setup) return { status: 'skip', bucket: 'unsupported-pos', candidates: [] };
  const { map, gendered, ruleFor, extraFields } = setup;
  if (!map || map.size === 0) return shortAnnotate(pos, word, tokens)
    ?? { status: 'skip', bucket: 'no-paradigm', candidates: [] };

  // Indeclinable paradigm: every declension/case cell collapses to one surface
  // form (Маро́кко, США, ко́фе). There is nothing to inflect — an annotation
  // would make the answer equal the prompt — so we never propose or apply here.
  // This is NOT a single-slot noun (only one cell defined): that has a real
  // oblique form to drill, so require the one form to span more than one cell.
  if (pos !== 'verb' && map.size === 1 && [...map.values()][0].length > 1) {
    return { status: 'skip', bucket: 'indeclinable', candidates: [] };
  }

  const canPrep = pos === 'noun' || (pos === 'pronoun' && !gendered);
  const mk = (cell, extra = {}) => ({ fields: extraFields(cell), rule: ruleFor(cell), ...extra });

  // Candidate tokens: those whose form appears in the paradigm at all.
  const cands = [];
  for (let i = 0; i < tokens.length; i++) {
    const n = norm(core(tokens[i]));
    if (!n) continue;
    const cells = map.get(n);
    if (!cells) continue;
    const prev = i > 0 ? norm(core(tokens[i - 1])) : null;
    cands.push({ idx: i, n, cells, prep: canPrep && prev && PREP_CASES[prev] ? prev : null });
  }
  if (!cands.length) return shortAnnotate(pos, word, tokens)
    ?? { status: 'skip', bucket: 'no-matching-cell', candidates: [] };

  // Resolve each candidate token to a definite oblique cell where we can.
  for (const c of cands) {
    c.oblique = c.cells.filter((x) => !isSkippableCase(pos, gendered, x));
    if (c.cells.length === 1) {
      c.cell = isSkippableCase(pos, gendered, c.cells[0]) ? null : c.cells[0];
      c.via = c.cell ? 'single-cell' : null;
      continue;
    }
    if (c.prep) {
      // Auto-pin only on an ADJACENT governing preposition that yields a single
      // case AND a single number — the conservative rule the auto-annotator has
      // always used. Reaching across modifiers is left to the skip classifier.
      const allowed = PREP_CASES[c.prep];
      const hit = c.cells.filter((x) => allowed.includes(x.case) && !isSkippableCase(pos, gendered, x));
      const cases = new Set(hit.map((x) => x.case));
      if (cases.size === 1 && hit.every((x) => x.number === hit[0].number)) {
        c.cell = hit[0]; c.via = 'prep-pinned';
      }
    }
    // Direct-object accusative: a nom≡acc syncretic form (which no preposition
    // can disambiguate) that the syntax proves is a transitive verb's object.
    if (!c.cell && (pos === 'noun' || pos === 'adjective')) {
      const cell = directObjectAccCell(pos, c, tokens, ctx ?? accContext());
      if (cell) { c.cell = cell; c.via = 'direct-object-acc'; }
    }
  }

  // The auto-annotatable set: candidates pinned to a single definite cell.
  const pinned = cands.filter((c) => c.cell);
  if (pinned.length === 1) {
    const c = pinned[0];
    return {
      status: 'annotate',
      bucket: c.via, // 'single-cell' | 'prep-pinned' | 'direct-object-acc'
      dec: { token: c.idx + 1, ...mk(c.cell) },
      candidates: cands,
    };
  }
  if (pinned.length > 1) {
    return { status: 'skip', bucket: 'multi-token-ambiguous', candidates: cands, dec: null };
  }

  // Nothing auto-pinned → classify the skip and, where possible, propose a
  // candidate annotation for a human to confirm. Each hand bucket carries a
  // `dec` with a `confirm` list naming the judgement the human still owns.
  const oblique = cands.filter((c) => c.oblique.length);
  if (!oblique.length) {
    // Every candidate reads as nominative only — a subject, or a predicate
    // nominative after «—». Propose case: nom for a lone candidate; the human
    // confirms it's the subject/predicate (not, say, a vocative). status stays
    // 'skip' so the auto-annotator (`decide`) never emits nominative.
    const noms = cands.filter((c) => c.cells.some((x) => x.case === 'nom'));
    if (noms.length === 1) {
      const nomCell = noms[0].cells.find((x) => x.case === 'nom');
      return {
        status: 'skip', bucket: 'nominative-subject', candidates: cands,
        dec: { token: noms[0].idx + 1, ...mk(nomCell, { confirm: ['case'] }) },
      };
    }
    return { status: 'skip', bucket: 'nominative-subject', candidates: cands, dec: null };
  }
  if (oblique.length > 1) return { status: 'skip', bucket: 'multi-token-ambiguous', candidates: cands, dec: null };

  const c = oblique[0];
  const obliqueCases = new Set(c.oblique.map((x) => x.case));

  // Accusative object: the token's only non-nominative reading is accusative —
  // inanimate nom/acc syncretism (абза́ц, письмо́), or an animate acc=gen form
  // (дру́га). The form can't tell an object from a nominative subject, so the
  // human confirms it's a direct object / goal (`case`).
  const animAcc = (() => {
    if (!(pos === 'noun' && word.animacy === 'a')) return null;
    const acc = c.cells.find((x) => x.case === 'acc');
    const gen = c.cells.find((x) => x.case === 'gen');
    return acc && gen && acc.number === gen.number ? acc : null;
  })();
  if (obliqueCases.size === 1 && obliqueCases.has('acc')) {
    return {
      status: 'skip', bucket: 'accusative-object', candidates: cands,
      dec: { token: c.idx + 1, ...mk(c.oblique.find((x) => x.case === 'acc'), { confirm: ['case'] }) },
    };
  }
  if (animAcc) {
    return {
      status: 'skip', bucket: 'accusative-object', candidates: cands,
      dec: { token: c.idx + 1, ...mk(animAcc, { confirm: ['case'] }) },
    };
  }

  // Preposition-governed: a governing preposition — adjacent, or reaching back
  // across an agreeing modifier (в гражда́нской авиа́ции) — narrows the oblique
  // cases to exactly one. If the number is also unique it's a light confirm
  // (the human checks the preposition really governs this token); if the number
  // is still syncretic it's the number-only bucket.
  const prep = nearestGoverningPrep(tokens, c.idx);
  if (prep) {
    const allowed = PREP_CASES[prep.tok];
    const hitCases = new Set(c.oblique.filter((x) => allowed.includes(x.case)).map((x) => x.case));
    if (hitCases.size === 1) {
      const caseX = [...hitCases][0];
      const cells = c.oblique.filter((x) => x.case === caseX);
      const numbers = new Set(cells.map((x) => x.number));
      if (numbers.size === 1) {
        return {
          status: 'skip', bucket: 'prep-governed', candidates: cands,
          dec: { token: c.idx + 1, ...mk(cells[0], { confirm: ['case'], prep: prep.tok }) },
        };
      }
      return {
        status: 'skip', bucket: 'number-only', candidates: cands,
        dec: { token: c.idx + 1, ...mk(cells[0], { confirm: ['number'], prep: prep.tok }) },
      };
    }
  }

  // Genitive governor: a quantity word / numeral («мно́го воды́», «пять книг») or
  // the negation «нет» («нет вре́мени») to the left forces the genitive. Only
  // fires when the token actually has a genitive reading and that reading pins a
  // single number, so the proposal is a light confirm.
  if (obliqueCases.has('gen')) {
    const gov = nearestGenitiveGovernor(tokens, c.idx);
    if (gov) {
      const genCells = c.oblique.filter((x) => x.case === 'gen');
      const numbers = new Set(genCells.map((x) => x.number));
      if (numbers.size === 1) {
        return {
          status: 'skip',
          bucket: gov === 'negation' ? 'genitive-negation' : 'genitive-quantity',
          candidates: cands,
          dec: { token: c.idx + 1, ...mk(genCells[0], { confirm: ['case'], gov }) },
        };
      }
    }
  }
  return { status: 'skip', bucket: 'genuinely-ambiguous', candidates: cands, dec: null };
}

/**
 * Nearest genitive-forcing governor to the left of `idx`: a quantity word /
 * cardinal numeral, or the negation «нет». Reaches across an agreeing modifier
 * and stops at a clause boundary, mirroring {@link nearestGoverningPrep}.
 * Returns 'quantity' | 'negation' | null.
 */
function nearestGenitiveGovernor(tokens, idx) {
  for (let j = idx - 1; j >= 0 && j >= idx - 3; j--) {
    const raw = tokens[j];
    const n = norm(core(raw));
    if (GENITIVE_NEGATION.has(n)) return 'negation';
    if (GENITIVE_QUANTIFIERS.has(n) || GENITIVE_NUMERALS.has(n)) return 'quantity';
    if (/[,;:—–]/.test(raw)) break;
  }
  return null;
}

/**
 * Nearest preposition governing `idx`, searching left across up to two agreeing
 * modifiers (adjectives/possessives sit between a preposition and its noun:
 * «в вое́нной акаде́мии»). Stops at a clause boundary (any comma/dash/colon
 * clinging to an intervening token) so we never reach past the phrase. Returns
 * { tok, at } or null. Used only to classify skips, never to auto-annotate, so
 * the extra reach can't silently change the auto-annotator's output.
 */
function nearestGoverningPrep(tokens, idx) {
  for (let j = idx - 1; j >= 0 && j >= idx - 3; j--) {
    const raw = tokens[j];
    const n = norm(core(raw));
    if (PREP_CASES[n]) return { tok: n, at: j };
    // A genitive governor (нет / мно́го / a numeral) between a preposition and
    // the target claims the target itself, so a preposition further left can't
    // reach it — «В стака́не нет воды́» is genitive, not в-governed. Stop here.
    if (GENITIVE_NEGATION.has(n) || GENITIVE_QUANTIFIERS.has(n) || GENITIVE_NUMERALS.has(n)) break;
    // A boundary punctuation clinging to this token sits between it and the
    // token to its right — including right before the target — so stop here.
    if (/[,;:—–]/.test(raw)) break;
  }
  return null;
}

/**
 * Decide the annotation for one usage sentence of `word`, or null.
 * Returns { token (1-based), fields, rule }. Thin wrapper over `analyze`.
 */
export function decide(pos, word, ru, ctx) {
  const a = analyze(pos, word, ru, ctx);
  return a.status === 'annotate' ? a.dec : null;
}

/** Serialize an inflect object in the repo's canonical inline order. */
export function serializeInflect(pos, dec) {
  const f = dec.fields;
  const parts = [`token: ${dec.token}`];
  if (pos === 'verb') {
    parts.push(`tense: ${f.tense}`, `person: ${f.person}`);
  } else if (f.degree === 'short') {
    parts.push('degree: short', `gender: ${f.gender}`);
  } else {
    parts.push(`case: ${f.case}`);
    if (f.number) parts.push(`number: ${f.number}`);
    if (f.gender) parts.push(`gender: ${f.gender}`);
    if (f.prep) parts.push('prep: true');
  }
  if (dec.rule) parts.push(`rule: ${dec.rule}`);
  return `        inflect: { ${parts.join(', ')} }`;
}

import yaml from 'js-yaml';

export const FILES = {
  'nouns.yml': 'noun', 'calendar.yml': 'noun', 'verbs.yml': 'verb',
  'adjectives.yml': 'adjective', 'pronouns.yml': 'pronoun',
};

/**
 * Walk a vocab file's lines and return one entry per usage sentence:
 * { key, ru, ruLine, lastLine, hasInflect }. `lastLine` is where an inflect
 * line would be inserted; `hasInflect` flags an already-annotated sentence.
 * Both the auto-annotator and the triage tool iterate over this, so they see
 * exactly the same sentences.
 */
export function parseUsageItems(lines) {
  const items = [];
  let curKey = null;
  let inUsage = false;
  let item = null;
  const flush = () => { if (item) { items.push(item); item = null; } };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const km = ln.match(/^ {2}"([^"]+)":\s*$/);
    if (km) { flush(); curKey = km[1]; inUsage = false; continue; }
    if (/^ {4}usage:\s*$/.test(ln)) { flush(); inUsage = true; continue; }
    if (inUsage) {
      const rm = ln.match(/^ {6}- ru:\s*(.+?)\s*$/);
      if (rm) {
        flush();
        let ru = rm[1].trim();
        if ((ru.startsWith('"') && ru.endsWith('"')) || (ru.startsWith("'") && ru.endsWith("'"))) ru = ru.slice(1, -1);
        item = { key: curKey, ruLine: i, ru, lastLine: i, hasInflect: false };
        continue;
      }
      // a line that is part of the current usage item: any line indented deeper
      // than the `- ru:` marker (8+ spaces), including en_alt list items (10).
      if (item && /^ {8,}\S/.test(ln)) {
        item.lastLine = i;
        if (/^ {8}inflect:/.test(ln)) item.hasInflect = true;
        continue;
      }
      // dedent out of usage (e.g. `    declension:` or next `  "key":`)
      if (/^ {4}\S/.test(ln) && !/^ {6}/.test(ln)) { flush(); inUsage = false; }
    }
  }
  flush();
  return items;
}

/** Load a vocab file's word map plus its raw lines. */
export function loadVocabFile(file) {
  const raw = readFileSync(`${dir}/${file}`, 'utf8');
  return { words: yaml.load(raw).words || {}, lines: raw.split('\n') };
}

// ---- driver ----------------------------------------------------------------
function main(args) {
  const APPLY = args.includes('--apply');
  // --check: non-mutating CI guard. Fail if the annotator would still add
  // anything, i.e. a committed usage sentence is provably annotatable but
  // un-applied — the drift the exhaustive-annotation policy must not accrue.
  const CHECK = args.includes('--check');
  const onlyFile = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
  const sampleN = args.includes('--sample') ? Number(args[args.indexOf('--sample') + 1]) : 0;

  const grand = { added: 0, alreadyOk: 0, skipped: 0, sentences: 0 };
  const samples = [];
  const residue = []; // every would-add sentence, for --check to report in full

  for (const [file, pos] of Object.entries(FILES)) {
    if (onlyFile && file !== onlyFile) continue;
    const { words, lines } = loadVocabFile(file);

    const inserts = []; // { afterLine, text }
    for (const item of parseUsageItems(lines)) {
      const w = words[item.key];
      if (w && !item.hasInflect && w.learn !== false) {
        grand.sentences++;
        const dec = decide(pos, w, item.ru);
        if (dec) {
          inserts.push({ afterLine: item.lastLine, text: serializeInflect(pos, dec) });
          grand.added++;
          residue.push(`${file}  ${item.key}\n   ${item.ru}\n   → ${serializeInflect(pos, dec).trim()}`);
          if (samples.length < sampleN) samples.push(residue[residue.length - 1]);
        } else {
          grand.skipped++;
        }
      } else if (item.hasInflect) {
        grand.alreadyOk++;
      }
    }

    if (APPLY && inserts.length) {
      // Apply from bottom to top so line indices stay valid.
      inserts.sort((a, b) => b.afterLine - a.afterLine);
      for (const ins of inserts) lines.splice(ins.afterLine + 1, 0, ins.text);
      writeFileSync(`${dir}/${file}`, lines.join('\n'));
    }
    console.log(`${file}: +${inserts.length} annotations`);
  }

  console.log(`\nTOTAL: added=${grand.added} skipped=${grand.skipped} alreadyAnnotated=${grand.alreadyOk} unannotatedSentencesSeen=${grand.sentences}`);
  if (samples.length) console.log('\n--- samples ---\n' + samples.join('\n\n'));

  if (CHECK && grand.added) {
    console.error(`\n✗ ${grand.added} un-applied annotation(s). Run \`node scripts/annotate-inflect.mjs --apply\`:\n\n${residue.join('\n\n')}`);
    process.exitCode = 1;
  } else if (CHECK) {
    console.log('\n✓ no un-applied annotations — the vocab is fully annotated.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
