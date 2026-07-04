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

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const onlyFile = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const sampleN = args.includes('--sample') ? Number(args[args.indexOf('--sample') + 1]) : 0;

const dir = 'public/vocab';
const norm = (s) =>
  String(s ?? '').replace(/́/g, '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const core = (t) => String(t ?? '').replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '');
const tokenize = (ru) => String(ru ?? '').trim().split(/\s+/).filter(Boolean);


// Prepositions and the case(s) each can govern (lower-cased, stress-stripped).
// Used only to disambiguate a token that is case-ambiguous within its paradigm:
// the case is taken to be the single overlap between what the preposition allows
// and the token's candidate cells. So в + a form that is only ever dat-or-pre
// (fem `-е`) resolves to prepositional, since в never governs the dative.
const PREP_CASES = {
  без: ['gen'], до: ['gen'], из: ['gen'], 'из-за': ['gen'], 'из-под': ['gen'],
  от: ['gen'], ото: ['gen'], у: ['gen'], для: ['gen'], около: ['gen'], возле: ['gen'],
  вокруг: ['gen'], кроме: ['gen'], среди: ['gen'], против: ['gen'], ради: ['gen'],
  мимо: ['gen'], вместо: ['gen'], сверх: ['gen'], насчёт: ['gen'], позади: ['gen'],
  к: ['dat'], ко: ['dat'],
  над: ['ins'], надо: ['ins'], перед: ['ins'], передо: ['ins'], между: ['ins'],
  о: ['pre'], об: ['pre'], обо: ['pre'], при: ['pre'],
  в: ['acc', 'pre'], во: ['acc', 'pre'], на: ['acc', 'pre'],
  за: ['acc', 'ins'], под: ['acc', 'ins'], подо: ['acc', 'ins'],
  про: ['acc'], через: ['acc'], сквозь: ['acc'],
  с: ['gen', 'ins'], со: ['gen', 'ins'],
};

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

function nounCells(w) {
  return cellsFromFlat(w.declension, /^(sg|pl)_(nom|gen|dat|acc|ins|pre|loc)$/, (m) => ({
    number: m[1], case: m[2],
  }));
}
function adjCells(w) {
  return cellsFromFlat(w.declension, /^(m|n|f|pl)_(nom|gen|dat|acc|ins|pre)$/, (m) => ({
    gender: m[1], case: m[2], number: m[1] === 'pl' ? 'pl' : 'sg',
  }));
}
function verbCells(w) {
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
function pronounCells(w) {
  if (w.declension) return { map: adjCells(w), gendered: true };
  const map = new Map();
  for (const c of ['nom', 'gen', 'dat', 'acc', 'ins', 'pre']) {
    if (!w.forms?.[c]) continue;
    const n = norm(w.forms[c]);
    if (!map.has(n)) map.set(n, []);
    map.get(n).push({ case: c });
  }
  return { map, gendered: false };
}

const PRONOUN_RULE = {
  pers: 'pronoun-personal', refl: 'pronoun-personal',
  poss: 'pronoun-possessive', demo: 'pronoun-demonstrative',
  det: 'pronoun-demonstrative', inter: 'pronoun-interrogative', neg: null,
};

/**
 * Decide the annotation for one usage sentence of `word`, or null.
 * Returns { token (1-based), fields } where fields is the inflect object.
 */
function decide(pos, word, ru) {
  const tokens = tokenize(ru);
  let map, gendered = false, ruleFor, extraFields;
  if (pos === 'noun') {
    map = nounCells(word);
    const decl = word.declension || {};
    ruleFor = (cell) => {
      // Animate accusative (acc syncretic with genitive) gets its own rule.
      if (cell.case === 'acc' && word.animacy === 'a' &&
          norm(decl[`${cell.number}_acc`]) === norm(decl[`${cell.number}_gen`])) {
        return 'noun-acc-animate';
      }
      return `noun-${cell.case}-${cell.number}`;
    };
    extraFields = (cell) => ({ case: cell.case, number: cell.number });
  } else if (pos === 'adjective') {
    map = adjCells(word);
    ruleFor = () => 'adj-agreement';
    extraFields = (cell) => ({ case: cell.case, number: cell.number, gender: cell.gender });
  } else if (pos === 'verb') {
    map = verbCells(word);
    ruleFor = (cell) => `verb-${cell.tense}`;
    extraFields = (cell) => ({ tense: cell.tense, person: cell.person });
  } else if (pos === 'pronoun') {
    const pc = pronounCells(word);
    map = pc.map; gendered = pc.gendered;
    ruleFor = () => PRONOUN_RULE[word.type] ?? null;
    extraFields = (cell) =>
      gendered
        ? { case: cell.case, number: cell.number, gender: cell.gender }
        : { case: cell.case };
  } else {
    return null;
  }
  if (!map || map.size === 0) return null;

  // Candidate tokens: those whose form appears in the paradigm at all.
  const cands = [];
  for (let i = 0; i < tokens.length; i++) {
    const n = norm(core(tokens[i]));
    if (!n) continue;
    const cells = map.get(n);
    if (cells) cands.push({ idx: i, n, cells });
  }
  if (!cands.length) return null;

  const resolved = [];
  for (const c of cands) {
    let cell = null;
    if (c.cells.length === 1) {
      cell = c.cells[0];
    } else if (pos === 'noun' || (pos === 'pronoun' && !gendered)) {
      // Disambiguate by a governing preposition immediately before the token:
      // take the single case shared by what the preposition allows and the
      // token's candidate cells.
      const prev = c.idx > 0 ? norm(core(tokens[c.idx - 1])) : null;
      const allowed = prev ? PREP_CASES[prev] : null;
      if (allowed) {
        const hit = c.cells.filter((x) => allowed.includes(x.case));
        const cases = new Set(hit.map((x) => x.case));
        // Exactly one case must survive, and all its cells must share a number.
        if (cases.size === 1 && hit.every((x) => x.number === hit[0].number)) cell = hit[0];
      }
    }
    if (!cell) continue;
    // Never annotate nominative for nouns/pronouns (dictionary form; no rule).
    if ((pos === 'noun') && cell.case === 'nom') continue;
    if (pos === 'noun' && cell.case === 'loc') continue; // second locative: skip
    if (pos === 'pronoun' && !gendered && cell.case === 'nom') continue;
    resolved.push({ idx: c.idx, cell });
  }
  if (resolved.length !== 1) return null; // 0 or ambiguous → skip

  const { idx, cell } = resolved[0];
  const fields = extraFields(cell);
  const rule = ruleFor(cell);
  return { token: idx + 1, fields, rule };
}

/** Serialize an inflect object in the repo's canonical inline order. */
function serializeInflect(pos, dec) {
  const f = dec.fields;
  const parts = [`token: ${dec.token}`];
  if (pos === 'verb') {
    parts.push(`tense: ${f.tense}`, `person: ${f.person}`);
  } else {
    parts.push(`case: ${f.case}`);
    if (f.number) parts.push(`number: ${f.number}`);
    if (f.gender) parts.push(`gender: ${f.gender}`);
  }
  if (dec.rule) parts.push(`rule: ${dec.rule}`);
  return `        inflect: { ${parts.join(', ')} }`;
}

// ---- driver ----------------------------------------------------------------
import yaml from 'js-yaml';

const FILES = {
  'nouns.yml': 'noun', 'calendar.yml': 'noun', 'verbs.yml': 'verb',
  'adjectives.yml': 'adjective', 'pronouns.yml': 'pronoun',
};

let grand = { added: 0, alreadyOk: 0, skipped: 0, sentences: 0 };
const samples = [];

for (const [file, pos] of Object.entries(FILES)) {
  if (onlyFile && file !== onlyFile) continue;
  const doc = yaml.load(readFileSync(`${dir}/${file}`, 'utf8'));
  const words = doc.words || {};
  const lines = readFileSync(`${dir}/${file}`, 'utf8').split('\n');

  // Walk lines; track current entry key and usage items; compute insertions.
  const inserts = []; // { afterLine, text }
  let curKey = null;
  let inUsage = false;
  let item = null; // { ruLine, ru, lastLine, hasInflect }
  const flush = () => {
    if (!item) return;
    const w = words[curKey];
    if (w && !item.hasInflect && w.learn !== false) {
      grand.sentences++;
      const dec = decide(pos, w, item.ru);
      if (dec) {
        inserts.push({ afterLine: item.lastLine, text: serializeInflect(pos, dec) });
        grand.added++;
        if (samples.length < sampleN) {
          samples.push(`${file}  ${curKey}\n   ${item.ru}\n   → ${serializeInflect(pos, dec).trim()}`);
        }
      } else {
        grand.skipped++;
      }
    } else if (item.hasInflect) {
      grand.alreadyOk++;
    }
    item = null;
  };

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
        item = { ruLine: i, ru, lastLine: i, hasInflect: false };
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
