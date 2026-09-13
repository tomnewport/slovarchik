#!/usr/bin/env node
/**
 * check-align.mjs — the word-alignment gate and its worklist (#706).
 *
 * Every Russian token in the phrase bank should be attributable to exactly one
 * dictionary word: that is what phrase hints gloss and what the encounter bars
 * credit. `lib/phraseAlign.js` settles 98.6% of them from the corpus's own
 * structure. What it can't settle is a real hole — «его́» is "his" or "him",
 * «часо́в» is the hour or the clock, and guessing gets one of them wrong every
 * time — and an `align:` annotation on the usage example is how a human closes
 * it.
 *
 * So this script does three jobs:
 *
 *   1. **Validate** every authored `align:` — the index is in range, the word
 *      exists, the token really is a form of it, and the annotation is not dead
 *      weight for a token that was never contested. A wrong `align:` is worse
 *      than none: it is a confident lie the rest of the app trusts.
 *   2. **Refuse conflicts** where two usage examples share a sentence. The
 *      phrase bank dedupes on `ru=en` and first occurrence wins, so an `align:`
 *      on the losing copy is silently discarded — a change that looks applied
 *      and isn't. Disagreement is a failure; agreement is fine.
 *   3. **Ratchet** the residue. `align-baseline.json` records how many tokens
 *      each unresolved group still has, and the gate fails when one grows or a
 *      new group appears. Like the coverage thresholds and the size budget, the
 *      number is meant to come down and the file is the record of it coming
 *      down.
 *
 * The ratchet is per *group* — «его=his|он=he|оно=it» is its own line — rather
 * than one total, for the reason `typecheck.mjs` gives: a new ambiguity must not
 * be able to hide behind one somebody else fixed.
 *
 * Usage:
 *   node scripts/check-align.mjs            # the gate
 *   node scripts/check-align.mjs --list     # the worklist, busiest group first
 *   node scripts/check-align.mjs --update   # rewrite the baseline to today
 *   node scripts/check-align.mjs --json     # machine-readable
 */
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { loadFixtureWords } from '../src/test/fixtures.js'
import { shapePhrases, learnableWords, phrasesByRu } from '../src/lib/vocabBuild.js'
import { buildFormIndex, wordForms, normToken } from '../src/lib/phraseHint.js'
import { alignPhraseTokens, tokenCandidates } from '../src/lib/phraseAlign.js'
import { phraseTokens } from '../src/lib/phrases.js'

const ABOUT = [
  'Word-alignment residue, per ambiguity group (#706).',
  '',
  'Each key is a contested surface form written as its candidate word keys, and',
  'each value is how many phrase tokens of that shape no rung in',
  'src/lib/phraseAlign.js can settle. `npm run check:align` fails when a group',
  'grows or a new one appears.',
  '',
  'A ratchet, like the coverage thresholds and the size budget: the numbers are',
  'meant to come down as sentences get align: annotations, and this file is the',
  'record of them coming down. Raising one is a normal thing to do when a batch',
  'of new sentences lands ahead of its alignment — doing it in a commit that',
  'does not say why is not.',
  '',
  'Per group rather than one total so a new ambiguity cannot hide behind one',
  'somebody else fixed (the reasoning typecheck-baseline.json gives).',
  '',
  'Rewrite with: node scripts/check-align.mjs --update',
]

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(repo, 'scripts', 'align-baseline.json')

/** The alignment inputs a shaped phrase carries. */
function optsFor(phrase, byKey) {
  return {
    byKey,
    en: `${phrase.en} ${phrase.enAlt.join(' ')}`,
    align: phrase.align,
    inflectToken: phrase.inflectToken ?? undefined,
    inflectKey: phrase.source,
  }
}

/** A stable name for an ambiguity: its candidate keys, in dictionary order. */
export function groupName(candidates) {
  return [...candidates].sort().join('|')
}

/**
 * Check every authored `align:` block against the sentence it annotates.
 *
 * Runs over the raw usage examples rather than the deduped phrase bank, so an
 * annotation on a copy the bank drops is still checked — and so job 2 can see
 * both copies.
 *
 * @returns {{problems: string[], byPhrase: Map<string, Array<{key: string, align: object}>>}}
 */
export function auditAnnotations(words, index) {
  const byKey = new Map(words.map((w) => [w.key, w]))
  const problems = []
  /** @type {Map<string, Array<{key: string, align: object}>>} */
  const byPhrase = new Map()

  for (const word of learnableWords(words)) {
    for (const ex of word.usage ?? []) {
      const ru = String(ex?.ru ?? '').trim()
      if (!ru) continue
      const align = ex?.align
      if (!align || typeof align !== 'object' || Array.isArray(align)) continue
      if (!byPhrase.has(ru)) byPhrase.set(ru, [])
      byPhrase.get(ru).push({ key: word.key, align })

      const tokens = phraseTokens(ru)
      const where = `${word.key}: «${ru}»`
      for (const [rawIndex, rawKey] of Object.entries(align)) {
        const at = Number(rawIndex)
        const target = String(rawKey ?? '').trim()
        if (!Number.isInteger(at) || at < 1 || at > tokens.length) {
          problems.push(
            `${where}\n    align token ${rawIndex} is outside the sentence's ${tokens.length} tokens`,
          )
          continue
        }
        const text = tokens[at - 1]
        const named = byKey.get(target)
        if (!named) {
          problems.push(
            `${where}\n    align token ${at} («${text}») names ${target}, which is not a word in the corpus`,
          )
          continue
        }
        if (!wordForms(named).has(normToken(text))) {
          problems.push(`${where}\n    align token ${at} («${text}») is not a form of ${target}`)
          continue
        }
        const candidates = tokenCandidates(text, index)
        if (candidates.length < 2) {
          problems.push(
            `${where}\n    align token ${at} («${text}») is not contested — only ${candidates[0] ?? 'nothing'} claims it, so the annotation does nothing`,
          )
        }
      }
    }
  }
  return { problems, byPhrase }
}

/**
 * Sentences annotated twice, disagreeing. The phrase bank keeps one copy; two
 * copies that say different things mean the one that survives is a coin toss.
 */
export function conflictingAnnotations(byPhrase) {
  const problems = []
  for (const [ru, blocks] of byPhrase) {
    if (blocks.length < 2) continue
    const seen = new Map()
    for (const { key, align } of blocks) {
      for (const [at, target] of Object.entries(align)) {
        const prior = seen.get(at)
        if (prior && prior.target !== target) {
          problems.push(
            `«${ru}»\n    token ${at} is aligned to ${prior.target} by ${prior.key} and to ${target} by ${key}` +
              `\n    the phrase bank keeps one copy of a sentence, so only one of these is ever read`,
          )
        } else if (!prior) {
          seen.set(at, { key, target })
        }
      }
    }
  }
  return problems
}

/**
 * Every `lemma:` link on a gloss-only stub, checked against the word it names.
 *
 * The `align:` annotations get four checks each; the 462 lemma links got none,
 * and they are the higher-leverage data — they drive every `lemma` collapse and
 * redirect `credit` on a large share of tokens besides. A broken one does not
 * announce itself: `lexeme()` falls back to the key when the target is missing,
 * so the link simply stops working and the only symptom is a residue number
 * somewhere, which is a diagnosis nobody can read backwards. With 2,037 stubs
 * still unlinked most future links will be written by hand, so they are checked
 * like anything else written by hand.
 *
 * @param {object[]} words normalised word records
 * @returns {string[]} one message per broken link
 */
export function auditLemmaLinks(words) {
  const byKey = new Map(words.map((w) => [w.key, w]))
  const problems = []
  for (const stub of words) {
    if (!stub.lemma) continue
    const where = `${stub.key}: lemma ${stub.lemma}`
    if (stub.learnable !== false) {
      problems.push(
        `${where}\n    is on a curriculum word — lemma: says "this entry is a form of that one",` +
          `\n    which only makes sense for a gloss-only (learn: false) entry`,
      )
      continue
    }
    const target = byKey.get(stub.lemma)
    if (!target) {
      problems.push(`${where}\n    names no word in the corpus`)
      continue
    }
    if (target.learnable === false) {
      problems.push(
        `${where}\n    names another gloss-only entry. Alignment follows one hop only, so a` +
          `\n    chain silently stops at the middle link — point it at the curriculum word`,
      )
      continue
    }
    if (!wordForms(target).has(normToken(stub.ru))) {
      problems.push(`${where}\n    «${stub.headword || stub.ru}» is not a form of ${stub.lemma}`)
    }
  }
  return problems
}

/**
 * Sentences whose duplicate copies would align differently.
 *
 * `shapePhrases` keeps one copy per `ru=en`, and `phrasesByRu` then keeps one of
 * *those* per `ru` — so a sentence filed under two words ships with one copy's
 * `source`, `inflectToken` and English, and the other copy's are never read.
 * Where that changes the answer, which copy survives is decided by dictionary
 * order, and the alignment a learner gets is an accident of sorting.
 *
 * Reported by outcome rather than by comparing inputs, because the inputs differ
 * on 22 of the 24 duplicated sentences and almost none of it matters: two
 * examples of one sentence naturally sit under different words and annotate
 * different tokens. What matters is when the resolution moves.
 *
 * @param {object[]} words
 * @param {import('../src/lib/phraseHint.js').FormIndex} index
 * @returns {string[]}
 */
export function divergentDuplicates(words, index) {
  const byKey = new Map(words.map((w) => [w.key, w]))
  const shaped = shapePhrases(words)
  // The authored annotations as the app will see them: merged across copies, so
  // one `align:` settles the sentence wherever it was written. What is left to
  // differ is each copy's own `inflect:` target, its `source` and its English.
  const merged = phrasesByRu(shaped)
  /** @type {Map<string, object[]>} */
  const copies = new Map()
  for (const phrase of shaped) {
    if (!copies.has(phrase.ru)) copies.set(phrase.ru, [])
    copies.get(phrase.ru).push(phrase)
  }

  const problems = []
  for (const [ru, group] of copies) {
    if (group.length < 2) continue
    const align = merged.get(ru)?.align
    const runs = group.map((phrase) =>
      alignPhraseTokens(ru, index, { ...optsFor(phrase, byKey), align }),
    )
    runs[0].forEach((cell, i) => {
      const keys = runs.map((run) => run[i]?.alignment?.key ?? null)
      if (new Set(keys).size < 2) return
      problems.push(
        `«${ru}»\n    token ${i + 1} («${cell.text}») resolves differently depending on which copy` +
          ` of the sentence the phrase bank keeps:\n` +
          group.map((p, j) => `      under ${p.source} → ${keys[j] ?? 'unresolved'}`).join('\n') +
          `\n    settle it with an align: block, which both copies then agree on`,
      )
    })
  }
  return problems
}

/**
 * One phrase per distinct Russian sentence, first occurrence winning — the
 * phrase bank as `stores/vocab.js` hands it to alignment.
 *
 * Deliberately the *same* `phrasesByRu` the running app uses, not a second
 * implementation of the same idea: `shapePhrases` dedupes on `ru=en`, so a
 * sentence with two English renderings survives twice, and walking both copies
 * measured a resolution the app never performs. 24 sentences are duplicated, 22
 * file their copies under different words, and on «Он постуча́л в закры́тую
 * дверь.» the two copies' `inflect:` blocks disagree about what «закры́тую» is.
 */
export function shippedPhrases(words) {
  return [...phrasesByRu(shapePhrases(words)).values()]
}

/** Every ambiguous token nothing settles, grouped by candidate set. */
export function residue(words) {
  const byKey = new Map(words.map((w) => [w.key, w]))
  const index = buildFormIndex(words)
  const phrases = shippedPhrases(words)
  /** @type {Map<string, {group: string, count: number, samples: Array<object>}>} */
  const groups = new Map()
  let tokens = 0
  const settled = new Map()

  for (const phrase of phrases) {
    alignPhraseTokens(phrase.ru, index, optsFor(phrase, byKey)).forEach((cell, i) => {
      if (!cell.candidates.length) return
      tokens++
      const via = cell.alignment?.via ?? 'unresolved'
      settled.set(via, (settled.get(via) ?? 0) + 1)
      if (cell.alignment) return
      const group = groupName(cell.candidates)
      if (!groups.has(group)) groups.set(group, { group, count: 0, samples: [] })
      const row = groups.get(group)
      row.count++
      if (row.samples.length < 3) {
        row.samples.push({
          token: i + 1,
          text: cell.text,
          ru: phrase.ru,
          en: phrase.en,
          source: phrase.source,
        })
      }
    })
  }
  const ranked = [...groups.values()].sort(
    (a, b) => b.count - a.count || a.group.localeCompare(b.group),
  )
  return { tokens, settled, groups: ranked, index, phrases }
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch {
    return { _about: [], groups: {} }
  }
}

/**
 * Baseline lines for groups that no longer have any residue.
 *
 * A ratchet only ratchets while its numbers describe something. Annotate a
 * group down to nothing and its line stays behind, still permitting a silent
 * regression to the old count — and since `--update` is a deliberate act, it
 * stays there until somebody happens to run it. So a cleared group is a
 * failure with a one-command fix, the same way a group that grew is.
 *
 * Only *cleared* groups, not every group that shrank: a loose line is harmless
 * while the ambiguity still exists, and failing the build on every partial
 * improvement would make the gate something to route around.
 *
 * @param {Array<{group: string, count: number}>} groups
 * @param {{groups?: Object<string, number>}} baseline
 * @returns {Array<{group: string, limit: number}>}
 */
export function staleBaselineEntries(groups, baseline) {
  const live = new Set(groups.map((g) => g.group))
  return Object.entries(baseline?.groups ?? {})
    .filter(([group]) => !live.has(group))
    .map(([group, limit]) => ({ group, limit }))
}

/** Groups that grew, or that the baseline has never seen. */
export function ratchetFailures(groups, baseline) {
  const allowed = baseline?.groups ?? {}
  const failures = []
  for (const { group, count, samples } of groups) {
    const limit = allowed[group]
    if (limit === undefined) failures.push({ group, count, limit: 0, samples, fresh: true })
    else if (count > limit) failures.push({ group, count, limit, samples, fresh: false })
  }
  return failures
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const words = loadFixtureWords()
  const { tokens, settled, groups, index } = residue(words)
  const { problems, byPhrase } = auditAnnotations(words, index)
  const conflicts = conflictingAnnotations(byPhrase)
  const lemmaProblems = auditLemmaLinks(words)
  const divergent = divergentDuplicates(words, index)
  const unresolved = groups.reduce((sum, g) => sum + g.count, 0)

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          tokens,
          settled: Object.fromEntries(settled),
          unresolved,
          groups,
          problems,
          conflicts,
          lemmaProblems,
          divergent,
        },
        null,
        2,
      ),
    )
    process.exit(0)
  }

  if (args.includes('--update')) {
    const baseline = readBaseline()
    baseline._about = ABOUT
    baseline.groups = Object.fromEntries(groups.map((g) => [g.group, g.count]))
    writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(`baseline rewritten: ${groups.length} groups, ${unresolved} unresolved tokens`)
    process.exit(0)
  }

  console.log(`aligned ${tokens} phrase tokens`)
  for (const [via, n] of [...settled].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${via.padEnd(11)} ${String(n).padStart(6)}  ${((n / tokens) * 100).toFixed(2)}%`)
  }
  console.log('')

  if (args.includes('--list')) {
    for (const g of groups) {
      const s = g.samples[0]
      console.log(`${String(g.count).padStart(5)}  ${g.group}`)
      if (s) console.log(`       e.g. token ${s.token} «${s.text}» in ${s.ru} — ${s.en}`)
    }
    process.exit(0)
  }

  let failed = false
  const report = (title, lines) => {
    if (!lines.length) return
    failed = true
    console.error(`${title}\n`)
    for (const line of lines) console.error(`  ${line}\n`)
  }
  report('Broken align: annotations', problems)
  report('Conflicting align: annotations on one sentence', conflicts)
  report('Broken lemma: links', lemmaProblems)
  report('Duplicated sentences whose copies align differently', divergent)

  const baseline = readBaseline()
  const stale = staleBaselineEntries(groups, baseline)
  if (stale.length) {
    failed = true
    console.error(`The baseline names ${stale.length} group(s) with no residue left:\n`)
    for (const { group, limit } of stale) console.error(`  ${group}  (still allows ${limit})`)
    console.error(
      '\nA line for a group that is gone is a regression waiting to be let through.' +
        '\nRun `node scripts/check-align.mjs --update` to drop them.\n',
    )
  }

  const failures = ratchetFailures(groups, baseline)
  if (failures.length) {
    failed = true
    console.error(`Word alignment went backwards — ${failures.length} group(s) grew:\n`)
    for (const f of failures) {
      const s = f.samples[0]
      console.error(`  ${f.group}`)
      console.error(
        `    ${f.count} unresolved token(s), baseline allows ${f.limit}${f.fresh ? ' (new group)' : ''}`,
      )
      if (s)
        console.error(`    e.g. token ${s.token} «${s.text}» in «${s.ru}» — ${s.en}  (${s.source})`)
      console.error('')
    }
    console.error('Annotate the sentences with an align: block on the usage example, e.g.')
    console.error('    usage:')
    console.error('      - ru: Я подари́л бра́ту часы́.')
    console.error('        en_gb: I gave my brother a watch.')
    console.error('        align: { 4: "часы=clock" }')
    console.error('')
    console.error('If the growth is deliberate — a batch of new sentences whose alignment')
    console.error('is a follow-up — run `node scripts/check-align.mjs --update` and say in')
    console.error('the commit message what grew and why.')
  }

  if (!failed) {
    console.log(`unresolved: ${unresolved} token(s) in ${groups.length} group(s) — within baseline`)
  }
  process.exit(failed ? 1 : 0)
}
