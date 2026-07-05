#!/usr/bin/env node
/**
 * gen-2nd-person-usage.mjs — propose 2nd-person (ты / вы) usage examples to
 * balance the verb drill, which is heavily past/3rd-person (issue #325).
 *
 * Method: person-shift. For each verb, take an existing usage sentence, keep
 * the (already gloss-covered) complement after the verb, and rebuild it as
 * «Ты <2sg> …?» and «Вы <2pl> …?» using the exact form from the conjugation
 * table. Object case is unaffected by subject person, so the complement stays
 * correct; vocabulary stays covered.
 *
 * Output is a review file (key \t person \t token \t ru \t en \t SOURCE). Nothing
 * is written to the vocab. `--apply <file>` (separate step) consumes the
 * curated file.
 */
import { readFileSync } from 'fs';
import yaml from 'js-yaml';

const norm = (s) => String(s ?? '').replace(/́/g, '').trim().toLowerCase().replace(/ё/g, 'е');
const core = (t) => String(t ?? '').replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '');
const tokenize = (ru) => String(ru ?? '').trim().split(/\s+/).filter(Boolean);

// Verbs where a «ты/вы» subject is unidiomatic: impersonals, experiencers,
// statives, natural-phenomenon and positional/emission verbs. Skip.
const SKIP = new Set([
  'быть', 'мочь', 'хотеть', 'хотеться', 'нравиться', 'казаться', 'требоваться',
  'удаваться', 'случаться', 'случиться', 'происходить', 'произойти', 'существовать',
  'являться', 'значить', 'зависеть', 'принадлежать', 'состоять', 'находиться',
  'выглядеть', 'иметься', 'иметь', 'весить', 'стоить', 'наступать', 'наступить',
  'светать', 'темнеть', 'смеркаться', 'везти', 'бывать',
  // statives / positional / emission / natural phenomena (subject is a thing)
  'блестеть', 'блеснуть', 'сиять', 'светиться', 'гореть', 'висеть', 'лежать',
  'стоять', 'сидеть', 'расти', 'вырасти', 'цвести', 'течь', 'дуть', 'дрожать',
  'трястись', 'звучать', 'звенеть', 'пахнуть', 'кипеть', 'таять', 'бить',
  'биться', 'шуметь', 'мелькнуть', 'мелькать', 'валить', 'валиться', 'валяться',
  'литься', 'вспыхнуть', 'гудеть', 'капать', 'падать', 'упасть', 'рухнуть',
  'дуться', 'светить', 'сверкать', 'мерцать', 'колыхаться', 'шелестеть',
]);
// Object/experiencer pronouns in a tail create broken reference after the shift.
const BAD_TAIL_WORD = new Set([
  'тебя́', 'тебе́', 'его́', 'её', 'их', 'меня́', 'мне', 'нас', 'вас', 'нам', 'вам',
  'себя́', 'себе́', 'собо́й', 'им', 'ей', 'ему́', 'мной', 'тобо́й',
]);

const doc = yaml.load(readFileSync('public/vocab/verbs.yml', 'utf8'));

function twoForms(w) {
  const c = w.conjugation || {};
  const src = c.present || c.future || {};
  return { sg: src['2sg'], pl: src['2pl'] };
}
function finiteForms(w) {
  const c = w.conjugation || {};
  const s = new Set();
  for (const t of ['present', 'future']) if (c[t]) for (const f of Object.values(c[t])) s.add(norm(f));
  for (const p of ['past_m', 'past_f', 'past_n', 'past_pl']) if (c[p]) s.add(norm(c[p]));
  return s;
}

const BAD_TAIL = /^(бы|бу́ду|бу́дешь|бу́дет|за́втра|ско́ро|ра́ньше|вчера́|сейча́с)$/i;

const rows = [];
for (const [key, w] of Object.entries(doc.words || {})) {
  const lemma = key.split('=')[0];
  if (SKIP.has(lemma)) continue;
  const { sg, pl } = twoForms(w);
  if (!sg && !pl) continue;
  const forms = finiteForms(w);

  // best source sentence: a plain present/past with a short complement.
  let best = null;
  for (const u of w.usage || []) {
    const ts = tokenize(u.ru);
    if (ts.some((t) => BAD_TAIL.test(t))) continue;
    const vi = ts.findIndex((t) => forms.has(norm(core(t))));
    if (vi < 0 || vi === ts.length - 1) continue;
    const tail = ts.slice(vi + 1);
    if (tail.length < 1 || tail.length > 4) continue;
    // tail must not reintroduce a subject or object/experiencer pronoun
    if (tail.some((t) => /^(я|ты|вы|он|она́|мы|они́|э́то)$/i.test(core(t)) || BAD_TAIL_WORD.has(core(t)))) continue;
    // prefer a real object: tail should start with a noun/adj, not an adverb clause
    if (!best || tail.length < best.tail.length) best = { tail, en: u.en_gb };
  }
  if (!best) continue;
  const tailRu = best.tail.join(' ').replace(/[.!?]+$/, '');
  const en = String(w.en_gb?.standard || w.en_gb || '').split('(')[0].trim();
  rows.push([key, w.cefr_level || '', sg || '-', pl || '-', tailRu, en, best.en].join('\t'));
}

console.error(`# ${rows.length} verb worksheets`);
process.stdout.write('key\tcefr\t2sg\t2pl\tobject\tverb_en\tsource_en\n' + rows.join('\n') + '\n');
