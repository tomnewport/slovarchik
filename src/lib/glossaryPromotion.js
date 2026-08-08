// Glossary → curriculum promotion helpers (issue #326).
//
// `glossary.yml` holds ~2,300 gloss-only entries (`learn: false`) that exist
// only so phrase hints can translate every tappable word. A glossed word that
// keeps turning up inside example sentences is already *candidate* curriculum
// content — glossed, and frequency-implied by how often it appears — but there
// is no path from a glossary entry to a full, drillable vocab entry.
//
// This module is the analysis half of that path: it ranks glossary entries by
// how much tap-hint work they actually do in the corpus, and it scaffolds a
// *skeleton* entry for a chosen word. It is deliberately conservative. A
// promotion needs three things a script must NOT invent:
//   1. a **lemma** — glossary keys are surface forms, often inflected
//      («азии»=Asia, «автономных»=autonomous), and the CONTRIBUTING invariant
//      forbids reusing them as headwords without lemmatising first;
//   2. a full, correct **inflection table** — Russian declension/conjugation is
//      irregular and stress is mobile; a guessed grid is worse than none;
//   3. natural **usage** sentences — auto-generated examples read as robotic /
//      formulaic and defeat the point of the phrase drills.
//
// So the scaffolder emits schema-correct skeletons with explicit `TODO` /
// `⚠` / `✍` markers wherever human judgement is required, carries over only the
// safe data (the existing gloss and CEFR level), and points at the existing
// generators (`gen-adjective-declension.mjs`) rather than reproducing them. It
// never fabricates a form or a sentence. The pipeline promotes low authoring
// cost, not low authoring care.
//
// Pure and framework-free (no I/O) so it stays unit-testable; the CLI wrapper
// (`scripts/promote-glossary.mjs`) does the file reading.
import { shapePhrases } from './vocabBuild.js'
import { buildFormIndex, phraseHintTokens } from './phraseHint.js'
import { stripStress } from './text.js'

/** A glossary word record is a gloss-only entry from the `glossary` POS file. */
function isGlossary(word) {
  return word?.pos === 'glossary'
}

/**
 * Rank glossary entries by how often they actually gloss a word in the phrase
 * bank — the corpus-frequency signal the issue calls out. For every phrase we
 * resolve each tappable token to the dictionary entry that hints it (the same
 * two-pass form index the app uses); a glossary entry's count is the number of
 * phrase tokens it wins. Busiest first: those are the words whose promotion
 * grows the drillable curriculum the most per word authored.
 *
 * The count is intentionally the *resolved-hint* frequency, not a raw substring
 * match: a glossary form that always loses to a learnable homograph does no
 * tap-hint work and isn't really a promotion candidate.
 *
 * @param {object[]} words normalised word records (from buildWords) — the FULL
 *   list, glossary entries included.
 * @returns {Array<{key,ru,en,headword,cefr,count,phrases,guess,collision}>}
 *   one row per glossary entry that hints at least one phrase token, busiest
 *   first. `guess` is {@link guessPos}; `collision` names a learnable entry that
 *   already owns this meaning (a likely duplicate to reconcile before promoting).
 */
export function promotionCandidates(words) {
  const list = words ?? []
  const glossByKey = new Map(list.filter(isGlossary).map((w) => [w.key, w]))
  if (!glossByKey.size) return []

  // Learnable entries indexed by bare meaning, so we can flag a glossary word
  // whose meaning already exists in the curriculum (promoting it would dupe).
  const learnableByEn = new Map()
  for (const w of list) {
    if (w.learnable === false || isGlossary(w)) continue
    for (const en of [w.en, w.meaning].filter(Boolean)) {
      const k = en.toLowerCase()
      if (!learnableByEn.has(k)) learnableByEn.set(k, w)
    }
  }

  const index = buildFormIndex(list)
  const counts = new Map() // glossary key → { count, phrases:Set }
  for (const phrase of shapePhrases(list)) {
    for (const tok of phraseHintTokens(phrase.ru, index)) {
      // A homograph's hint carries one sense per entry that spells itself that
      // way, so credit each glossary sense — not just the entry's primary key.
      for (const { key } of tok.hint?.senses ?? []) {
        if (!glossByKey.has(key)) continue
        if (!counts.has(key)) counts.set(key, { count: 0, phrases: new Set() })
        const rec = counts.get(key)
        rec.count += 1
        rec.phrases.add(phrase.ru)
      }
    }
  }

  const rows = []
  for (const [key, { count, phrases }] of counts) {
    const w = glossByKey.get(key)
    const collision = learnableByEn.get((w.en || '').toLowerCase())
    rows.push({
      key,
      ru: w.ru,
      en: w.en,
      headword: w.headword || w.ru,
      cefr: w.cefr ?? null,
      count,
      phrases: [...phrases],
      guess: guessPos(w.ru),
      collision: collision ? collision.key : null,
    })
  }
  // Busiest first; ties broken alphabetically for a stable, reviewable order.
  return rows.sort((a, b) => b.count - a.count || a.ru.localeCompare(b.ru, 'ru'))
}

const VOWELS = 'аеёиоуыэюя'

/**
 * Best-effort part-of-speech guess from a bare Russian surface form. This is a
 * *hint for the human*, never a decision: it keys off the word's ending, which
 * is only sometimes diagnostic. Verb infinitives (-ть/-ти/-чь) and adjective
 * nominatives (-ый/-ий/-ой and the -ая/-ое/-ые agreement endings) are fairly
 * reliable; everything else defaults to `noun` with low confidence because a
 * bare consonant or -а/-о ending could be a noun, an adverb, or an oblique form
 * of something else entirely.
 *
 * @param {string} ru bare Russian (stress marks tolerated)
 * @returns {{pos: string, confidence: 'likely'|'uncertain', reason: string}}
 */
export function guessPos(ru) {
  const s = stripStress(String(ru ?? ''))
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim()
  const uncertain = (pos, reason) => ({ pos, confidence: 'uncertain', reason })
  const likely = (pos, reason) => ({ pos, confidence: 'likely', reason })
  if (!s) return uncertain('noun', 'empty')
  if (/\s/.test(s)) return uncertain('phrase', 'multi-word — likely a phrase, not a single lemma')

  // Verb infinitives.
  if (/(ться|тись)$/.test(s)) return likely('verb', 'reflexive infinitive ending -ться/-тись')
  if (/(ать|ять|еть|ить|уть|ыть|оть)$/.test(s)) return likely('verb', 'infinitive ending -ть')
  if (/(чь)$/.test(s)) return likely('verb', 'infinitive ending -чь (мочь, бере́чь)')
  if (/(ти)$/.test(s)) return likely('verb', 'infinitive ending -ти (идти́, нести́)')

  // Adjective nominatives and agreement endings.
  if (/(ый|ий|ой)$/.test(s)) return likely('adjective', 'masculine nominative ending -ый/-ий/-ой')
  if (/(ая|яя|ое|ее|ые|ие)$/.test(s)) {
    return uncertain('adjective', 'looks like an adjective agreement form — lemmatise to masc. nom.')
  }

  // Adverbs and neuter short forms overlap (-о/-е); genuinely ambiguous.
  if (/(о|е)$/.test(s) && !/(ое|ее)$/.test(s)) {
    return uncertain('adverb', 'ends -о/-е — could be an adverb or a neuter noun/short form')
  }

  // Feminine/neuter -а/-я/-о nouns, and the consonant/-ь default.
  if (/[аяоеьий]$/.test(s)) return uncertain('noun', 'vowel/soft ending — noun likely, verify')
  if (![...s].some((c) => VOWELS.includes(c))) return uncertain('noun', 'no vowel — atypical, verify')
  return uncertain('noun', 'consonant ending — masculine noun likely, verify')
}

/** Which file a promoted entry of this POS belongs in. */
const FILE_BY_POS = {
  noun: 'nouns.yml',
  verb: 'verbs.yml',
  adjective: 'adjectives.yml',
  adverb: 'adverbs.yml',
  pronoun: 'pronouns.yml',
  numeral: 'numerals.yml',
  preposition: 'prepositions.yml',
  conjunction: 'conjunctions.yml',
  interjection: 'interjections.yml',
}

/** Files whose inflection tables are generated, not hand-written. */
const GENERATED = {
  adjective: 'npm run gen:adjectives   # derives the 24-form declension from forms:',
}

const TODO = 'TODO' // sentinel a reviewer greps for before committing

/**
 * The POS-specific body lines (indented 4 spaces) of a scaffold. Every
 * inflected cell is a `TODO` placeholder — the tables are hand-authored (or, for
 * adjectives, generated from `forms:` by the existing script), never guessed
 * here. Returns an array of lines.
 */
function posSkeleton(pos) {
  const lines = []
  switch (pos) {
    case 'noun':
      lines.push(
        `    gender: ${TODO}            # m | f | n  — omit for pluralia tantum`,
        `    animacy: ${TODO}           # a (animate) | i (inanimate)`,
        `    number: ["sg", "pl"]   # ⚠ drop "sg" or "pl" if the noun lacks it`,
        `    declension:            # ✍ hand-author every cell (stress marked)`,
      )
      for (const num of ['sg', 'pl']) {
        for (const c of ['nom', 'gen', 'dat', 'acc', 'ins', 'pre']) {
          lines.push(`      ${num}_${c}: ${TODO}`)
        }
      }
      break
    case 'verb':
      lines.push(
        `    accented: ${TODO}         # infinitive, stressed`,
        `    aspect: ${TODO}           # impf | pf`,
        `    # pair: "<partner-key>"  # optional aspect partner (reciprocal)`,
        `    conjugation:           # ✍ hand-author; use future: for perfectives`,
        `      present:`,
      )
      for (const p of ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl']) {
        lines.push(`        "${p}": ${TODO}`)
      }
      for (const p of ['past_m', 'past_f', 'past_n', 'past_pl']) {
        lines.push(`      ${p}: ${TODO}`)
      }
      break
    case 'adjective':
      lines.push(
        `    accented: ${TODO}         # masculine nominative singular = headword`,
        `    forms:                 # ✍ the four nominatives, stress marked`,
        `      m: ${TODO}`,
        `      f: ${TODO}`,
        `      n: ${TODO}`,
        `      pl: ${TODO}`,
        `    # short: { m:, f:, n:, pl: }  # optional predicate forms`,
        `    # declension: generated — run \`npm run gen:adjectives\`, don't hand-write it`,
      )
      break
    case 'adverb':
      lines.push(
        `    accented: ${TODO}         # stressed dictionary form`,
        `    # forms: { comparative: <form> }  # only if it has a comparative`,
      )
      break
    case 'preposition':
      lines.push(
        `    accented: ${TODO}`,
        `    governs: [${TODO}]        # the case(s) it requires`,
      )
      break
    case 'conjunction':
      lines.push(`    accented: ${TODO}`, `    type: ${TODO}             # coord | subord`)
      break
    case 'interjection':
      lines.push(`    accented: ${TODO}`, `    type: ${TODO}             # greet | excl | polite | resp | …`)
      break
    case 'pronoun':
    case 'numeral':
      lines.push(
        `    accented: ${TODO}`,
        `    # ${pos}: see public/vocab/CONTRIBUTING.md for the ${pos} schema —`,
        `    # forms/declension depend on the sub-type; hand-author from the reference.`,
      )
      break
    default:
      lines.push(`    accented: ${TODO}`)
  }
  return lines
}

/**
 * Scaffold a hand-authoring stub for one glossary word. Returns a string ready
 * to review, complete, and paste into the right `*.yml` file. It is NOT a
 * finished entry: every `TODO` must be filled, every `⚠`/`✍` addressed, and the
 * lemma verified before it goes anywhere near the curriculum.
 *
 * Only the gloss and CEFR level are carried over from the glossary entry, and
 * both come across flagged for review — the level especially, since glossary
 * levels are auto-generated and unaudited. The lemma defaults to the surface
 * form but is marked for verification unless the caller passes a
 * hand-lemmatised one.
 *
 * @param {object} word    the glossary word record (from buildWords)
 * @param {object} [opts]
 * @param {string} [opts.pos]    target POS (defaults to the {@link guessPos} guess)
 * @param {string} [opts.lemma]  hand-supplied lemma (bare Russian); when omitted
 *   the surface form is used and flagged as unverified.
 * @returns {string}
 */
export function scaffoldEntry(word, opts = {}) {
  if (!word) throw new Error('scaffoldEntry: no word')
  const guess = guessPos(word.ru)
  const pos = opts.pos || guess.pos
  const file = FILE_BY_POS[pos] || `${pos}.yml`
  const lemmaSupplied = Boolean(opts.lemma)
  const lemma = (opts.lemma || word.ru).trim()
  const en = word.en || `${TODO}-en`
  // Glossary levels are auto-generated and have never been audited — the three
  // spellings of the same decade sit at B1, B2 and B1 (see CEFR-AUDIT.md), and
  // `learn: false` means nothing has ever had to be right about them. Carrying
  // one into the curriculum unmarked would launder a guess into a learner-facing
  // label and into batch selection, so it comes across flagged like every other
  // reused field.
  const cefr = word.cefr
    ? `${word.cefr}   # ⚠ carried from the glossary (unaudited) — set the real level`
    : `${TODO}  # A1 | A2 | B1 | B2 | C1 | C2`
  const gloss = word.meaningFull || word.meaning || `${TODO}-gloss`

  const header = [
    `# ─── promotion scaffold: ${word.key} → ${file} ─────────────────────────`,
    `# ⚠ NOT a finished entry. Resolve every ${TODO}, ✍ and ⚠ before committing.`,
    `# Glossary keys are SURFACE forms — verify the lemma below is the dictionary`,
    `#   form (noun: nominative singular · verb: infinitive · adjective: masc. nom.).`,
    lemmaSupplied
      ? `#   Lemma supplied by hand: "${lemma}".`
      : `#   ⚠ Lemma defaulted to the surface form "${word.ru}" — CONFIRM or replace it.`,
    `# POS: ${pos}${opts.pos ? '' : `  (guessed — ${guess.confidence}: ${guess.reason})`}`,
    GENERATED[pos] ? `# Inflection table is generated — after filling forms: run \`${GENERATED[pos].split('#')[0].trim()}\`.` : `# Inflection table is hand-authored — see public/vocab/CONTRIBUTING.md.`,
    `# Then: sort (node scripts/sort-vocab.js public/vocab/${file}), regenerate`,
    `#   inflect annotations if useful (node scripts/annotate-inflect.mjs --apply),`,
    `#   and run npm test.`,
  ]

  const body = [
    `  "${lemma}=${en}":`,
    `    cefr_level: ${cefr}`,
  ]
  body.push(...posSkeleton(pos))
  body.push(
    `    en_gb:`,
    `      standard: ${gloss}   # ⚠ review wording; add alt: […] for extra meanings`,
    `    usage:                 # ✍ hand-author 1–2 NATURAL sentences — never generate;`,
    `      []                   #   robotic/formulaic examples are worse than none.`,
    `    # collections: [<topic>]  # optional grouping tags`,
  )

  return [...header, '', ...body, ''].join('\n')
}

/** True if the scaffold string still has unresolved authoring markers. */
export function hasUnresolvedMarkers(stub) {
  return /\bTODO\b|[✍⚠]/.test(String(stub ?? ''))
}
