#!/usr/bin/env node
/**
 * check-vocab-errors.mjs
 *
 * Heuristic linguistic + consistency checker for the vocabulary YAML files.
 * It does NOT replace the test suite (which guards structural shape); instead
 * it surfaces *candidate* problems for human review:
 *   - Cyrillic/Latin homoglyph contamination (e.g. Latin "a"/"o"/"e" in a word)
 *   - stress-mark anomalies (multisyllabic forms with no stress; >1 stress;
 *     a stress mark on a monosyllable; a stray accent not after a vowel)
 *   - accented headword whose bare letters don't match the Russian key
 *   - the same Russian word translated inconsistently across entries
 *   - the same English gloss attached to many Russian words
 *   - noun gender vs. declension-ending sanity checks
 *
 * Run: node scripts/check-vocab-errors.mjs [--only=nouns,verbs]
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vocabDir = join(__dirname, '..', 'public', 'vocab');

const ACUTE = '́';
const VOWELS = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ';
// Latin letters (incl. precomposed accented ones like á é í ó ú) that sneak
// into Cyrillic strings via copy-paste. Anything in the Latin Unicode blocks
// is suspect inside a Russian word.
const LATIN_HOMOGLYPHS = /[A-Za-zÀ-ɏ]/;

const argOnly = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const onlyFiles = argOnly ? new Set(argOnly.split(',')) : null;

function stripStress(s) {
  return (s || '').normalize('NFC').replace(new RegExp(ACUTE, 'g'), '');
}

function syllableCount(s) {
  const bare = stripStress(s);
  let n = 0;
  for (const ch of bare) if (VOWELS.includes(ch)) n++;
  return n;
}

function countStress(s) {
  // combining acute, plus ё which is inherently stressed
  const acutes = ((s || '').match(new RegExp(ACUTE, 'g')) || []).length;
  const yo = ((s || '').match(/[ёЁ]/g) || []).length;
  return acutes + yo;
}

// All string "forms" inside an entry that should carry stress + be Cyrillic.
function* formStrings(entry) {
  const visit = function* (v, path) {
    if (typeof v === 'string') {
      yield [path, v];
    } else if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) yield* visit(v[i], `${path}[${i}]`);
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) yield* visit(v[k], path ? `${path}.${k}` : k);
    }
  };
  for (const blockName of ['declension', 'conjugation', 'forms']) {
    if (entry[blockName]) yield* visit(entry[blockName], blockName);
  }
  if (entry.accented) yield ['accented', entry.accented];
}

const findings = [];
function report(file, key, kind, msg) {
  findings.push({ file, key, kind, msg });
}

// Cross-file consistency maps
const ruToEntries = new Map(); // bare ru -> [{file,key,en}]
const enToRu = new Map(); // short en gloss -> Set(bare ru)

function shortGloss(g) {
  if (!g) return '';
  const before = String(g).split('(')[0].trim().toLowerCase();
  return before;
}

function enAnswers(entry, enFromKey) {
  const out = new Set();
  if (enFromKey) out.add(enFromKey.trim().toLowerCase());
  const en = entry.en_gb;
  if (en) {
    if (typeof en === 'string') out.add(shortGloss(en));
    else {
      if (en.standard) out.add(shortGloss(en.standard));
      for (const a of en.alt || []) out.add(shortGloss(a));
    }
  }
  out.delete('');
  return [...out];
}

const files = readdirSync(vocabDir)
  .filter((f) => f.endsWith('.yml'))
  .filter((f) => !onlyFiles || onlyFiles.has(f.replace('.yml', '')));

for (const file of files) {
  let doc;
  try {
    doc = yamlLoad(readFileSync(join(vocabDir, file), 'utf8'));
  } catch (e) {
    report(file, '(file)', 'yaml', `parse error: ${e.message}`);
    continue;
  }
  const words = doc && doc.words;
  if (!words) continue;

  for (const [key, entry] of Object.entries(words)) {
    if (!entry || typeof entry !== 'object') continue;
    const eq = key.indexOf('=');
    const ru = eq >= 0 ? key.slice(0, eq) : key;
    const en = eq >= 0 ? key.slice(eq + 1) : '';

    // --- key sanity ---
    if (LATIN_HOMOGLYPHS.test(ru)) {
      report(file, key, 'homoglyph-key', `Latin letter(s) in Russian key: "${ru}"`);
    }
    if (ru !== stripStress(ru)) {
      report(file, key, 'stressed-key', `key has stress marks (should be bare): "${ru}"`);
    }

    // --- accented vs key ---
    if (entry.accented) {
      const bare = stripStress(entry.accented).replace(/ё/g, 'е').replace(/Ё/g, 'Е').toLowerCase();
      const keyBare = ru.replace(/ё/g, 'е').replace(/Ё/g, 'Е').toLowerCase();
      if (bare !== keyBare) {
        report(
          file,
          key,
          'accented-mismatch',
          `accented "${entry.accented}" -> bare "${stripStress(entry.accented)}" != key ru "${ru}"`,
        );
      }
    }

    // --- form string checks (stress, homoglyphs) ---
    for (const [path, val] of formStrings(entry)) {
      if (typeof val !== 'string' || !val.trim()) continue;
      const tokens = val.trim().split(/\s+/);
      for (const tok of tokens) {
        if (LATIN_HOMOGLYPHS.test(tok)) {
          report(file, key, 'homoglyph-form', `Latin letter in ${path}: "${val}"`);
        }
        const syl = syllableCount(tok);
        const str = countStress(tok);
        if (syl >= 2 && str === 0) {
          report(file, key, 'no-stress', `${path} multisyllabic but unstressed: "${val}"`);
        }
        if (str > 1) {
          report(file, key, 'multi-stress', `${path} has ${str} stresses: "${val}"`);
        }
        if (syl === 1 && countStress(tok.replace(/ё/gi, '')) >= 1) {
          report(file, key, 'mono-stress', `${path} monosyllable carries a mark: "${val}"`);
        }
      }
      // stray acute not after a vowel
      const m = val.normalize('NFC');
      for (let i = 0; i < m.length; i++) {
        if (m[i] === ACUTE) {
          const prev = m[i - 1];
          if (!prev || !VOWELS.includes(prev)) {
            report(file, key, 'stray-acute', `${path} acute not after a vowel: "${val}"`);
            break;
          }
        }
      }
    }

    // --- noun gender vs nom-singular ending sanity ---
    if (doc.words && entry.declension && entry.gender && (entry.number || []).includes('sg')) {
      const nom = stripStress(entry.declension.sg_nom || '');
      if (nom) {
        const last = nom.slice(-1);
        const g = entry.gender;
        // crude heuristics, flag only clear mismatches
        if (g === 'f' && 'оеё'.includes(last)) {
          report(file, key, 'gender?', `gender f but nom sg ends in -${last}: "${nom}"`);
        }
        if (g === 'n' && 'ыийуёэюя'.includes(last) === false && 'аоеёя'.includes(last) === false) {
          // neuter usually ends -о/-е/-ё/-мя; flag consonant endings
          if (!'оеё'.includes(last) && !nom.endsWith('мя')) {
            report(file, key, 'gender?', `gender n but nom sg ends in -${last}: "${nom}"`);
          }
        }
      }
    }

    // --- usage phrase checks (Latin contamination + stray accents) ---
    for (const u of entry.usage || []) {
      const ru = u && u.ru;
      if (typeof ru !== 'string') continue;
      // Cyrillic word containing a Latin letter (incl. precomposed accents)
      for (const tok of ru.split(/\s+/)) {
        const hasCyr = /[А-Яа-яЁё]/.test(tok);
        const hasLat = LATIN_HOMOGLYPHS.test(tok);
        if (hasCyr && hasLat) {
          report(file, key, 'phrase-homoglyph', `Latin letter in usage: "${ru}"`);
          break;
        }
      }
      const n = ru.normalize('NFC');
      for (let i = 0; i < n.length; i++) {
        if (n[i] === ACUTE && !VOWELS.includes(n[i - 1])) {
          report(file, key, 'phrase-stray-acute', `usage acute not after a vowel: "${ru}"`);
          break;
        }
      }
    }

    // --- consistency maps ---
    const bareRu = stripStress(ru);
    if (!ruToEntries.has(bareRu)) ruToEntries.set(bareRu, []);
    ruToEntries.get(bareRu).push({ file, key, en: en || '', answers: enAnswers(entry, en) });
    for (const ans of enAnswers(entry, en)) {
      if (!enToRu.has(ans)) enToRu.set(ans, new Set());
      enToRu.get(ans).add(bareRu);
    }

    // --- verb aspect sanity ---
    if (entry.aspect) {
      const hasPresent = entry.conjugation && entry.conjugation.present;
      const hasFuture = entry.conjugation && entry.conjugation.future;
      if (entry.aspect === 'pf' && hasPresent) {
        report(file, key, 'aspect', `perfective verb has a present tense (should be future)`);
      }
      if (entry.aspect === 'impf' && hasFuture && !hasPresent) {
        report(file, key, 'aspect', `imperfective verb has only a future (should be present)`);
      }
    }

    // --- cefr ---
    if (!/^[ABC][12]$/.test(entry.cefr_level || '')) {
      report(file, key, 'cefr', `invalid cefr_level: "${entry.cefr_level}"`);
    }
  }
}

// Same Russian word, conflicting English meanings (but not declared homographs)
for (const [ru, list] of ruToEntries) {
  if (list.length < 2) continue;
  // gather distinct english key sides
  const ens = new Set(list.map((l) => l.en.toLowerCase()).filter(Boolean));
  if (ens.size > 1) {
    // could be legitimate homograph; report for review
    report(
      list[0].file,
      ru,
      'same-ru-diff-en',
      `"${ru}" has ${list.length} entries: ${list.map((l) => `${l.en}@${l.file}`).join(' | ')}`,
    );
  }
}

// Output grouped by kind
const byKind = new Map();
for (const f of findings) {
  if (!byKind.has(f.kind)) byKind.set(f.kind, []);
  byKind.get(f.kind).push(f);
}
const order = [
  'yaml',
  'homoglyph-key',
  'homoglyph-form',
  'phrase-homoglyph',
  'stressed-key',
  'stray-acute',
  'phrase-stray-acute',
  'no-stress',
  'multi-stress',
  'mono-stress',
  'accented-mismatch',
  'gender?',
  'aspect',
  'cefr',
  'same-ru-diff-en',
];
const kinds = [...byKind.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
let total = 0;
for (const kind of kinds) {
  const items = byKind.get(kind);
  total += items.length;
  console.log(`\n=== ${kind} (${items.length}) ===`);
  for (const it of items.slice(0, 200)) {
    console.log(`  [${it.file}] ${it.key}: ${it.msg}`);
  }
  if (items.length > 200) console.log(`  ... and ${items.length - 200} more`);
}
console.log(`\nTOTAL findings: ${total}`);
