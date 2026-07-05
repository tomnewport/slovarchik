#!/usr/bin/env node
/**
 * insert-usage-batch.mjs — append hand-authored usage examples to verbs.yml
 * from a TSV, validating each before inserting.
 *
 * TSV columns (tab-separated, no header): key <TAB> person <TAB> token <TAB> ru <TAB> en
 *   person: 2sg | 2pl (present, or future for perfectives)
 *   token:  1-based index of the conjugated verb in `ru`
 *
 * Rejects (does not insert, prints ERROR) any row whose token doesn't point at
 * the verb's stored present/future form for that person, so a mis-counted token
 * can't slip in. Run: node scripts/insert-usage-batch.mjs <batch.tsv>
 */
import { readFileSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';

const norm = (s) => String(s ?? '').replace(/́/g, '').trim().toLowerCase().replace(/ё/g, 'е');
const core = (t) => String(t ?? '').replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '');
const tokenize = (ru) => String(ru ?? '').trim().split(/\s+/).filter(Boolean);

const tsv = process.argv[2];
if (!tsv) { console.error('usage: insert-usage-batch.mjs <batch.tsv>'); process.exit(1); }

const p = 'public/vocab/verbs.yml';
let lines = readFileSync(p, 'utf8').split('\n');
const doc = yaml.load(readFileSync(p, 'utf8'));

const rows = readFileSync(tsv, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => l.split('\t'));

let ok = 0; const errors = []; const seen = new Set();
const additions = []; // {key, block}
for (const [key, person, tokStr, ru, en] of rows) {
  const w = doc.words?.[key];
  if (!w) { errors.push(`no such verb: ${key}`); continue; }
  const p2 = person === '2pl' ? '2pl' : '2sg';
  const stored = w.conjugation?.present?.[p2] ?? w.conjugation?.future?.[p2];
  if (!stored) { errors.push(`${key}: no ${p2} form`); continue; }
  const tokens = tokenize(ru);
  const idx = Number(tokStr) - 1;
  const got = tokens[idx];
  if (norm(core(got)) !== norm(stored)) {
    errors.push(`${key}: token ${tokStr} is «${got}», expected «${stored}» — «${ru}»`);
    continue;
  }
  if (seen.has(ru)) { errors.push(`duplicate ru: ${ru}`); continue; }
  seen.add(ru);
  const tense = w.conjugation?.present?.[p2] ? 'present' : 'future';
  additions.push({ key, block: [
    `      - ru: ${ru}`,
    `        en_gb: ${en}`,
    `        inflect: { token: ${tokStr}, tense: ${tense}, person: ${p2}, rule: verb-${tense} }`,
  ] });
  ok++;
}

if (errors.length) {
  console.error(`\n${errors.length} ERRORS (nothing written):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

// insert (bottom-to-top by entry line so indices stay valid)
const withIdx = additions.map((a) => ({ a, i: lines.findIndex((l) => l === `  "${a.key}":`) }))
  .sort((x, y) => y.i - x.i);
for (const { a, i } of withIdx) {
  let end = lines.length;
  for (let j = i + 1; j < lines.length; j++) if (/^  "/.test(lines[j])) { end = j; break; }
  const urel = lines.slice(i, end).findIndex((l) => /^ {4}usage:\s*$/.test(l));
  let k = i + urel + 1;
  while (k < end && /^ {6}/.test(lines[k])) k++;
  lines.splice(k, 0, ...a.block);
}
writeFileSync(p, lines.join('\n'));
console.log(`inserted ${ok} examples`);
