// Translation-quality triage for the example-sentence corpus.
//
// Every usage example is a {ru, en_gb} pair that becomes a phrase in the drills.
// Some of those pairs are weaker than they look: the English reads as free
// paraphrase where a literal rendering would teach more, or it silently adds
// information the Russian never states ("The teacher asked *us* to rewrite the
// paragraphs" for «Учи́тель попроси́л переписа́ть абза́цы»), or the sentence
// translates a word differently from the gloss the tap-hint shows for it.
//
// None of that can be decided mechanically — "is this English natural?" is a
// judgement call, and a good idiomatic translation is not a defect. What *can*
// be done mechanically is **ranking**: score every phrase on a handful of cheap
// signals, so a review pass spends its attention where defects actually cluster
// instead of reading 16k sentences in corpus order. This module computes those
// signals. It decides nothing; it sorts.
//
// The signals lean on machinery that already exists. `buildFormIndex`
// (phraseHint.js) maps every Russian surface form in the corpus — including the
// `learn: false` gloss-only entries — to the English gloss the learner sees when
// they tap that word. That index is a serviceable bilingual dictionary, which is
// what makes word-level alignment possible at all.
//
// Deliberately *not* a CI guard. Thousands of phrases trip at least one signal
// and most of them are fine; a threshold here would be noise. Compare
// `stressAudit.js` / `morphOracle.js`, which assert things that are true or
// false — this one only produces a worklist.
import { buildFormIndex, phraseHintTokens, normToken } from './phraseHint.js'

/**
 * English words with no Russian counterpart to find, ever. Kept to the closed
 * grammatical classes Russian simply lacks — articles, the present-tense copula,
 * periphrastic auxiliaries and the infinitive marker — so that an English word
 * left unaligned is real evidence of added content rather than a known artefact
 * of the two grammars. Content words (including pronouns and prepositions) stay
 * in: an English pronoun with nothing behind it is exactly the signal we want,
 * because Russian states its subjects far more often than English drops them.
 */
const EN_GRAMMATICAL = new Set([
  'a', 'an', 'the',
  'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'will', 'shall', 'would', 'have', 'has', 'had',
  'to', 'of',
])

/**
 * Russian tokens that carry no lexical content to align. Particles and the
 * copula «быть», whose present tense is unwritten. Everything else — pronouns,
 * prepositions, negation — counts, because their presence or absence in the
 * English is informative.
 */
const RU_PARTICLES = new Set([
  'же', 'ли', 'бы', 'ведь', 'вот', 'уж', 'то', 'ка',
  'быть', 'есть', 'был', 'была', 'было', 'были', 'будет', 'будут', 'буду', 'будешь',
])

/**
 * Lower-case English words, with contractions expanded first.
 *
 * Expansion matters more than it looks: without it «не» never aligns with
 * "doesn't", "wasn't" or "haven't", and negated sentences — a large, perfectly
 * well-translated slice of the corpus — all score as unaligned. Expanding the
 * possessive «'s» to "is" is harmless in the same move, since the auxiliary is
 * dropped as grammatical either way.
 */
export function englishWords(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bcan't\b/g, 'can not')
    .replace(/\bshan't\b/g, 'shall not')
    .replace(/n't\b/g, ' not')
    .replace(/'(ll|ve|re|d|m|s)\b/g, (_, s) => ` ${{ ll: 'will', ve: 'have', re: 'are', d: 'would', m: 'am', s: 'is' }[s]}`)
    .replace(/[^a-z ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Closed-class Russian forms and the English words that may legitimately
 * realise them.
 *
 * These are the two families where a single dictionary gloss is the wrong tool.
 * A pronoun's gloss is its nominative lemma, so «него́» is glossed "he" and can
 * never align with "him"; a preposition maps many-to-many onto English, so «на»
 * is glossed "on" and misaligns every time the right English is "at", "to" or
 * nothing at all. Both are closed classes, so listing them outright is exact
 * rather than approximate — and it stops the report from being dominated by the
 * two things Russian and English differ on most predictably.
 */
const CLOSED_CLASS = new Map(Object.entries({
  // personal pronouns, all cases, with and without the prepositional н-
  я: 'i me my mine myself', меня: 'i me my mine myself', мне: 'i me my myself',
  мной: 'i me myself', мною: 'i me myself',
  ты: 'you your yours yourself', тебя: 'you your yours yourself',
  тебе: 'you your yourself', тобой: 'you your yourself', тобою: 'you your yourself',
  он: 'he him his it its', его: 'he him his it its', ему: 'he him his it its',
  им: 'he him his it its they them their', нем: 'he him his it its',
  него: 'he him his it its', нему: 'he him his it its', ним: 'he him his it its they them',
  она: 'she her hers it its', ее: 'she her hers it its', ей: 'she her hers it its',
  ею: 'she her it its', нее: 'she her hers it its', ней: 'she her hers it its',
  оно: 'it its', мы: 'we us our ours', нас: 'we us our ours', нам: 'we us our ours',
  нами: 'we us our ours', вы: 'you your yours', вас: 'you your yours',
  вам: 'you your yours', вами: 'you your yours',
  они: 'they them their theirs', их: 'they them their theirs it its',
  ими: 'they them their', них: 'they them their it its', ними: 'they them their',
  себя: 'self myself yourself himself herself itself ourselves themselves each other',
  себе: 'self myself yourself himself herself itself ourselves themselves',
  собой: 'self myself yourself himself herself itself ourselves themselves',
  // possessives — свой agrees with whatever the subject is, so it takes them all
  свой: 'my your his her its our their own', своя: 'my your his her its our their own',
  свое: 'my your his her its our their own', свои: 'my your his her its our their own',
  своего: 'my your his her its our their own', своей: 'my your his her its our their own',
  своих: 'my your his her its our their own', своим: 'my your his her its our their own',
  своими: 'my your his her its our their own', свою: 'my your his her its our their own',
  своем: 'my your his her its our their own',
  // demonstratives, quantifiers and the negative pronouns
  это: 'this that it these those', этот: 'this that the', эта: 'this that the',
  эти: 'these those the', этого: 'this that', этой: 'this that', этих: 'these those',
  этом: 'this that', этим: 'this that these those',
  тот: 'that the', та: 'that the', те: 'those the', того: 'that', той: 'that', тех: 'those',
  весь: 'all whole every entire', вся: 'all whole every entire', все: 'all everyone everything every',
  всего: 'all everything', всех: 'all everyone', всем: 'all everyone everything',
  никто: 'no nobody one anyone', никого: 'no nobody one anyone', никому: 'no nobody one anyone',
  ничто: 'nothing anything', ничего: 'nothing anything', ничему: 'nothing anything',
  друг: 'friend each other another',
  // negation — "не" has to reach the expanded contraction, see englishWords
  не: 'not no', ни: 'not nor neither no', нет: 'no not there',
  // prepositions — the usual English realisations of each
  в: 'in into at to on inside during', во: 'in into at to on inside during',
  на: 'on onto at to in for by', с: 'with from off since together',
  со: 'with from off since together', к: 'to towards for', ко: 'to towards for',
  по: 'on along by according around per via through in',
  за: 'behind for beyond after at over', из: 'from out of',
  у: 'at by near with has have', о: 'about of on against', об: 'about of on against',
  обо: 'about of on against', от: 'from off by out', ото: 'from off by out',
  до: 'to until before up till', для: 'for to', при: 'at with under during in on',
  // «надо» is deliberately absent: the preposition (a variant of над) is rare,
  // while «надо» "it is necessary" is everywhere, and listing it would let the
  // common word align against "above" and hide real misses.
  над: 'above over on', под: 'under below beneath near',
  подо: 'under below beneath', про: 'about of', через: 'through across in over after via',
  без: 'without no', между: 'between among', перед: 'before in front ahead of',
  передо: 'before in front ahead of', около: 'near about around by',
  против: 'against opposite', вместо: 'instead of', кроме: 'except besides apart',
  среди: 'among amid amongst', вокруг: 'around round about',
}).map(([ru, en]) => [ru, en.split(' ')]))

/**
 * Crude English stemmer — enough to align "victories" with "victory" and
 * "running" with "run" without pulling in a morphology library. It over-stems
 * happily; a false alignment costs one missed flag, while the alternative
 * (exact matching) floods the report with inflection noise.
 * @param {string} word
 * @returns {string}
 */
export function stemEnglish(word) {
  let stem = String(word ?? '')
  stem = stem.replace(/ies$/, 'y').replace(/ves$/, 'f')
  stem = stem.replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2))
  stem = stem.replace(/([^s])s$/, '$1')
  stem = stem.replace(/ied$/, 'y')
  const stripped = stem.replace(/(ing|ed)$/, '')
  // Undo consonant doubling, but only where a suffix was actually removed —
  // otherwise "glass" and "hill" lose a letter they never gained.
  return stripped === stem ? stem : stripped.replace(/(.)\1$/, '$1')
}

/** Do two English words plausibly realise the same lexeme? */
export function alignsWith(a, b) {
  if (a === b) return true
  const sa = stemEnglish(a)
  const sb = stemEnglish(b)
  if (sa === sb) return true
  // A shared 4-char prefix catches derivational pairs the stemmer misses
  // (beauty/beautiful, possible/possibility) at the cost of some false links.
  return sa.length >= 4 && sb.length >= 4 && (sa.startsWith(sb) || sb.startsWith(sa))
}

/**
 * The alignable English words of a gloss. Glosses carry a parenthetical
 * disambiguator ("bus (a large road vehicle for many people)") whose words are
 * explanation, not translation, so only the head is used.
 * @param {string} gloss
 * @returns {string[]}
 */
export function glossHeadWords(gloss) {
  const head = String(gloss ?? '').split('(')[0]
  return englishWords(head).filter((w) => !EN_GRAMMATICAL.has(w))
}

/**
 * Greedily align the Russian tokens of a phrase against the words of its English
 * translation, one English word consumed per Russian token.
 *
 * Greedy rather than optimal on purpose: an exact assignment would be
 * marginally more accurate and much harder to explain when someone asks why a
 * given phrase was flagged. Ties are broken by English word order, which is
 * stable and reproducible.
 *
 * @param {string} ru       the Russian sentence
 * @param {string} en       its English translation
 * @param {Map} index       from {@link buildFormIndex}
 * @returns {{content: number, glossMisses: Array<{ru: string, gloss: string}>,
 *   unglossed: string[], addedEnglish: string[], literalness: number}}
 */
export function alignPhrase(ru, en, index) {
  const tokens = phraseHintTokens(ru, index).filter((t) => normToken(t.text))
  const pool = englishWords(en).filter((w) => !EN_GRAMMATICAL.has(w))
  const consumed = new Set()
  const glossMisses = []
  const unglossed = []
  let content = 0

  for (const token of tokens) {
    const form = normToken(token.text)
    if (RU_PARTICLES.has(form)) continue
    content += 1
    const closed = CLOSED_CLASS.get(form)
    if (!closed && !token.hint) {
      // No dictionary entry at all — a gloss-coverage hole, tracked separately
      // because the fix is to add a word, not to retranslate the sentence.
      unglossed.push(token.text)
      continue
    }
    const candidates = closed ?? glossHeadWords(token.hint.en)
    const at = pool.findIndex((word, i) => !consumed.has(i) && candidates.some((c) => alignsWith(c, word)))
    if (at === -1) glossMisses.push({ ru: token.text, gloss: closed ? candidates.join('/') : token.hint.en })
    else consumed.add(at)
  }

  const addedEnglish = pool.filter((_, i) => !consumed.has(i))
  const aligned = content - glossMisses.length - unglossed.length
  return {
    content,
    glossMisses,
    unglossed,
    addedEnglish,
    literalness: content ? aligned / content : 1,
  }
}

/** Clause-structure markers on the Russian side, a proxy for restructuring. */
function clauseMarkers(ru) {
  const text = String(ru ?? '')
  return {
    commas: (text.match(/,/g) || []).length,
    dash: /[—–]/.test(text),
    colon: /[:;]/.test(text),
  }
}

/**
 * Signals for one phrase, plus the tier a review pass should read it in.
 * @param {{ru: string, en: string, source?: string, cefr?: string}} phrase
 * @param {Map} index  from {@link buildFormIndex}
 */
export function auditPhrase(phrase, index) {
  const ru = String(phrase?.ru ?? '')
  const en = String(phrase?.en ?? '')
  const alignment = alignPhrase(ru, en, index)
  const ruLength = phraseHintTokens(ru, index).filter((t) => normToken(t.text)).length
  const enLength = englishWords(en).length
  const markers = clauseMarkers(ru)
  const row = {
    ru,
    en,
    source: phrase?.source ?? '',
    cefr: phrase?.cefr ?? '',
    ...alignment,
    ruLength,
    enLength,
    lengthRatio: ruLength ? enLength / ruLength : 0,
    ...markers,
  }
  row.tier = tierOf(row)
  return row
}

/**
 * Which review tier a phrase falls in.
 *
 * `high` is where defects were densest when the signals were sampled by hand:
 * a sentence whose words mostly fail to align is either idiomatic (a deliberate
 * call worth confirming) or genuinely loose. `medium` collects the weaker
 * signals — added English, clause markers, an English rendering much longer than
 * its Russian. `clean` trips nothing and is sampled rather than swept.
 */
export function tierOf(row) {
  if (row.unglossed.length > 0) return 'high'
  if (row.content >= 3 && row.literalness <= 0.5) return 'high'
  if (row.glossMisses.length >= 3) return 'high'
  if (row.glossMisses.length >= 2) return 'medium'
  if (row.addedEnglish.length >= 2) return 'medium'
  if (row.commas > 0 || row.dash || row.colon) return 'medium'
  if (row.lengthRatio > 1.8) return 'medium'
  return 'clean'
}

/**
 * A single number for ordering within a tier — larger is more suspicious. Built
 * so that the components can't silently cancel out: every term is non-negative.
 */
export function priorityScore(row) {
  return (
    (1 - row.literalness) * 4 * Math.min(row.content, 8) +
    row.unglossed.length * 6 +
    row.addedEnglish.length * 1.5 +
    row.commas * 1.5 +
    (row.dash ? 1.5 : 0) +
    (row.colon ? 1.5 : 0) +
    Math.max(0, row.lengthRatio - 1.5) * 3
  )
}

/**
 * Audit a whole phrase bank, most suspicious first.
 * @param {object[]} phrases  from shapePhrases (vocabBuild.js)
 * @param {object[]} words    normalised word records, for the gloss index
 */
export function auditPhrases(phrases, words) {
  const index = buildFormIndex(words)
  return (phrases ?? [])
    .map((p) => {
      const row = auditPhrase(p, index)
      row.priority = priorityScore(row)
      return row
    })
    .sort((a, b) => b.priority - a.priority || a.ru.localeCompare(b.ru, 'ru'))
}

/** Tier counts, for a report header. */
export function tierCounts(rows) {
  const counts = { high: 0, medium: 0, clean: 0 }
  for (const row of rows ?? []) counts[row.tier] = (counts[row.tier] ?? 0) + 1
  return counts
}
