// Which dictionary word each Russian token in a phrase actually *is* (#706).
//
// `phraseHint.buildFormIndex` answers "what do we show when this token is
// tapped". That is not the same question as "which word is this", and where a
// surface form is claimed by more than one entry the two answers come apart:
// the index hands the form to whichever entry won its collision rules, and the
// rest of the app inherits that guess without ever being told a guess was made.
//
// Two things go wrong as a result. Hints gloss the wrong word: «цвета́ми» in "a
// butterfly flies over the flowers" reads "colour", because цвет's instrumental
// plural got there before цвето́к's; «вина́» in "a glass of red wine" reads
// "guilt"; «да́ли» in "we were given passes" reads "distance". And encounters
// (lib/encounters.js) *undercount*: they refused to credit any token carrying
// more than one sense, which threw away every homograph and — far more often —
// every word whose gloss-only stub stacks against its own lemma («купи́=buy»
// beside «купи́ть=to buy»).
//
// So alignment is computed separately, and deliberately says "I don't know"
// rather than guessing. Measured over the corpus: 94.6% of the 74k phrase
// tokens are claimed by exactly one word and need no work at all. Of the
// remaining 4,045 the rungs below settle all but ~860, and what survives is a
// worklist (`npm run check:align`) for authored `align:` annotations.
//
// Three fields come back, because those are three different questions. `key` is
// the one word this token is attributed to; `credit` is what an encounter may
// bank, which is the whole group where a rung collapsed one rather than chose
// from it; `show` is what the hint may narrow the form index down to. The
// typedef below has the detail, and the distinction is load-bearing: flattening
// them is how a 50/50 guess ends up looking like an answer.
//
// Pure and framework-free: no Vue, no store, no I/O.

import {
  hasStressMark,
  normToken,
  normTokenStress,
  phraseHintTokens,
  senseGloss,
} from './phraseHint.js'
import { phraseTokens } from './phrases.js'

/**
 * How an alignment was reached. Ordered loosely by how much it is worth: an
 * authored annotation is a human's answer, `unique` is arithmetic, and
 * `english` is the one rung that can be wrong on its own.
 * @typedef {'unique'|'authored'|'inflect'|'lemma'|'family'|'polysemy'|'english'} AlignVia
 */

/**
 * Three fields, because a rung that *collapses* a group and a rung that *picks*
 * from it are not making the same claim, and flattening them into one key is
 * how a 50/50 guess ends up looking like an answer.
 *
 * @typedef {object} Alignment
 * @property {string} key  the single word this token is best attributed to.
 *   Decisive rungs mean it literally; a collapse rung means "the head of the
 *   group", which for a shared form like the comparative «гро́мче» is a
 *   convention, not a finding — read `credit` instead unless you need one key.
 * @property {string[]} show  keys whose glosses the hint should offer (always
 *   contains `key`; longer only where the token is one lexeme spread over
 *   several entries and narrowing it would be a claim, not a fact)
 * @property {string[]} credit  the curriculum words this token is evidence the
 *   learner has met. One key where a rung decided; every member of the group
 *   where it collapsed one — «гро́мче» is the comparative of both гро́мкий and
 *   гро́мко, and a learner who read it has met both. Gloss-only stubs never
 *   appear: they are not part of the curriculum and the bars cannot show them.
 * @property {AlignVia} via  which rung settled it
 */

/**
 * The candidate word keys for a surface token, preferring a stress-exact match
 * when the token is marked and the stress index knows the form — the same
 * precedence {@link import('./phraseHint.js').phraseHintTokens} uses, so the
 * two never disagree about what a token could be.
 *
 * @param {string} text  the raw token, stress marks and punctuation intact
 * @param {import('./phraseHint.js').FormIndex} index
 * @returns {string[]}  every word that can surface as this token; empty when the
 *   token is not a word we know, one entry when it is unambiguous
 */
export function tokenCandidates(text, index) {
  if (!index) return []
  const stressed = hasStressMark(text) ? normTokenStress(text) : ''
  const stressIndex = index.stressIndex
  if (stressed && stressIndex?.has(stressed)) {
    return stressIndex.candidates?.get(stressed) ?? [stressIndex.get(stressed).key]
  }
  const bare = normToken(text)
  if (!bare || !index.has(bare)) return []
  return index.candidates?.get(bare) ?? [index.get(bare).key]
}

/** Follow a stub's `lemma:` link to the curriculum word it is a form of. */
function lexeme(key, byKey) {
  const word = byKey?.get(key)
  const lemma = word?.lemma
  // One hop only. A lemma link points at a curriculum headword, which has no
  // lemma of its own; a chain would mean the data is wrong, and following it
  // would hide that from `check:align`.
  return lemma && byKey?.has(lemma) ? lemma : key
}

/**
 * Are these keys one derivational family — the same root wearing a different
 * part of speech, or one suppletive form standing in for both?
 *
 * Three links in the corpus already say so. `mannerPair` ties an adjective to
 * its -о adverb (бы́стрый ↔ бы́стро). `participleOf` ties a lexicalised
 * participle back to its verb (закры́тый → закры́ть). And a stored
 * `forms.comparative` ties words together two ways: to the word that *is* that
 * comparative where it has an entry of its own — «лу́чше» is the comparative of
 * хоро́ший and хорошо́ alike — and to any other candidate storing the *same*
 * comparative, which is what «бо́льше» is to большо́й and мно́го. Neither pair is
 * a coincidence of spelling: they are one form two words share, and the
 * sentence, not the dictionary, is what picks between them.
 *
 * Membership is connectivity, not pairing: the group is a family when every
 * member reaches every other through those links. Three-member groups are the
 * common case precisely because of the suppletive comparatives.
 *
 * A family is collapsed rather than chosen from, because no rule decides it.
 * Preferring the adverb was measured at 49% against the corpus's own `inflect:`
 * annotations, and picking the group head at 51% — a coin flip either way. What
 * the form does support is that the learner met this root, which is what the
 * `credit` list says.
 */
function sameFamily(keys, byKey, bare) {
  if (keys.length < 2) return false
  const inGroup = new Set(keys)
  const bareOf = new Map(keys.map((k) => [normToken(byKey?.get(k)?.ru ?? ''), k]))
  /** Candidates whose stored comparative is the very token being aligned. */
  const sharingToken = []

  /** @type {Map<string, Set<string>>} */
  const edges = new Map(keys.map((k) => [k, new Set()]))
  const join = (a, b) => {
    if (!a || !b || a === b || !inGroup.has(a) || !inGroup.has(b)) return
    edges.get(a).add(b)
    edges.get(b).add(a)
  }
  for (const key of keys) {
    const w = byKey?.get(key)
    if (!w) continue
    join(key, w.mannerPair?.key)
    join(key, w.participleOf?.key)
    const comparative = w.extra?.forms?.comparative
    if (!comparative) continue
    join(key, bareOf.get(normToken(comparative)))
    if (bare && normToken(comparative) === bare) sharingToken.push(key)
  }
  // «бо́льше» is stored as the comparative of both большо́й and мно́го without
  // being an entry itself, so there is no third node for the edges above to run
  // through — the two have to be joined to each other directly.
  for (const key of sharingToken.slice(1)) join(sharingToken[0], key)

  const seen = new Set([keys[0]])
  const queue = [keys[0]]
  while (queue.length) {
    for (const next of edges.get(queue.pop()) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen.size === keys.length
}

/**
 * English words too common to be evidence of anything.
 *
 * The possessives earn their place here rather than being obvious: dropping
 * them lets «его́» in "I wrote down his address" resolve to the possessive, and
 * it does — but «её» in "I see her every morning" then resolves the same way,
 * because English "her" is the object pronoun too. Measured, admitting them
 * moved the evidence rung from 97.4% to 94.9% to settle two more tokens. The
 * pronouns are the biggest single block of the residue and they stay there:
 * what decides them is syntax (a possessive modifies the following noun), not
 * vocabulary, and until a rung can read that they are a job for `align:`.
 */
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'with',
  'and',
  'or',
  'be',
  'is',
  'are',
  'was',
  'were',
  'am',
  'been',
  'being',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'one',
  'some',
  'any',
  'his',
  'her',
  'their',
  'my',
  'your',
  'our',
  'him',
  'them',
  'she',
  'they',
  'you',
  'we',
  'not',
  'very',
])

/** Shortest stem worth treating as evidence. Below this, collisions dominate. */
const MIN_STEM = 4

/**
 * Shortest stem kept from a *gloss*. Lower, because a gloss is not running
 * prose: «бежа́ть» glosses as "to run", and dropping "run" for being three
 * letters is what let the evidence rung match «бег» "running" against the same
 * sentence with nothing to oppose it. A short gloss stem is admitted so it can
 * object, which is the job it does here.
 */
const MIN_GLOSS_STEM = 3

/**
 * Content-word stems of an English string, crudely suffix-stripped. Crude on
 * purpose: this feeds a tiebreak that only fires when it is unopposed, so a
 * missed match costs a rung and a false match is caught by the opposition test
 * in {@link byEnglish}.
 * @param {string} text
 * @param {number} [min]  shortest stem to keep
 * @returns {Set<string>}
 */
export function englishStems(text, min = MIN_STEM) {
  const out = new Set()
  // Apostrophes are dropped rather than split on, so "o'clock" stays one word.
  // Split, it yields "clock" — which is «часы́», and "nine o'clock" would then
  // vouch for the clock on the wall over the hour of the day.
  for (const raw of String(text ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z]+/)) {
    if (!raw || STOP_WORDS.has(raw)) continue
    const stem = raw.replace(/(ing|ed|es|s)$/, '')
    if (stem.length >= min) out.add(stem)
  }
  return out
}

/** Do two stems plausibly name the same thing? Prefix match, either direction. */
function stemsAgree(a, b) {
  const n = Math.min(a.length, b.length, MIN_STEM)
  return n >= MIN_GLOSS_STEM && a.slice(0, n) === b.slice(0, n)
}

/**
 * The one candidate whose gloss the phrase's English vouches for, or null.
 *
 * Deliberately timid. It fires only when exactly one candidate's gloss is
 * echoed in the translation AND no *other* candidate's gloss shares a stem with
 * the evidence — «бег» "running" against «бежа́ть» "to run" both answer to
 * "run", and picking between them on a prefix match is not evidence, it is a
 * coin flip wearing evidence's clothes. Measured accuracy where it fires, taken
 * against the corpus's own `inflect:` annotations, is in the low nineties; it
 * is therefore the last rung before giving up, never ahead of a structural one.
 *
 * @param {string[]} keys  candidate word keys
 * @param {Set<string>} evidence  stems of the phrase's English (see {@link englishStems})
 * @param {Map<string, object>} byKey
 * @returns {string|null}
 */
function byEnglish(keys, evidence, byKey) {
  if (!evidence?.size) return null
  const glosses = keys.map((k) => {
    const w = byKey?.get(k)
    return englishStems(w?.meaning || w?.en || '', MIN_GLOSS_STEM)
  })
  const matched = []
  keys.forEach((key, i) => {
    for (const stem of glosses[i]) {
      for (const seen of evidence) {
        if (stemsAgree(stem, seen)) {
          matched.push({ key, stem })
          return
        }
      }
    }
  })
  if (matched.length !== 1) return null
  const { key, stem } = matched[0]
  // The losers must have nothing to say about this stem. Two glosses answering
  // to the same word are two readings of the sentence, not one.
  const opposed = keys.some((k, i) => k !== key && [...glosses[i]].some((s) => stemsAgree(s, stem)))
  return opposed ? null : key
}

/**
 * Resolve one token's candidate set to an {@link Alignment}, or null when
 * nothing settles it.
 *
 * The rungs run structure-first and evidence-last, so a rung that cannot be
 * wrong always pre-empts one that can. `authored` is a human's answer and wins
 * outright; `inflect` is the corpus's own claim about which word this token is,
 * already checked against the paradigm by `phrasesData.test.js`.
 *
 * @param {string[]} keys  candidates, in dictionary order
 * @param {object} [ctx]
 * @param {Map<string, object>} [ctx.byKey]  the dictionary. Without it only the
 *   rungs above it can run, and a contested token comes back unresolved rather
 *   than guessed at
 * @param {string} [ctx.authored]  a key from the phrase's `align:` annotation
 * @param {string} [ctx.inflect]  the owner of an `inflect:` block on this token
 * @param {Set<string>} [ctx.evidence]  English stems of the phrase
 * @param {string} [ctx.bare]  the token's stress-stripped form, for base-form tests
 * @returns {Alignment|null}
 */
export function resolveCandidates(keys, ctx = {}) {
  const { byKey, authored, inflect, evidence, bare } = ctx
  if (!keys?.length) return null

  /**
   * A decisive rung: one word, no hedging.
   *
   * It rules out rival *words*, not rival entries of the word it named, so a
   * gloss-only stub of that same lexeme stays on show. «Бро́сьте» in "Give up
   * this habit!" is «бро́сить», and establishing that must not cost the learner
   * the stub's gloss "give up" — which is the one that fits the sentence (#574).
   */
  const decided = (key, via) => {
    const lex = lexeme(key, byKey)
    const kin = keys.filter((k) => k === key || lexeme(k, byKey) === lex)
    // Credit the lexeme, not the entry: naming a stub — whether a rung did or a
    // human's `align:` did — is still evidence for the word it is a form of,
    // and that is the word the bars can actually report.
    return { key, show: kin.length ? kin : [key], credit: creditable([lex], byKey), via }
  }
  /**
   * A collapse rung: the group is one word wearing several entries, so every
   * gloss stays on show and every curriculum member is credited. `key` is the
   * group's head purely so consumers wanting a single key get a stable one.
   */
  const collapsed = (group, all, via) => ({
    key: head(group, bare, byKey),
    show: all,
    credit: creditable(group, byKey),
    via,
  })

  if (keys.length === 1) return decided(keys[0], 'unique')

  if (authored && keys.includes(authored)) return decided(authored, 'authored')
  if (inflect && keys.includes(inflect)) return decided(inflect, 'inflect')

  // Every rung below reads the dictionary. Without it they cannot tell a
  // gloss-only stub from its lemma or one spelling from another, and would
  // collapse any contested token into a single confident answer — the exact
  // over-credit this module exists to avoid. No dictionary, no opinion.
  if (!byKey) return null

  // A stub and the lemma it is a form of are one word wearing two entries.
  const lexemes = [...new Set(keys.map((k) => lexeme(k, byKey)))]
  if (lexemes.length === 1) return collapsed(lexemes, keys, 'lemma')

  // Several entries spelling the same Russian are one word's several senses.
  // Attributing it is safe; narrowing it is not, so every gloss stays on show.
  const spellings = new Set(lexemes.map((k) => normToken(byKey?.get(k)?.ru ?? '')))
  if (spellings.size === 1) return collapsed(lexemes, keys, 'polysemy')

  if (sameFamily(lexemes, byKey, bare)) return collapsed(lexemes, keys, 'family')

  const picked = byEnglish(lexemes, evidence, byKey)
  if (picked) return decided(picked, 'english')

  return null
}

/**
 * Whichever member of a group owns the token as its *dictionary* form, falling
 * back to the first in dictionary order.
 *
 * The fallback is a convention and nothing more. It is reached exactly when the
 * surface form belongs to every member equally — «гро́мче» is the comparative of
 * both гро́мкий and гро́мко — and picking between them there was measured at 51%
 * against the corpus's own `inflect:` annotations. That is why a collapse rung
 * publishes `credit` as well: the head is for consumers that must have one key,
 * not a claim that the other reading was ruled out.
 */
function head(group, bare, byKey) {
  return group.find((k) => normToken(byKey?.get(k)?.ru ?? '') === bare) ?? group[0]
}

/**
 * The curriculum words among a group. Gloss-only stubs drop out: they are not
 * taught, do not appear in the CEFR bars, and `encounteredKeys` would have to
 * filter them anyway.
 *
 * A group of nothing but stubs credits nothing, and says so with an empty list
 * rather than handing the stubs back. There are 3,228 such tokens — every word
 * the phrase bank uses that the curriculum does not teach and that no `lemma:`
 * link has reached yet — and the old fallback returned them, contradicting the
 * `Alignment` typedef one screen up. Harmless only because `encounteredKeys`
 * filters again on its way past; the next consumer to read the contract instead
 * of the code would have over-credited.
 */
function creditable(group, byKey) {
  return group.filter((k) => byKey?.get(k)?.learnable !== false)
}

/**
 * Align every token of a phrase to the word it is.
 *
 * @param {string} phrase  the Russian sentence, stress marks intact
 * @param {import('./phraseHint.js').FormIndex} index  from `buildFormIndex`
 * @param {object} [opts]
 * @param {Map<string, object>} [opts.byKey]  word records by key
 * @param {string} [opts.en]  the phrase's English, evidence for the last rung
 * @param {Object<number, string>} [opts.align]  authored overrides, 1-based
 *   token index → word key (the `align:` block on the usage example)
 * @param {number} [opts.inflectToken]  1-based index of the example's `inflect:`
 *   target, whose word is `inflectKey`
 * @param {string} [opts.inflectKey]  the word that `inflect:` target belongs to
 * @returns {Array<{text: string, candidates: string[], alignment: Alignment|null}>}
 *   one entry per display token, in phrase order
 */
export function alignPhraseTokens(phrase, index, opts = {}) {
  const { byKey, en, align, inflectToken, inflectKey } = opts
  const evidence = englishStems(en ?? '')
  return phraseTokens(phrase).map((text, i) => {
    const candidates = tokenCandidates(text, index)
    const alignment = resolveCandidates(candidates, {
      byKey,
      authored: align?.[i + 1],
      inflect: inflectToken === i + 1 ? inflectKey : undefined,
      evidence,
      bare: normToken(text),
    })
    return { text, candidates, alignment }
  })
}

/**
 * The tokens of a phrase that are ambiguous and that no rung settles — the
 * worklist an `align:` annotation exists to clear.
 *
 * @param {string} phrase
 * @param {import('./phraseHint.js').FormIndex} index
 * @param {object} [opts]  as {@link alignPhraseTokens}
 * @returns {Array<{token: number, text: string, candidates: string[]}>}
 *   `token` is 1-based, matching the `align:`/`inflect:` convention
 */
export function unalignedTokens(phrase, index, opts = {}) {
  const out = []
  alignPhraseTokens(phrase, index, opts).forEach(({ text, candidates, alignment }, i) => {
    if (!alignment && candidates.length > 1) out.push({ token: i + 1, text, candidates })
  })
  return out
}

/**
 * The sense object for a word key, in the shape `buildFormIndex` entries use.
 * Preferred from the index entry when it already carries one — that copy has
 * the heteronym-specific gloss where there is one — and synthesised from the
 * word record otherwise, for the keys the entry's collision rules dropped.
 */
function senseFor(key, entry, byKey) {
  const existing = entry?.senses?.find((s) => s.key === key)
  if (existing) return existing
  const w = byKey?.get(key)
  if (!w) return null
  return { key, ru: w.headword || w.ru, en: w.meaning || w.en }
}

/**
 * Does `en` say something the senses already gathered don't? Mirrors the guard
 * `buildFormIndex` applies when it stacks senses, so a rebuilt entry cannot read
 * "New York / New York" where the index would have said it once.
 */
function isNewGloss(senses, en) {
  return !senses.some((s) => s.en === en || s.en.includes(en))
}

/**
 * The senses a token's hint should offer, given what alignment worked out.
 *
 * Alignment may **narrow** the index's entry or **correct** it; it never widens
 * it. The index's stacking rules already decide what is worth showing — a
 * homograph's several meanings (#568), a stub's gloss beside its lemma's (#574)
 * — and a collapse rung has no better opinion about display than they do. It
 * knows «гро́мче» is one root wearing two entries, which is a fact about
 * *attribution*; turning that into "loudly / loud" on screen would be this
 * module answering a question nobody asked it.
 *
 * So: when `show` covers everything the entry already offers, the entry stands
 * as it is. Only a rung that genuinely ruled candidates out — or that named a
 * word the entry does not carry at all, which is the case this module exists
 * for — rebuilds it.
 *
 * @returns {object[]|null} the senses to show, or null to keep the entry as-is
 */
function narrowedSenses(alignment, entry, byKey) {
  const wanted = new Set(alignment.show)
  const existing = entry?.senses ?? []
  const keeps = existing.filter((s) => wanted.has(s.key))
  // Nothing ruled out and nothing missing: the index's own answer stands.
  if (keeps.length === existing.length && wanted.has(alignment.key)) return null

  // Entry order first — it encodes the index's display decisions — then the
  // keys the entry never carried, which is how a corrected token gets the gloss
  // of the word it actually is.
  const senses = []
  for (const sense of [...keeps, ...alignment.show.map((k) => senseFor(k, entry, byKey))]) {
    if (!sense || senses.some((s) => s.key === sense.key)) continue
    if (senses.length && !isNewGloss(senses, sense.en)) continue
    senses.push(sense)
  }
  return senses.length ? senses : null
}

/**
 * Phrase tokens tagged with the hint to show *and* the word each token is.
 *
 * The hint an aligned token carries is the form index's, narrowed or corrected
 * by what alignment established (see {@link narrowedSenses}) — which is the
 * whole point: the index hands a contested form to whichever entry won its
 * collision rules, and «цвета́ми» in "a butterfly flies over the flowers" is
 * цвето́к, not цвет. A token nothing settles keeps the index's entry untouched.
 *
 * @param {string} phrase
 * @param {import('./phraseHint.js').FormIndex} index
 * @param {object} [opts]  as {@link alignPhraseTokens}
 * @returns {Array<{text: string, hint: object|null, alignment: Alignment|null}>}
 */
export function alignedHintTokens(phrase, index, opts = {}) {
  const { byKey } = opts
  const hinted = phraseHintTokens(phrase, index)
  return alignPhraseTokens(phrase, index, opts).map(({ text, alignment }, i) => {
    const entry = hinted[i]?.hint ?? null
    if (!alignment || !byKey) return { text, hint: entry, alignment }
    const senses = narrowedSenses(alignment, entry, byKey)
    if (!senses) return { text, hint: entry, alignment }
    return {
      text,
      hint: { key: senses[0].key, ru: senses[0].ru, en: senseGloss(senses), senses },
      alignment,
    }
  })
}
