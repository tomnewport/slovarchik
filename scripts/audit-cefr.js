#!/usr/bin/env node
/**
 * audit-cefr.js
 * Reports the CEFR-level distribution across every vocab YAML file and flags
 * level metadata that looks suspicious, so the labels can be kept honest over
 * time.
 *
 * It is a *reporting* tool — it never edits the YAML. Run it after adding words
 * or re-levelling to sanity-check the spread:
 *
 *   node scripts/audit-cefr.js          # summary + flags
 *   node scripts/audit-cefr.js --list   # also print every flagged entry
 *
 * Three heuristics, none of them gospel — treat every flag as "look at this",
 * not "this is wrong":
 *
 *  1. **Anchors.** A word whose stored level is more than one level away from a
 *     small hand-curated reference of uncontroversial assignments.
 *  2. **Cohorts.** A collection where one level takes ≥70% of ≥10 words. The
 *     recurring failure mode is not a single bad label but a topic pack added
 *     in one go and stamped with a single level regardless of how hard the
 *     individual words are (see #529: 14 of the 18 original `character` words
 *     sat at A1, `харизматичный` and `педантичный` among them). A mislevelled
 *     cohort is invisible in the distribution table — it looks like a
 *     legitimate cluster of easy topical words — so it needs its own check.
 *     Some packs are genuinely uniform (nationalities really are all A2); the
 *     flag asks for a glance, not a re-level.
 *  3. **Shape.** An A1/A2 entry whose headword is very long, or is a
 *     transparent internationalism (`-ичный`/`-альный`/`-ационный`/`-ация`…).
 *     Elementary vocabulary is overwhelmingly short and native, so these are
 *     the tell-tale of a pack stamped on the way in.
 *  4. **Pairs.** Two entries that are one lexical item — a verb and its `pair:`
 *     aspect partner, a masculine noun and its `… (f)` counterpart — sitting at
 *     different levels. A course teaches an aspect pair together, so a split is
 *     usually an accident of when each half was added rather than a judgement
 *     (`уметь` was A1 while `суметь` was B1). A few splits are deliberate:
 *     `полюбить` "to come to love" really is later than `любить`.
 *
 * Gloss-only entries (`learn: false`, i.e. all of glossary.yml) are counted in
 * the distribution but excluded from the cohort and shape checks: they are
 * never served to a learner, and their keys are surface forms rather than
 * dictionary headwords.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { load as yamlLoad } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vocabDir = join(__dirname, '..', 'public', 'vocab');

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const rank = (lvl) => LEVELS.indexOf(lvl);

// Strip the combining acute accent (U+0301) so reference lookups are stress-blind.
export const bare = (s) => s.normalize('NFC').replace(/́/g, '');

// Russian headword of a "<russian>=<english>" natural key.
export const ru = (key) => bare(key.split('=')[0]).toLowerCase();

/** Thresholds for the cohort check. */
export const COHORT_MIN_SIZE = 10;
export const COHORT_SHARE = 0.7;

/** An A1/A2 headword longer than this (in letters, per word) looks over-easy. */
export const MAX_ELEMENTARY_LENGTH = 13;

/**
 * Endings that mark a transparent internationalism. A Russian word built from
 * an international stem is easy to *read* and hard to *need*: it belongs to the
 * register a learner meets well after the elementary core.
 */
export const INTERNATIONALISM = /(ичный|альный|ационный|ивный|[ая]ция|изм|логия)$/;

// ---------------------------------------------------------------------------
// Reference anchors — a *minimal* set of words whose canonical CEFR level is
// not really in dispute. Anything stored more than one level away from its
// anchor gets flagged. This is deliberately small and high-confidence; it is
// not a full lexical minimum.
// ---------------------------------------------------------------------------
export const REFERENCE = {
  // Everyday A1 core
  город: 'A1', дом: 'A1', вода: 'A1', хлеб: 'A1', друг: 'A1', семья: 'A1',
  // Everyday A2 concrete nouns that are easy to over-level
  банк: 'A2', война: 'A2', армия: 'A2', автор: 'A2', герой: 'A2',
  король: 'A2', королева: 'A2', корабль: 'A2', крыша: 'A2', камень: 'A2',
  документ: 'A2', грамматика: 'A2', культура: 'A2', команда: 'A2',
  кровь: 'A2', кость: 'A2', горло: 'A2', грудь: 'A2', колено: 'A2',
  // Clearly specialist / formal B2 vocabulary that is easy to under-level
  авиация: 'B2', дивизия: 'B2', батальон: 'B2', крестьянин: 'B2',
  господь: 'B2', монастырь: 'B2', революция: 'B2', прокурор: 'B2',
  пулемёт: 'B2', интеллигенция: 'B2', династия: 'B2',
  устрица: 'B2', паэлья: 'B2', харизматичный: 'B2', педантичный: 'B2',
};

/**
 * Flatten `{ file: { words } }` documents into audit records:
 * `{ file, key, ru, level, collections, learn }`.
 */
export function collectEntries(docs) {
  const out = [];
  for (const [file, doc] of Object.entries(docs)) {
    for (const [key, entry] of Object.entries(doc?.words ?? {})) {
      out.push({
        file,
        key,
        ru: ru(key),
        en: key.split('=').slice(1).join('=').trim(),
        level: entry?.cefr_level ?? null,
        collections: Array.isArray(entry?.collections) ? entry.collections : [],
        learn: entry?.learn !== false,
        pair: entry?.pair ?? null,
      });
    }
  }
  return out;
}

/** Entries whose level is missing or not one of A1–C2. */
export function invalidLevelFlags(entries) {
  return entries
    .filter((e) => !LEVELS.includes(e.level))
    .map((e) => ({ ...e, why: 'invalid level', level: e.level ?? '(missing)' }));
}

/** Entries stored two or more levels away from their reference anchor. */
export function anchorFlags(entries, reference = REFERENCE) {
  const out = [];
  for (const e of entries) {
    if (!LEVELS.includes(e.level)) continue;
    const want = reference[e.ru];
    if (want && Math.abs(rank(e.level) - rank(want)) >= 2) {
      out.push({ ...e, why: `anchor expects ~${want}` });
    }
  }
  return out;
}

/**
 * Collections where one level dominates: `{ collection, size, level, share,
 * counts }`, worst first. Only learnable words count — gloss-only entries carry
 * no collections anyway, and are not served to a learner.
 */
export function cohortFlags(entries, { minSize = COHORT_MIN_SIZE, share = COHORT_SHARE } = {}) {
  const byCollection = new Map();
  for (const e of entries) {
    if (!e.learn || !LEVELS.includes(e.level)) continue;
    for (const c of e.collections) {
      if (!byCollection.has(c)) byCollection.set(c, Object.fromEntries(LEVELS.map((l) => [l, 0])));
      byCollection.get(c)[e.level] += 1;
    }
  }
  const out = [];
  for (const [collection, counts] of byCollection) {
    const size = LEVELS.reduce((n, l) => n + counts[l], 0);
    if (size < minSize) continue;
    const [level, top] = LEVELS.map((l) => [l, counts[l]]).sort((a, b) => b[1] - a[1])[0];
    if (top / size >= share) out.push({ collection, size, level, share: top / size, counts });
  }
  return out.sort((a, b) => b.share - a.share || b.size - a.size);
}

/** The individual words of a headword key, accent- and hyphen-blind. */
function tokens(headword) {
  return headword.split(/[\s-]+/).filter(Boolean);
}

/**
 * A1/A2 entries that do not look elementary: a very long headword, or a
 * transparent internationalism. Elementary vocabulary is short and native.
 */
export function shapeFlags(entries, { maxLength = MAX_ELEMENTARY_LENGTH } = {}) {
  const out = [];
  for (const e of entries) {
    if (!e.learn) continue;
    if (e.level !== 'A1' && e.level !== 'A2') continue;
    const parts = tokens(e.ru);
    if (parts.length === 0) continue;
    const longest = Math.max(...parts.map((t) => t.length));
    const reasons = [];
    if (longest > maxLength) reasons.push(`${longest} letters`);
    if (parts.some((t) => INTERNATIONALISM.test(t))) reasons.push('internationalism');
    if (reasons.length) out.push({ ...e, why: `not elementary-shaped (${reasons.join(', ')})` });
  }
  return out;
}

/**
 * Two halves of one lexical item stored at different levels: a verb and its
 * `pair:` aspect partner, or a masculine noun and the `… (f)` entry that
 * glosses its feminine counterpart. Returns one row per split pair,
 * widest gap first — `{ file, key, level, partner, partnerLevel, gap, why }`.
 */
export function pairFlags(entries) {
  const byKey = new Map(entries.filter((e) => e.learn).map((e) => [`${e.file}|${e.key}`, e]));
  const byFileEn = new Map();
  for (const e of byKey.values()) {
    const k = `${e.file}|${e.en}`;
    if (!byFileEn.has(k)) byFileEn.set(k, []);
    byFileEn.get(k).push(e);
  }

  const out = [];
  const seen = new Set();
  const add = (a, b, kind) => {
    if (!LEVELS.includes(a.level) || !LEVELS.includes(b.level) || a.level === b.level) return;
    const sig = [`${a.file}|${a.key}`, `${b.file}|${b.key}`].sort().join(' || ');
    if (seen.has(sig)) return;
    seen.add(sig);
    // Report the higher-levelled half: that is the one a learner cannot reach.
    const [lo, hi] = rank(a.level) < rank(b.level) ? [a, b] : [b, a];
    out.push({
      ...hi,
      partner: lo.key,
      partnerLevel: lo.level,
      gap: rank(hi.level) - rank(lo.level),
      why: `${kind} partner ${lo.key} is ${lo.level}`,
    });
  };

  for (const e of byKey.values()) {
    if (e.pair) {
      const partner = byKey.get(`${e.file}|${e.pair}`);
      if (partner) add(e, partner, 'aspect');
    }
    const feminine = e.en.match(/^(.*) \(f\)$/);
    if (feminine) for (const base of byFileEn.get(`${e.file}|${feminine[1]}`) ?? []) add(e, base, 'gender');
  }
  return out.sort((a, b) => b.gap - a.gap || a.key.localeCompare(b.key));
}

/** The vocab directory this script reports on. */
export const VOCAB_DIR = vocabDir;

/** Parse every `*.yml` in `dir` into `{ filename: document }`. */
export function loadDocs(dir = vocabDir) {
  const docs = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
    docs[file] = yamlLoad(readFileSync(join(dir, file), 'utf8'));
  }
  return docs;
}

function main() {
  const entries = collectEntries(loadDocs(vocabDir));
  const files = [...new Set(entries.map((e) => e.file))].sort();

  console.log('CEFR distribution by file');
  console.log('-'.repeat(72));
  console.log(['file'.padEnd(20), ...LEVELS.map((l) => l.padStart(6)), 'total'.padStart(7)].join(''));

  const totals = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  const learnable = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  let grand = 0;
  let grandLearnable = 0;

  for (const file of files) {
    const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
    let n = 0;
    for (const e of entries.filter((x) => x.file === file)) {
      if (!LEVELS.includes(e.level)) continue;
      counts[e.level] += 1;
      totals[e.level] += 1;
      n += 1;
      grand += 1;
      if (e.learn) {
        learnable[e.level] += 1;
        grandLearnable += 1;
      }
    }
    console.log([file.padEnd(20), ...LEVELS.map((l) => String(counts[l]).padStart(6)), String(n).padStart(7)].join(''));
  }

  console.log('-'.repeat(72));
  console.log(['TOTAL'.padEnd(20), ...LEVELS.map((l) => String(totals[l]).padStart(6)), String(grand).padStart(7)].join(''));
  console.log(['learnable'.padEnd(20), ...LEVELS.map((l) => String(learnable[l]).padStart(6)), String(grandLearnable).padStart(7)].join(''));

  console.log('\nShare of the learnable corpus by level (gloss-only entries excluded)');
  for (const l of LEVELS) {
    const pct = grandLearnable ? ((learnable[l] / grandLearnable) * 100).toFixed(1) : '0.0';
    console.log(`  ${l}: ${String(learnable[l]).padStart(5)}  (${pct}%)`);
  }

  const cohorts = cohortFlags(entries);
  console.log(
    `\nCollections dominated by one level (≥${COHORT_MIN_SIZE} words, ≥${Math.round(COHORT_SHARE * 100)}% at one level): ${cohorts.length}`,
  );
  for (const c of cohorts) {
    const spread = LEVELS.filter((l) => c.counts[l]).map((l) => `${l}:${c.counts[l]}`).join(' ');
    console.log(`  ${c.collection.padEnd(28)} ${String(Math.round(c.share * 100)).padStart(3)}% ${c.level}  n=${String(c.size).padStart(4)}   ${spread}`);
  }

  const flagged = [
    ...invalidLevelFlags(entries),
    ...anchorFlags(entries),
    ...shapeFlags(entries),
    ...pairFlags(entries),
  ];
  console.log(`\nFlagged entries: ${flagged.length}`);
  if (flagged.length && process.argv.includes('--list')) {
    for (const f of flagged) console.log(`  [${f.file}] ${f.key}  has ${f.level}, ${f.why}`);
  } else if (flagged.length) {
    console.log('  (run with --list to see them)');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
