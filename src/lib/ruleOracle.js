// The rule oracle: when a wrong answer breaks a rule the learner could have
// *stated*, say the rule (#646).
//
// Most wrong endings are just the declension or the conjugation not being known
// yet, and there is nothing short to say about them — the drill's own error map
// and the reveal's grammar rule already do that job. A few misses are different:
// they break a rule that fits in one line and applies everywhere, so naming it
// once turns a whole class of future slips into a thing the learner can check.
// Typing «кни́гы» is not a gap in the genitive singular — it is the seven-letter
// rule, and the ending was otherwise right.
//
// Three families qualify, and deliberately no more:
//
//   1. ORTHOGRAPHIC rules — the letter after г/к/х/ж/ч/ш/щ/ц is decided by
//      spelling convention, not by the case: и never ы, а/у never я/ю, е when
//      unstressed and о under stress, ы in an ending after ц. A rule that says
//      where a letter is REQUIRED also says where it is not, so the seven-letter
//      rule fires from either side: ы after one of the seven breaks it, and so
//      does и in the one place ы was the spelling all along.
//   2. ANIMACY — the accusative of an animate noun (and of the adjective
//      agreeing with it) copies the genitive. It is a rule about the *word*, not
//      about the ending, so knowing it really does settle the answer.
//   3. PREPOSITION GOVERNMENT — a preposition that only ever takes one case.
//      «без» is genitive every single time; that is worth saying out loud.
//
// What does NOT qualify: ordinary declension and conjugation. "The genitive
// singular of a feminine noun is -ы" is not a reminder, it is the lesson, and
// the drill is already teaching it.
//
// Pure and framework-free — the spelling drill, the endings table and the
// in-context inflection drill all share it, so their reminders can't drift.
import { CASE_LABELS, ACC_ANIMATE } from './declension.js'
import { matchingCells } from './paradigm.js'
import { normalize, stripStress } from './text.js'

/** The vowels a stress mark can land on — used to find an unmarked monosyllable. */
const VOWELS = 'аеёиоуыэюя'

/** The seven letters that take и and never ы. */
const SEVEN = 'гкхжчшщ'

/**
 * The paired consonants — the letters ы actually follows, and so the only ones
 * the seven-letter rule can be read backwards against. ц is left out because it
 * has a rule of its own (и in a root, ы in an ending), and so are ь, й and the
 * vowels, after which ы never appears at all: no ы is possible there, so an и
 * there is not the seven-letter rule being over-applied.
 */
const PAIRED = 'бвдзлмнпрстф'

/** Every acute-accent variant `text.js` folds; here they mark the vowel before. */
const STRESS_MARKS = new Set(['\u0301', '\u0341', '\u00B4', '\u02CA'])

/**
 * Split a Russian string into bare letters plus, per letter, whether it is
 * stressed. `ё` counts as stressed (it always is), and a word with no mark and
 * a single vowel is stressed on that vowel — so «шёл» and «нож» are both known
 * quantities without an accent having been authored.
 *
 * `stressKnown` is false when nothing in the string says where the stress is;
 * the о/е rule then states itself generically rather than guessing.
 */
function analyse(value) {
  const letters = []
  const stressed = []
  for (const ch of String(value ?? '').toLowerCase()) {
    if (STRESS_MARKS.has(ch)) {
      if (stressed.length) stressed[stressed.length - 1] = true
      continue
    }
    letters.push(ch)
    stressed.push(ch === 'ё')
  }
  let known = stressed.some(Boolean)
  if (!known) {
    const vowels = letters.map((c, i) => (VOWELS.includes(c) ? i : -1)).filter((i) => i >= 0)
    if (vowels.length === 1) {
      stressed[vowels[0]] = true
      known = true
    }
  }
  return { letters, stressed, known }
}

/**
 * The orthographic rules, strongest first. Each `match` sees one differing
 * letter — what was typed, what was wanted, the letter *before* it in the
 * answer, and whether the answer stresses that vowel (null when unknown) — and
 * returns a variant name, or null when this isn't its business.
 *
 * A rule fires from both sides only where both sides are the same mistake. The
 * seven-letter rule is one: и and ы divide the same slot between them, so either
 * letter in the other's place is the one rule misjudged. The eight-letter rule
 * is not, and stays one-directional — а/у where я/ю belonged says nothing about
 * г, к, х and the hushers, it is the ordinary hard/soft stem the drill is
 * already teaching, while «парашу́т» for «парашю́т» is a loanword exception
 * biting, and telling that learner to write у for ю would be the opposite of
 * help.
 */
export const SPELLING_RULES = Object.freeze([
  Object.freeze({
    id: 'spelling-i-not-y',
    name: 'the seven-letter rule',
    match: ({ got, want, prev }) => {
      // ы after one of the seven: the rule broken head-on.
      if (SEVEN.includes(prev) && got === 'ы' && want === 'и') return 'i'
      // и where ы was wanted, after a letter the rule never covered: the same
      // rule over-applied. ы is the only letter the seven-letter rule ever
      // mentions, and a learner who has heard "и, never ы" often takes that as
      // "never ы", so saying how far the rule reaches is the whole fix.
      if (PAIRED.includes(prev) && got === 'и' && want === 'ы') return 'y'
      return null
    },
    detail: (variant) =>
      variant === 'y'
        ? 'и is the spelling after г, к, х, ж, ч, ш and щ — after the other hard consonants the letter is ы.'
        : 'After г, к, х, ж, ч, ш and щ Russian writes и — never ы.',
  }),
  Object.freeze({
    id: 'spelling-a-u-not-ya-yu',
    name: 'the eight-letter rule',
    match: ({ got, want, prev }) =>
      'гкхжчшщц'.includes(prev) && ((got === 'я' && want === 'а') || (got === 'ю' && want === 'у'))
        ? 'au'
        : null,
    detail: () => 'After г, к, х, ж, ч, ш, щ and ц Russian writes а and у — never я or ю.',
  }),
  Object.freeze({
    id: 'spelling-o-e-after-sibilant',
    name: 'the о/е rule after a sibilant',
    match: ({ got, want, prev, stressed }) => {
      if (!'жчшщц'.includes(prev)) return null
      const o = (c) => c === 'о' || c === 'ё'
      // Unstressed the vowel can only be е — including against ё, which is
      // always stressed and so can never be the unstressed spelling.
      if (stressed === false && o(got) && want === 'е') return 'unstressed'
      // Stressed it is о in an ending and ё in a root; both are the same rule
      // seen from either side, and the learner reached for the wrong one.
      if (stressed === true && o(got) && want === 'ё') return 'yo'
      if (stressed === true && (got === 'е' || got === 'ё') && o(want)) return 'stressed'
      if (stressed === null && ((got === 'о' && want === 'е') || (got === 'е' && want === 'о')))
        return 'either'
      return null
    },
    detail: (variant) =>
      variant === 'stressed'
        ? 'The stress falls on this vowel, so after ж, ч, ш, щ or ц it is о — е is the unstressed spelling.'
        : variant === 'yo'
          ? 'Stressed inside a root, the vowel after ж, ч, ш or щ is written ё rather than о.'
          : variant === 'unstressed'
            ? 'Unstressed after ж, ч, ш, щ or ц the vowel is е; о belongs under the stress.'
            : 'After ж, ч, ш, щ and ц the vowel is о under the stress and е without it.',
  }),
  Object.freeze({
    id: 'spelling-y-not-i-after-ts',
    name: 'the и/ы rule after ц',
    match: ({ got, want, prev }) =>
      prev === 'ц' && ((got === 'и' && want === 'ы') || (got === 'ы' && want === 'и'))
        ? got === 'и'
          ? 'ending'
          : 'root'
        : null,
    detail: () => 'After ц an ending takes ы; inside a root the letter stays и.',
  }),
])

/**
 * Did a wrong answer break an orthographic rule — and nothing else?
 *
 * The alignment has to be unambiguous, so the two strings must be the same
 * length once stress is dropped: an inserted or dropped letter means guessing
 * which letters correspond, and a guess would name the wrong rule. Every
 * differing letter must then be explained by a rule. One unexplained slip and
 * the answer was not "right but for the rule", so there is nothing to remind
 * anybody of and the drill's ordinary feedback is the honest response.
 *
 * @param {string} typed the learner's answer
 * @param {string} want  the wanted form, accented as the corpus stores it
 * @returns {{kind: 'spelling', ruleId: string, variant: string, got: string,
 *   want: string, name: string, detail: string}|null}
 */
export function spellingRuleMiss(typed, want) {
  const a = analyse(String(typed ?? '').trim())
  const b = analyse(String(want ?? '').trim())
  if (!b.letters.length || a.letters.length !== b.letters.length) return null
  const diffs = b.letters.map((_, i) => i).filter((i) => a.letters[i] !== b.letters[i])
  if (!diffs.length) return null
  let first = null
  for (const i of diffs) {
    const ctx = {
      got: a.letters[i],
      want: b.letters[i],
      prev: i > 0 ? b.letters[i - 1] : '',
      stressed: b.known ? b.stressed[i] : null,
    }
    let hit = null
    for (const rule of SPELLING_RULES) {
      const variant = rule.match(ctx)
      if (variant) {
        hit = { rule, variant, ctx }
        break
      }
    }
    // A slip no rule explains: knowing the rule would not have produced the
    // right answer, which is the whole test this oracle applies.
    if (!hit) return null
    if (!first) first = hit
  }
  return {
    kind: 'spelling',
    ruleId: first.rule.id,
    variant: first.variant,
    name: first.rule.name,
    got: first.ctx.got,
    want: first.ctx.want,
    detail: first.rule.detail(first.variant),
  }
}

/**
 * Prepositions that govern exactly ONE case, mapped to it. Only these can carry
 * a reminder: «в» takes the accusative or the prepositional depending on what
 * the sentence means, so "«в» takes the prepositional" would be a half-truth
 * dressed as a rule, while «без» really is genitive every single time.
 *
 * A closed table rather than a read of the corpus, so the module stays
 * data-free — `ruleOracleData.test.js` holds it to `prepositions.yml`, in both
 * directions, so the two cannot drift.
 */
export const SINGLE_CASE_PREPOSITIONS = Object.freeze({
  без: 'gen',
  вдоль: 'gen',
  вместо: 'gen',
  вне: 'gen',
  возле: 'gen',
  вокруг: 'gen',
  для: 'gen',
  до: 'gen',
  из: 'gen',
  изо: 'gen',
  кроме: 'gen',
  мимо: 'gen',
  насчёт: 'gen',
  около: 'gen',
  от: 'gen',
  помимо: 'gen',
  после: 'gen',
  посреди: 'gen',
  против: 'gen',
  путём: 'gen',
  ради: 'gen',
  среди: 'gen',
  у: 'gen',
  благодаря: 'dat',
  вслед: 'dat',
  к: 'dat',
  ко: 'dat',
  по: 'dat',
  меж: 'ins',
  над: 'ins',
  перед: 'ins',
  включая: 'acc',
  несмотря: 'acc',
  про: 'acc',
  сквозь: 'acc',
  спустя: 'acc',
  через: 'acc',
  о: 'pre',
  при: 'pre',
})

/** The grammar rule that teaches "this preposition always takes that case". */
export const prepositionRuleId = (kase) => (kase ? `prep-gov-${kase}` : null)

/** Every rule id the oracle can name — the ids `grammar-rules.yml` must carry. */
export const ORACLE_RULES = Object.freeze(
  new Set([
    ...SPELLING_RULES.map((r) => r.id),
    ...new Set(Object.values(SINGLE_CASE_PREPOSITIONS).map(prepositionRuleId)),
    'noun-acc-animate',
    'adj-acc-animate',
  ]),
)

/** A token stripped to its word core: no stress, no punctuation, lower case. */
const core = (token) =>
  stripStress(String(token ?? ''))
    .toLowerCase()
    .replace(/[^\p{L}-]/gu, '')

/**
 * The single-case preposition heading a slot, or null. Only the token
 * immediately before the slot counts: once an adjective (or anything else) sits
 * between, deciding whether the preposition really governs *this* word is a
 * guess — «Кни́га на столе́ интере́сная» would otherwise have «на» governing
 * «интере́сная».
 *
 * @param {string[]} tokens the sentence, tokenised
 * @param {number} index    the first token of the slot
 * @returns {{prep: string, case: string}|null}
 */
export function governingPreposition(tokens, index) {
  if (!Array.isArray(tokens) || !Number.isInteger(index) || index <= 0) return null
  const prep = core(tokens[index - 1])
  const kase = SINGLE_CASE_PREPOSITIONS[prep]
  return kase ? { prep, case: kase } : null
}

/**
 * Cases the learner's answer could be, named from the word's own paradigm.
 *
 * Confined to the slot's own column when the paradigm has one — the singular for
 * a singular slot, the masculine for a masculine adjective. Without that, an
 * answer that is simply the wrong NUMBER reads as a case error: «абза́ца» for
 * «абза́цы» would be reported as a genitive for an accusative, when the case was
 * never really the learner's mistake.
 */
function casesOf(paradigm, form, col) {
  if (!paradigm) return []
  const scoped = paradigm.cols.some((c) => c.key === col)
  return [
    ...new Set(
      matchingCells(paradigm, form)
        .filter((c) => !scoped || c.col === col)
        .map((c) => c.row),
    ),
  ]
}

/**
 * Did a wrong answer break animacy, or ignore a preposition that only ever
 * takes one case?
 *
 * Both need to know that the learner produced *another case of the right word*
 * rather than a misspelling, so both go through the word's own paradigm: an
 * answer matching no cell at all is a spelling miss, not a grammar one.
 *
 * @param {string} typed
 * @param {object} ctx
 * @param {object} ctx.paradigm  the target word's paradigm (lib/paradigm.js)
 * @param {string} ctx.wantCase  the paradigm row the slot wants — a case key, or
 *   `acc_anim` for an adjective agreeing with an animate noun
 * @param {boolean} [ctx.animate] whether the target noun is animate
 * @param {string} [ctx.wantCol] the paradigm column the slot sits in — the
 *   number for a noun, the gender (or `pl`) for an adjective
 * @param {string} [ctx.pos]     the target word's part of speech (picks the noun
 *   or the adjective wording of the animacy rule)
 * @param {string[]} [ctx.tokens] the sentence tokens
 * @param {number} [ctx.targetIndex] the slot's first token
 * @returns {{kind: 'case', ruleId: string, gotCase: string|null,
 *   wantCase: string, prep?: string}|null}
 */
export function caseRuleMiss(typed, ctx = {}) {
  const { paradigm, wantCase, wantCol, animate, pos, tokens, targetIndex } = ctx
  const answer = String(typed ?? '').trim()
  if (!answer || !paradigm || !wantCase) return null
  const got = casesOf(paradigm, answer, wantCol)
  // Not a form of this word (or already the wanted case, so it graded correct):
  // nothing about cases to say.
  if (!got.length || got.includes(wantCase)) return null
  const gotCase = got[0]

  // Animacy first — it is the more specific thing to say. Every animacy miss is
  // the same shape: the learner reached for the OTHER accusative. An adjective
  // agreeing with an animate noun wants the genitive-shaped row and got the
  // plain one; an animate noun wants the genitive-shaped form and got the
  // nominative; an inanimate noun wants the nominative-shaped one and got the
  // genitive.
  const animacyMiss =
    wantCase === ACC_ANIMATE
      ? got.includes('acc')
      : wantCase === 'acc' && animate === true
        ? got.includes('nom')
        : wantCase === 'acc' && animate === false
          ? got.includes('gen')
          : false
  if (animacyMiss) {
    return {
      kind: 'case',
      ruleId: pos === 'noun' ? 'noun-acc-animate' : 'adj-acc-animate',
      gotCase,
      wantCase: 'acc',
      animate: wantCase === ACC_ANIMATE || animate === true,
    }
  }

  // The animate accusative is still the accusative as far as a preposition is
  // concerned — the row name is the paradigm's, not the grammar's.
  const slotCase = wantCase === ACC_ANIMATE ? 'acc' : wantCase
  const governed = governingPreposition(tokens, targetIndex)
  if (governed && governed.case === slotCase) {
    return {
      kind: 'case',
      ruleId: prepositionRuleId(slotCase),
      gotCase,
      wantCase: slotCase,
      prep: governed.prep,
    }
  }
  return null
}

/**
 * The strongest rule a wrong answer broke: the orthographic reading first (it
 * is about the letters, so it is checkable on the spot), then the grammatical
 * one. Returns null — the common case by far — when the miss is an ordinary
 * gap the drill's own feedback already covers.
 *
 * @param {string} typed
 * @param {string} want the wanted form, accented
 * @param {object} [ctx] see {@link caseRuleMiss}
 */
export function ruleMiss(typed, want, ctx = {}) {
  if (normalize(typed) === normalize(want)) return null
  return spellingRuleMiss(typed, want) ?? caseRuleMiss(typed, ctx)
}

/** Case names as the reminders read them ("the genitive"). */
const caseName = (kase) => (CASE_LABELS[kase] ?? kase ?? '').toLowerCase()

/** Quote a Russian word the way the drills do. */
const q = (value) => `«${value}»`

/**
 * Turn a miss into the strings a component renders.
 *
 * **The reminder never spells the answer out.** It is shown while the learner is
 * still trying, so it may name letters, cases and the preposition already on
 * screen — never the form being asked for, and never an example word that might
 * be it. The worked examples live in the rule's own `grammar-rules.yml` entry,
 * which is for the reveal.
 *
 * @param {object|null} miss from {@link ruleMiss}
 * @param {object} [rules] parsed grammar-rules.yml `rules` map
 * @returns {{ruleId: string, headline: string, detail: string, rule: object|null}|null}
 */
export function ruleReminder(miss, rules = {}) {
  if (!miss?.ruleId) return null
  const rule = rules[miss.ruleId] ? { id: miss.ruleId, ...rules[miss.ruleId] } : null
  const out = (headline, detail) => ({ ruleId: miss.ruleId, headline, detail, rule })

  if (miss.kind === 'spelling') return out(`Remember ${miss.name}`, miss.detail)

  const gave = miss.gotCase ? ` You gave the ${caseName(miss.gotCase)}.` : ''
  if (miss.prep) {
    return out(
      `${q(miss.prep)} always takes the ${caseName(miss.wantCase)}`,
      `That is the one case it ever governs, whatever the sentence means.${gave}`,
    )
  }
  return out(
    miss.animate ? 'Remember: an animate accusative' : 'Remember: an inanimate accusative',
    miss.animate
      ? `The accusative of an animate noun — and of the adjective agreeing with it — copies the genitive.${gave}`
      : `The accusative of an inanimate noun copies the nominative, not the genitive.${gave}`,
  )
}
