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
  // A participle or gerund forces an English subordinate clause whose
  // conjunction has no Russian token behind it — see PARTICIPLE_PATTERNS.
  const nonFinite = hasNonFinite(tokens.map((t) => t.text), ru)
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

  // Excuse the forced subordinator only after alignment, not before: «что»
  // glosses as "that" and must keep the chance to claim it. Only a subordinator
  // still unclaimed at the end is the one English grammar added by itself.
  const addedEnglish = pool.filter(
    (word, i) => !consumed.has(i) && !(nonFinite && SUBORDINATORS.has(word)),
  )
  const aligned = content - glossMisses.length - unglossed.length
  return {
    content,
    glossMisses,
    unglossed,
    addedEnglish,
    literalness: content ? aligned / content : 1,
  }
}

/**
 * Russian participle and gerund morphology.
 *
 * These constructions are single words that English can only render as a
 * subordinate clause — «Люби́вший её челове́к уе́хал» is "The man **who** loved
 * her has left", «Де́лая уро́ки…» is "**While** doing his homework…". The
 * subordinator is forced by English grammar and has no Russian token behind it,
 * so without this the whole class scores as over-translation: measured against
 * the participle sentences added in #564, 77% tripped a signal versus 38% for
 * the corpus at large, all of them correctly translated.
 *
 * The patterns are deliberately tight. A false positive only licenses a "that"
 * that would otherwise have been flagged; a false negative buries a real defect
 * under a structural artefact. Short-form passives (при́нят, решена́) are left
 * out entirely — they are indistinguishable from ordinary short adjectives and
 * from он/она́/они́ by suffix alone, and they render with auxiliaries that are
 * already treated as grammatical.
 */
const PARTICIPLE_PATTERNS = [
  // active present (-щий) and active past (-вший), in any adjectival cell
  /(щ|вш)(ий|ая|ее|ие|его|ей|ему|им|их|ими|ую|ем|юю)$/,
  // long-form passive past: -анный / -янный / -енный / -ённый and -тый
  /(анн|янн|енн|ённ|ыт|ят)(ый|ая|ое|ые|ого|ой|ых|ым|ыми|ую|ом)$/,
  // perfective gerunds: сде́лав, поду́мав, верну́вшись
  /вши(сь)?$/,
  /[аяеои]в$/,
  /ясь$/,
]

/**
 * Does the phrase contain a participle or gerund?
 *
 * The imperfective gerund (де́лая, игра́я) ends in a bare -я, which is also every
 * feminine nominative singular in the language, so suffix matching alone cannot
 * see it. It is recognised only in its canonical position — opening a
 * comma-delimited adverbial clause — which is where the corpus puts it.
 */
function hasNonFinite(tokens, ru) {
  return tokens.some((token, i) => {
    const form = normToken(token)
    if (!form) return false
    if (PARTICIPLE_PATTERNS.some((re) => re.test(form))) return true
    return i === 0 && /я$/.test(form) && /,/.test(ru)
  })
}

/**
 * English subordinators a participle or gerund forces into the translation.
 * Licensed only when the Russian actually contains one — «кото́рый» carries its
 * own gloss and aligns on its own, so a relative pronoun in an ordinary sentence
 * still counts as added.
 */
const SUBORDINATORS = new Set([
  'who', 'whom', 'whose', 'which', 'that',
  'while', 'when', 'after', 'having', 'being',
])

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
    // Carried, not scored. An alternate is never shown, so it cannot make a
    // sentence read worse — but a packet has to serialise it or the reviewer
    // judges a sentence without seeing what it already accepts (#599).
    enAlt: Array.isArray(phrase?.enAlt) ? phrase.enAlt : [],
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

/**
 * English auxiliaries and modals, in the order they can stack. Together with the
 * main verb they carry the whole tense/aspect/modality frame, which is what a
 * learner reads to tell a Russian aspect pair apart.
 */
const EN_AUXILIARIES = new Set([
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'have', 'has', 'had', 'be', 'been', 'being', 'is', 'are', 'am', 'was', 'were',
  'do', 'does', 'did', 'used', 'going', 'about',
])

/**
 * How a phrase's English renders one particular verb: the auxiliary chain plus
 * the stem of the word that translates the verb itself — "would hear",
 * "would have hear(d)", "is read(ing)".
 *
 * Returns null when the English contains nothing recognisable as that verb, in
 * which case the two sides can't be compared and nothing is claimed.
 *
 * @param {string} en    the English translation
 * @param {object} word  the verb's normalised record (for its gloss)
 * @returns {string|null}
 */
export function verbRendering(en, word) {
  const candidates = glossHeadWords(word?.meaning ?? word?.en ?? '')
  if (!candidates.length) return null
  const pool = englishWords(en)
  const at = pool.findIndex((w) => candidates.some((c) => alignsWith(c, w)))
  if (at === -1) return null
  // The main verb keeps its SURFACE form. Stemming it would fold "thanked" into
  // "thank" and erase the tense, which is often the whole cue distinguishing a
  // perfective sentence from its imperfective partner.
  const auxiliaries = pool.slice(0, at).filter((w) => EN_AUXILIARIES.has(w))
  return [...auxiliaries, pool[at]].join(' ')
}

/**
 * Sentence pairs across an aspect (or motion) pair whose English renders both
 * members identically.
 *
 * The aspect-contrast drill draws sentences from both members of a pair and
 * asks the learner which verb each one is — with the English as the cue. When a
 * sentence of «слы́шать» and a sentence of «услы́шать» both read "I would
 * hear…", that question has two right answers and the drill marks one wrong
 * (#576). The Russian is fine in both; it is the English that has thrown the
 * distinction away, so it is a translation defect and belongs in this review.
 *
 * Only exact frame matches are reported. A near-miss ("would hear" vs "would be
 * hearing") is a real distinction a learner can act on, and flagging those would
 * bury the genuine collisions.
 *
 * @param {object[]} words     normalised word records (from buildWords)
 * @param {object[]} phrases   from shapePhrases, carrying `source`
 * @returns {Array<{pair: string, rendering: string, a: object, b: object}>}
 */
/** Compare two English sentences ignoring case, punctuation and spacing. */
export const normaliseEnglish = (en) => englishWords(en).join(' ')

export function aspectCollisions(words, phrases) {
  const byKey = new Map((words ?? []).map((w) => [w.key, w]))
  const bySource = new Map()
  for (const p of phrases ?? []) {
    if (!bySource.has(p.source)) bySource.set(p.source, [])
    bySource.get(p.source).push(p)
  }

  const out = []
  const seen = new Set()
  for (const word of words ?? []) {
    // Aspect pairs only. A determinate/indeterminate motion pair (бежа́ть /
    // бе́гать) has no distinct English verb form at all — both are "running" —
    // so the cue is necessarily the rest of the sentence ("to the river" vs "in
    // the yard"), and a matching verb frame there proves nothing.
    for (const link of [word.aspectPair]) {
      const partner = link && byKey.get(link.key)
      if (!partner) continue
      // Each unordered pair is examined once.
      const pairId = [word.key, partner.key].sort().join(' / ')
      if (seen.has(pairId)) continue
      seen.add(pairId)

      const mine = (bySource.get(word.key) ?? [])
        .map((p) => ({ phrase: p, rendering: verbRendering(p.en, word) }))
        .filter((r) => r.rendering)
      const theirs = (bySource.get(partner.key) ?? [])
        .map((p) => ({ phrase: p, rendering: verbRendering(p.en, partner) }))
        .filter((r) => r.rendering)

      for (const a of mine) {
        for (const b of theirs) {
          if (a.rendering !== b.rendering) continue
          // Two severities. When the whole English sentence matches, the drill
          // question is *unanswerable* — the learner is shown one string and
          // asked which of two verbs it is. When only the verb frame matches,
          // the rest of the sentence may still carry a usable cue, so it is a
          // read-and-judge finding rather than an outright bug.
          const identical = normaliseEnglish(a.phrase.en) === normaliseEnglish(b.phrase.en)
          out.push({
            pair: pairId,
            rendering: a.rendering,
            severity: identical ? 'identical' : 'frame',
            a: { key: word.key, ru: a.phrase.ru, en: a.phrase.en },
            b: { key: partner.key, ru: b.phrase.ru, en: b.phrase.en },
          })
        }
      }
    }
  }
  // Unanswerable questions first.
  return out.sort((a, b) => (a.severity === 'identical' ? 0 : 1) - (b.severity === 'identical' ? 0 : 1))
}

/**
 * Distinct Russian sentences sharing one English translation.
 *
 * The aspect-pair case ({@link aspectCollisions}) is the sharpest instance of a
 * wider problem: whenever two different Russian sentences carry byte-identical
 * English, any drill that prompts from the English has two right answers and
 * scores one of them wrong. It shows up in three shapes, which want different
 * fixes, so this reports them rather than judging:
 *
 *  - **near-synonym pairs** — «Не беспоко́йся…» / «Не волну́йся…» both "Don't
 *    worry, everything will be fine." The words are genuinely close; the
 *    sentences need to diverge enough for the English to pick one.
 *  - **government or case contrasts** — «Я жду авто́буса» / «Я жду авто́бус»,
 *    the genitive and accusative objects of ждать, whose difference in nuance
 *    the shared English throws away.
 *  - **outright data bugs** — two copies of one sentence that disagree on
 *    something. «По сре́дам…» / «По среда́м…» is the same sentence stressed two
 *    ways, and only one of them can be right.
 *
 * Sentences differing only in stress or ё/е are still *different* here: the
 * comparison is on the raw Russian, because a stress disagreement between two
 * copies is exactly the bug worth surfacing.
 *
 * @param {object[]} phrases  from shapePhrases, carrying `source`
 * @returns {Array<{en: string, phrases: Array<{ru: string, source: string}>}>}
 */
export function duplicateEnglish(phrases) {
  const byEnglish = new Map()
  for (const p of phrases ?? []) {
    const key = englishWords(p.en).join(' ')
    if (!key) continue
    if (!byEnglish.has(key)) byEnglish.set(key, [])
    byEnglish.get(key).push(p)
  }
  const out = []
  for (const group of byEnglish.values()) {
    // A single sentence reused under two headwords is one phrase, not a clash.
    if (new Set(group.map((p) => p.ru)).size < 2) continue
    out.push({
      en: group[0].en,
      phrases: group.map((p) => ({ ru: p.ru, source: p.source })),
    })
  }
  return out.sort((a, b) => b.phrases.length - a.phrases.length || a.en.localeCompare(b.en))
}

/** Tier counts, for a report header. */
export function tierCounts(rows) {
  const counts = { high: 0, medium: 0, clean: 0 }
  for (const row of rows ?? []) counts[row.tier] = (counts[row.tier] ?? 0) + 1
  return counts
}

/**
 * The content words of an English sentence, stemmed — what two renderings of
 * the same Russian must largely share.
 */
function contentStems(en) {
  return new Set(
    englishWords(en)
      .filter((w) => !EN_GRAMMATICAL.has(w))
      .map(stemEnglish)
      .filter(Boolean),
  )
}

/** How much of `a` the words of `b` account for, 0…1. */
function overlap(a, b) {
  if (!a.size) return 1
  let shared = 0
  for (const w of a) if (b.has(w)) shared += 1
  return shared / a.size
}

/**
 * How little an alternate may share with its own primary before it stops
 * looking like the same sentence — but only ever in conjunction with `block`
 * below, never on its own.
 *
 * On its own it does not work, and that is worth stating rather than
 * rediscovering: low content-word overlap is what a *good* English paraphrase
 * looks like. "I have a headache" and "My head hurts" share nothing and are
 * both right; so are "There was a ring at the door" / "The doorbell rang" and
 * 250-odd others in this corpus. #599 reported the same result from its own
 * scan. Overlap ranks nothing by itself.
 *
 * What does discriminate is overlap *plus* cohesion. Checked against the one
 * known instance — the three renderings of «Он рабо́тает с утра́ до ве́чера»
 * left behind on «Он дожда́лся у́тра до́ма» — the conjunction fires on all three
 * of its rows (0.33, 0.40, 0.40) and on five others in the whole corpus.
 */
const ORPHAN_OVERLAP = 0.5

/**
 * Triage a corpus's accepted alternate translations.
 *
 * `en_alt` was invisible to the first review: `--shard` serialised only `ru`
 * and the primary `en`, so all 16k sentences were swept without one accepted
 * answer being read (#599). That mattered less while the word bank built its
 * tiles from the primary alone and an alternate could be graded but never
 * assembled; once the bank was widened, every alternate became a reliably
 * offered, reliably accepted answer, and a bad row went from dormant to live.
 *
 * What an alternate can go wrong in is narrower than what a primary can, and
 * the signals reflect that. An alternate is never *shown* — no drill prompts
 * from one, the aspect-contrast drill included, which draws its cue from `en`
 * alone. So it cannot mislead a reader or make a question unanswerable. The
 * only harm it does is **grading looseness**: accepting, as correct, something
 * that is not a translation of this sentence.
 *
 *  - `duplicate` — normalises to the primary, or to a sibling alternate. Inert
 *    rather than wrong, but evidence that something merged without
 *    deduplicating, and the corpus holds 35 of them.
 *  - `orphan-block` — shares little with its primary *and* resembles its
 *    sibling alternates more than it resembles the primary. This is the
 *    «утро» signature: a block of renderings left behind when the Russian they
 *    belonged to was replaced. Neither half is usable alone (see above).
 *  - `block` — the cohesion half on its own. Weak: ты/вы pairs do this
 *    legitimately. Reported so the half-signature is visible, not ranked.
 *  - `foreign-partner` — verbatim the primary of a sentence belonging to this
 *    verb's **aspect partner**. Sharp, and the reason this audit exists at all:
 *    «Она́ благодари́ла учи́теля» ("She was thanking the teacher") accepts "She
 *    thanked the teacher", which is word for word the perfective partner's own
 *    sentence. A learner who answers the imperfective with the perfective
 *    reading is marked correct, which is #576 arriving through a door #576
 *    did not cover — grading rather than the contrast drill.
 *  - `foreign` — verbatim some other Russian sentence's primary. Weak: the
 *    corpus teaches near-synonyms on purpose, so two sentences legitimately
 *    share English. Reported, not judged.
 *  - `contradicted` — re-accepts the exact English a proposal replaced for not
 *    being English. The applier refuses these at write time now; nothing has
 *    ever checked the rows committed before that rule existed.
 *
 * @param {object[]} phrases   from shapePhrases, carrying `enAlt` and `source`
 * @param {object} [opts]
 * @param {object[]} [opts.words]        normalised word records, for aspect pairs
 * @param {Set<string>} [opts.rejected]  normalised English a proposal replaced
 * @returns {Array<{key: string, ru: string, en: string, alt: string,
 *   overlap: number, signals: string[]}>}
 */
export function auditAlternates(phrases, { words = [], rejected = new Set() } = {}) {
  const partnerOf = new Map()
  for (const w of words ?? []) {
    // Aspect pairs only. A determinate/indeterminate motion pair shares its
    // English verb by nature — «бежа́ть» and «бе́гать» are both "running" — so a
    // shared rendering there is not evidence of anything.
    if (w.aspectPair?.key) partnerOf.set(w.key, w.aspectPair.key)
  }
  const list = (phrases ?? []).filter((p) => (p.enAlt ?? []).length)
  // Every primary in the corpus, so `foreign` can tell "another sentence's
  // translation" from "a paraphrase nobody else uses".
  const primaries = new Map()
  for (const p of phrases ?? []) {
    const key = normaliseEnglish(p.en)
    if (!key) continue
    if (!primaries.has(key)) primaries.set(key, [])
    primaries.get(key).push({ ru: p.ru, source: p.source })
  }

  const out = []
  for (const p of list) {
    const primary = contentStems(p.en)
    const alts = p.enAlt.map((alt) => ({ alt, stems: contentStems(alt), norm: normaliseEnglish(alt) }))
    // Do the alternates hang together better than they hang off the primary?
    // A property of the block, so computed once per phrase.
    const cohesion = alts.length > 1
      && alts.every((a, i) => alts.some((b, j) => i !== j && overlap(a.stems, b.stems) > overlap(a.stems, primary)))

    const seen = new Set([normaliseEnglish(p.en)])
    for (const a of alts) {
      const signals = []
      if (seen.has(a.norm)) signals.push('duplicate')
      seen.add(a.norm)
      const share = overlap(a.stems, primary)
      if (cohesion) signals.push(share <= ORPHAN_OVERLAP ? 'orphan-block' : 'block')
      const elsewhere = (primaries.get(a.norm) ?? []).filter((o) => o.ru !== p.ru)
      const partner = partnerOf.get(p.source)
      if (elsewhere.some((o) => o.source === partner)) signals.push('foreign-partner')
      else if (elsewhere.length) signals.push('foreign')
      if (rejected.has(a.norm)) signals.push('contradicted')
      if (!signals.length) continue
      out.push({
        key: p.source,
        ru: p.ru,
        en: p.en,
        alt: a.alt,
        overlap: Number(share.toFixed(2)),
        signals,
        ...(elsewhere.length ? { alsoTranslates: elsewhere.map((o) => o.ru) } : {}),
      })
    }
  }
  // The «утро» shape first, then by how many signals and how little is shared.
  const SHARP = ['foreign-partner', 'orphan-block', 'contradicted']
  const rank = (r) => (r.signals.some((sig) => SHARP.includes(sig)) ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b) || b.signals.length - a.signals.length || a.overlap - b.overlap)
}
