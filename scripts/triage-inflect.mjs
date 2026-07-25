#!/usr/bin/env node
/**
 * triage-inflect.mjs — turn the 4,000-odd usage sentences that
 * `annotate-inflect.mjs` skips into a mechanical worklist for hand-annotation
 * (issue #359).
 *
 * The auto-annotator only adds an `inflect:` annotation when the slot is
 * provable; everything else it silently skips, mixing three populations:
 * legitimately-unannotatable nominative subjects, sentences with no matching
 * paradigm cell, and syncretic forms a human can pin from the syntax. This tool
 * sorts that pile by *why* each sentence was skipped, and — for the buckets a
 * human can resolve — proposes a candidate annotation to confirm rather than
 * invent.
 *
 * IMPORTANT: `phrasesData.test.js` only checks that an annotated token's form
 * matches the stored form for the *declared* slot. Because the whole skipped set
 * is skipped precisely because the form is syncretic across cells (кни́ге = dat
 * or pre; дру́га = gen or animate acc), a wrong-but-syncretic case call passes
 * CI. `--verify` is the compensating check: it independently re-derives the case
 * for already-annotated sentences and flags contradictions.
 *
 * Modes (exactly one):
 *   --report            counts by bucket, then file×bucket and CEFR×hand-bucket
 *   --suggest           per-sentence candidate annotations for the hand buckets
 *   --verify            re-derive the case of existing annotations, flag clashes
 *
 * Filters (report/suggest): --file <name>  --cefr <A1|A2|…>  --bucket <name>
 *   --limit <N>  (default 40 listed sentences; --limit 0 = no cap)
 */
import {
  FILES, loadVocabFile, parseUsageItems, analyze, serializeInflect,
  norm, core, tokenize, PREP_CASES,
} from './annotate-inflect.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => (has(f) ? args[args.indexOf(f) + 1] : d);

const MODE = has('--verify') ? 'verify' : has('--suggest') ? 'suggest' : 'report';
const onlyFile = val('--file');
const onlyCefr = val('--cefr');
const onlyBucket = val('--bucket');
const limit = has('--limit') ? Number(val('--limit')) : 40;

// Bucket groups drive how the report is organized and which buckets --suggest
// can propose a concrete annotation for.
const GROUPS = {
  annotatable: ['single-cell', 'prep-pinned'],
  // The inventory #359 targets: one bucket per kind of case call a human confirms.
  hand: ['accusative-object', 'prep-governed', 'number-only'],
  leave: [
    'nominative-subject', 'genuinely-ambiguous', 'multi-token-ambiguous',
    'no-matching-cell', 'no-paradigm', 'unsupported-pos',
  ],
};
const cefrOf = (w) => w.cefr_level || w.cefr || 'none';

/**
 * Iterate unannotated, learnable usage sentences across all vocab files,
 * yielding { file, pos, key, word, ru, item, a } where `a` is analyze()'s
 * classification. Honors --file.
 */
function* eachUnannotated() {
  for (const [file, pos] of Object.entries(FILES)) {
    if (onlyFile && file !== onlyFile) continue;
    const { words, lines } = loadVocabFile(file);
    for (const item of parseUsageItems(lines)) {
      const word = words[item.key];
      if (!word || item.hasInflect || word.learn === false) continue;
      yield { file, pos, key: item.key, word, ru: item.ru, item, a: analyze(pos, word, item.ru) };
    }
  }
}

/** Pad a string to width for aligned columns. */
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

// ---------------------------------------------------------------------------
function report() {
  const byBucket = new Map();
  const byFileBucket = new Map(); // `${file}\t${bucket}` -> n
  const byCefrHand = new Map(); // `${cefr}\t${bucket}` -> n  (hand buckets only)
  let total = 0;

  for (const { file, word, a } of eachUnannotated()) {
    total++;
    byBucket.set(a.bucket, (byBucket.get(a.bucket) || 0) + 1);
    const fk = `${file}\t${a.bucket}`;
    byFileBucket.set(fk, (byFileBucket.get(fk) || 0) + 1);
    if (GROUPS.hand.includes(a.bucket)) {
      const ck = `${cefrOf(word)}\t${a.bucket}`;
      byCefrHand.set(ck, (byCefrHand.get(ck) || 0) + 1);
    }
  }

  console.log(`=== Triage: ${total} unannotated learnable usage sentences ===\n`);

  for (const [group, label] of [
    ['annotatable', 'ANNOTATABLE (annotate-inflect.mjs --apply already adds these)'],
    ['hand', 'HAND-ANNOTATABLE (the inventory #359 targets — `--suggest` proposes candidates)'],
    ['leave', 'LEAVE / OUT OF SCOPE (nominative subjects, no cell, genuinely ambiguous)'],
  ]) {
    console.log(label);
    const rows = GROUPS[group]
      .map((b) => [b, byBucket.get(b) || 0])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    for (const [b, n] of rows) console.log(`  ${pad(b, 24)} ${rpad(n, 6)}`);
    const sub = rows.reduce((s, [, n]) => s + n, 0);
    console.log(`  ${pad('— subtotal', 24)} ${rpad(sub, 6)}\n`);
  }

  console.log('Hand buckets by file:');
  for (const file of Object.keys(FILES)) {
    if (onlyFile && file !== onlyFile) continue;
    const parts = GROUPS.hand
      .map((b) => [b, byFileBucket.get(`${file}\t${b}`) || 0])
      .filter(([, n]) => n > 0)
      .map(([b, n]) => `${b}=${n}`);
    if (parts.length) console.log(`  ${pad(file, 16)} ${parts.join('  ')}`);
  }

  console.log('\nHand buckets by CEFR level (chunk your PRs from the top down):');
  const cefrs = [...new Set([...byCefrHand.keys()].map((k) => k.split('\t')[0]))].sort();
  for (const cefr of cefrs) {
    const parts = GROUPS.hand
      .map((b) => [b, byCefrHand.get(`${cefr}\t${b}`) || 0])
      .filter(([, n]) => n > 0)
      .map(([b, n]) => `${b}=${n}`);
    if (parts.length) console.log(`  ${pad(cefr, 6)} ${parts.join('  ')}`);
  }
}

// ---------------------------------------------------------------------------
function suggest() {
  const wantBuckets = onlyBucket ? [onlyBucket] : GROUPS.hand;
  let shown = 0, matched = 0;
  console.log('=== Candidate annotations to CONFIRM (do not paste blindly) ===');
  console.log('Each line is a proposal from a single heuristic. Verify the `confirm`');
  console.log('field against the sentence; if you cannot pin it, SKIP — do not guess.\n');

  for (const { file, pos, key, word, ru, a } of eachUnannotated()) {
    if (!wantBuckets.includes(a.bucket) || !a.dec) continue;
    if (onlyCefr && cefrOf(word) !== onlyCefr) continue;
    matched++;
    if (limit && shown >= limit) continue;
    shown++;
    const line = serializeInflect(pos, a.dec).trim();
    const confirm = a.dec.confirm?.length ? `  ⚠ confirm: ${a.dec.confirm.join(', ')}` : '';
    console.log(`${file}  ${key}  [${cefrOf(word)}]  (${a.bucket})`);
    console.log(`   ${ru}`);
    console.log(`   → ${line}${confirm}\n`);
  }
  const cap = limit && matched > shown ? ` (showing ${shown}; --limit 0 for all)` : '';
  console.log(`${matched} candidate(s) in ${wantBuckets.join(', ')}${cap}.`);
}

// ---------------------------------------------------------------------------
// Re-derive the case of each EXISTING annotation from an independent signal (a
// governing preposition) and flag contradictions — the wrong-but-syncretic class
// CI cannot see. Reports contradictions (likely bugs) separately from the merely
// unverifiable (no independent signal available).
function verify() {
  let checked = 0, prepConfirmed = 0, unverifiable = 0;
  const clashes = [];

  for (const [file, pos] of Object.entries(FILES)) {
    if (onlyFile && file !== onlyFile) continue;
    if (pos !== 'noun' && pos !== 'pronoun') continue; // prep signal is case-based
    const { words } = loadVocabFile(file);
    for (const [key, word] of Object.entries(words)) {
      for (const u of word.usage || []) {
        const inf = u.inflect;
        if (!inf || !inf.case || !u.ru) continue;
        checked++;
        const tokens = tokenize(u.ru);
        const tok = tokens[inf.token - 1];
        const prev = inf.token >= 2 ? norm(core(tokens[inf.token - 2])) : null;
        const allowed = prev ? PREP_CASES[prev] : null;
        if (!allowed) { unverifiable++; continue; }
        // The second locative (в аду́, на берегу́) is a specialized prepositional:
        // a preposition that governs `pre` also legitimately governs `loc`.
        const ok = allowed.includes(inf.case) || (inf.case === 'loc' && allowed.includes('pre'));
        if (ok) { prepConfirmed++; continue; }
        clashes.push(
          `${file}  ${key}\n   ${u.ru}\n   token ${inf.token} «${core(tok ?? '')}» annotated ` +
          `case=${inf.case}, but preposition «${prev}» governs ${allowed.join('/')} only`,
        );
      }
    }
  }

  console.log('=== Verify: existing annotations vs. an independent preposition signal ===\n');
  console.log(`checked (noun/pronoun with case + prep signal available): ${prepConfirmed + clashes.length}`);
  console.log(`  preposition-confirmed:            ${prepConfirmed}`);
  console.log(`  CONTRADICTIONS (review these):    ${clashes.length}`);
  console.log(`unverifiable (no governing prep — CI-form-check only): ${unverifiable}`);
  console.log(`total case annotations scanned:     ${checked}\n`);
  if (clashes.length) {
    console.log('--- contradictions ---');
    for (const c of clashes.slice(0, limit || clashes.length)) console.log(c + '\n');
    if (limit && clashes.length > limit) console.log(`…and ${clashes.length - limit} more (--limit 0 for all).`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
if (MODE === 'report') report();
else if (MODE === 'suggest') suggest();
else verify();
