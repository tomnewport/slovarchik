#!/usr/bin/env node
/**
 * audit-cefr.js
 * Reports the CEFR-level distribution across every vocab YAML file and flags
 * entries whose level looks suspicious, so the level metadata can be kept honest
 * over time.
 *
 * It is a *reporting* tool — it never edits the YAML. Run it after adding words
 * or re-levelling to sanity-check the spread:
 *
 *   node scripts/audit-cefr.js          # summary + flags
 *   node scripts/audit-cefr.js --list   # also print every flagged entry
 *
 * The "flags" are heuristics, not gospel: a word lands in the report when its
 * stored level disagrees with a small, hand-curated reference of canonical
 * level assignments (the everyday A1–A2 core and the clearly specialist B2+
 * vocabulary). Treat each flag as "look at this", not "this is wrong".
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vocabDir = join(__dirname, '..', 'public', 'vocab');

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const rank = (lvl) => LEVELS.indexOf(lvl);

// Strip the combining acute accent (U+0301) so reference lookups are stress-blind.
const bare = (s) => s.normalize('NFC').replace(/́/g, '');

// Russian headword of a "<russian>=<english>" natural key.
const ru = (key) => bare(key.split('=')[0]).toLowerCase();

// ---------------------------------------------------------------------------
// Reference anchors — a *minimal* set of words whose canonical CEFR level is
// not really in dispute. Anything stored more than one level away from its
// anchor gets flagged. This is deliberately small and high-confidence; it is
// not a full lexical minimum.
// ---------------------------------------------------------------------------
const REFERENCE = {
  // Everyday A1 core
  город: 'A1', дом: 'A1', вода: 'A1', хлеб: 'A1', друг: 'A1', семья: 'A1',
  // Everyday A2 concrete nouns that are easy to over-level
  банк: 'A2', война: 'A2', армия: 'A2', автор: 'A2', герой: 'A2',
  король: 'A2', королева: 'A2', корабль: 'A2', крыша: 'A2', камень: 'A2',
  документ: 'A2', грамматика: 'A2', культура: 'A2', команда: 'A2',
  кровь: 'A2', кость: 'A2', горло: 'A2', грудь: 'A2', колено: 'A2',
  // Clearly specialist / formal B2 vocabulary
  авиация: 'B2', дивизия: 'B2', батальон: 'B2', крестьянин: 'B2',
  господь: 'B2', монастырь: 'B2', революция: 'B2', прокурор: 'B2',
  пулемёт: 'B2', интеллигенция: 'B2', династия: 'B2',
};

function loadWords(file) {
  const doc = yamlLoad(readFileSync(join(vocabDir, file), 'utf8'));
  return doc && doc.words ? doc.words : {};
}

const files = readdirSync(vocabDir).filter((f) => f.endsWith('.yml'));

const totals = Object.fromEntries(LEVELS.map((l) => [l, 0]));
const flagged = [];
let grand = 0;

console.log('CEFR distribution by file');
console.log('-'.repeat(72));
console.log(['file'.padEnd(20), ...LEVELS.map((l) => l.padStart(6)), 'total'.padStart(7)].join(''));

for (const file of files) {
  const words = loadWords(file);
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  let n = 0;
  for (const [key, entry] of Object.entries(words)) {
    const lvl = entry && entry.cefr_level;
    if (!LEVELS.includes(lvl)) {
      flagged.push({ file, key, lvl: lvl ?? '(missing)', want: 'A1–C2', why: 'invalid level' });
      continue;
    }
    counts[lvl] += 1;
    totals[lvl] += 1;
    n += 1;
    grand += 1;
    const want = REFERENCE[ru(key)];
    if (want && Math.abs(rank(lvl) - rank(want)) >= 2) {
      flagged.push({ file, key, lvl, want, why: `anchor expects ~${want}` });
    }
  }
  console.log([file.padEnd(20), ...LEVELS.map((l) => String(counts[l]).padStart(6)), String(n).padStart(7)].join(''));
}

console.log('-'.repeat(72));
console.log(['TOTAL'.padEnd(20), ...LEVELS.map((l) => String(totals[l]).padStart(6)), String(grand).padStart(7)].join(''));

console.log('\nShare of corpus by level');
for (const l of LEVELS) {
  const pct = grand ? ((totals[l] / grand) * 100).toFixed(1) : '0.0';
  console.log(`  ${l}: ${String(totals[l]).padStart(5)}  (${pct}%)`);
}

console.log(`\nFlagged entries: ${flagged.length}`);
if (flagged.length && process.argv.includes('--list')) {
  for (const f of flagged) {
    console.log(`  [${f.file}] ${f.key}  has ${f.lvl}, ${f.why}`);
  }
} else if (flagged.length) {
  console.log('  (run with --list to see them)');
}
