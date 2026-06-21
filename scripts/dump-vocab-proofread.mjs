#!/usr/bin/env node
/**
 * dump-vocab-proofread.mjs
 *
 * Flattens every Russian-bearing line in the vocab YAML into a proofreading
 * file, preserving the real <file>:<lineno> so any flagged line traces straight
 * back to source. Two sections:
 *   HEADWORDS — "<key>"  → accented form  | english
 *   PHRASES   — usage `ru:` sentence      | english (deduped, first ref kept)
 *
 * Run: node scripts/dump-vocab-proofread.mjs > proofread-dump.txt
 */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vocabDir = join(__dirname, '..', 'public', 'vocab');

const files = readdirSync(vocabDir)
  .filter((f) => f.endsWith('.yml'))
  .sort();

const headwords = [];
const phrases = [];
const seenPhrase = new Set();

for (const file of files) {
  const lines = readFileSync(join(vocabDir, file), 'utf8').split('\n');
  let curKey = null;
  let curAccented = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const num = i + 1;

    // entry key:  ^  "<ru>=<en>":
    const km = ln.match(/^ {2}"([^"]+)":\s*$/);
    if (km) {
      curKey = km[1];
      curAccented = null;
      continue;
    }
    // accented within the current entry
    const am = ln.match(/^ {4}accented:\s*"?([^"#]+?)"?\s*$/);
    if (am && curKey) {
      curAccented = am[1].trim();
      const en = curKey.includes('=') ? curKey.slice(curKey.indexOf('=') + 1) : '';
      headwords.push({ ref: `${file}:${num}`, ru: curAccented, en, key: curKey });
      continue;
    }
    // usage phrase:  ^      - ru: <text>     (en_gb on a following line)
    const pm = ln.match(/^\s*-?\s*ru:\s*(.+?)\s*$/);
    if (pm) {
      let ru = pm[1].trim();
      // strip surrounding quotes if present
      if ((ru.startsWith('"') && ru.endsWith('"')) || (ru.startsWith("'") && ru.endsWith("'"))) {
        ru = ru.slice(1, -1);
      }
      // find the en_gb on one of the next couple of lines
      let en = '';
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const em = lines[j].match(/^\s*en_gb:\s*(.+?)\s*$/);
        if (em) {
          en = em[1].replace(/^["']|["']$/g, '').trim();
          break;
        }
      }
      if (!seenPhrase.has(ru)) {
        seenPhrase.add(ru);
        phrases.push({ ref: `${file}:${num}`, ru, en });
      }
      continue;
    }
  }
}

const out = [];
out.push(`# HEADWORDS (${headwords.length})`);
for (const h of headwords) out.push(`${h.ref}\t${h.ru}\t| ${h.en}`);
out.push('');
out.push(`# PHRASES (${phrases.length} unique)`);
for (const p of phrases) out.push(`${p.ref}\t${p.ru}\t| ${p.en}`);
process.stdout.write(out.join('\n') + '\n');
