// Bomb disposal minigame (#728).
//
// The learner hears an instruction in Russian and cuts wires in the order it
// demands. Everything that decides what a bomb *is*, what the instruction
// *says* and whether a cut was right lives here — pure, seedable, framework
// free. The view owns only the countdown and the animation.
//
// Three pieces:
//   - a WIRE is a base colour plus an optional accent pattern (stripes / dots)
//   - a RULE is either a PLAN (ordered stages of wires to cut) or a BRANCH
//     that picks one of two plans by looking at the board
//   - `describe` renders a rule as the Russian said aloud, plus an English
//     gloss for the written reveal
//
// The selector AST is deliberately small and closed. Seven kinds cover every
// instruction #728 lists, from "blue then red" up to "cut all the spotted
// wires unless they have green", and being closed is what lets `describe` be
// total: there is no board the generator can build whose instruction the
// renderer cannot say out loud.
//
// Why a rule grammar rather than a list of hand-written instructions: the
// escalation *is* the game. Seven hard-coded sentences are seven sentences a
// learner memorises; a grammar gives an endless supply at a chosen difficulty,
// and — because the same tree both renders the Russian and grades the cut —
// the sentence and the correct answer cannot drift apart.

import { sample, shuffle } from './quiz.js'

// ── Colours ──────────────────────────────────────────────────────────────
// Stress is stored, not derived, on a small closed table — the same bargain
// src/lib/numerals.js strikes. Three forms per colour are all the phrasings
// below need: masculine nominative ("си́ний про́вод"), masculine genitive
// (after «кро́ме» and «нет»), and instrumental plural ("с си́ними поло́сками").
//
// The corpus carries all twelve of these in adjectives.yml, but this table is
// deliberately standalone: a minigame must not wait on the IndexedDB vocab
// load to say its first sentence.
//
// синий / голубой are both "blue" in English and are glossed apart, because
// the distinction Russian insists on is exactly the kind of thing this game is
// for. Their hexes are far enough apart to be told at a glance.
/** @type {Record<string, {en: string, m: string, gen: string, ins: string, hex: string}>} */
export const COLORS = {
  red: { en: 'red', m: 'кра́сный', gen: 'кра́сного', ins: 'кра́сными', hex: '#d92b2b' },
  blue: { en: 'dark blue', m: 'си́ний', gen: 'си́него', ins: 'си́ними', hex: '#1f4fd8' },
  green: { en: 'green', m: 'зелёный', gen: 'зелёного', ins: 'зелёными', hex: '#2e9e4f' },
  yellow: { en: 'yellow', m: 'жёлтый', gen: 'жёлтого', ins: 'жёлтыми', hex: '#edc41f' },
  black: { en: 'black', m: 'чёрный', gen: 'чёрного', ins: 'чёрными', hex: '#2b2b2b' },
  white: { en: 'white', m: 'бе́лый', gen: 'бе́лого', ins: 'бе́лыми', hex: '#f2f2f2' },
  lightblue: { en: 'light blue', m: 'голубо́й', gen: 'голубо́го', ins: 'голубы́ми', hex: '#6ec6ff' },
  brown: { en: 'brown', m: 'кори́чневый', gen: 'кори́чневого', ins: 'кори́чневыми', hex: '#8a5a2b' },
  orange: { en: 'orange', m: 'ора́нжевый', gen: 'ора́нжевого', ins: 'ора́нжевыми', hex: '#ef8a1f' },
  purple: { en: 'purple', m: 'фиоле́товый', gen: 'фиоле́тового', ins: 'фиоле́товыми', hex: '#8b3fc0' },
  grey: { en: 'grey', m: 'се́рый', gen: 'се́рого', ins: 'се́рыми', hex: '#8d949c' },
  pink: { en: 'pink', m: 'ро́зовый', gen: 'ро́зового', ins: 'ро́зовыми', hex: '#ef8fc0' },
}

/** The six a beginner meets first — the palette the early levels draw from. */
export const COMMON_COLORS = ['red', 'blue', 'green', 'yellow', 'black', 'white']
/** The rest, which the later levels add once the plain six are automatic. */
export const WIDE_COLORS = [...COMMON_COLORS, 'lightblue', 'brown', 'orange', 'purple', 'grey', 'pink']

// Accent patterns. The Russian is an instrumental phrase — «с бе́лыми
// поло́сками» — so the pattern word needs no agreement of its own and one
// stored form per colour covers both patterns.
const PATTERN_RU = { striped: 'поло́сками', spotted: 'то́чками' }
const PATTERN_EN = { striped: 'stripes', spotted: 'dots' }
// The same pattern named without a colour: «все провода́ с то́чками».
const PATTERN_ONLY_RU = { striped: 'с поло́сками', spotted: 'с то́чками', plain: 'без узо́ра' }
const PATTERN_ONLY_EN = { striped: 'with stripes', spotted: 'with dots', plain: 'with no pattern' }

// ── Selectors ────────────────────────────────────────────────────────────
// A selector answers one question: does this wire match? Constructors rather
// than bare object literals so the shapes stay in one place and a typo in a
// `kind` is a missing import rather than a wire that silently never matches.

/** Every wire on the board. */
export const anyWire = () => ({ kind: 'any' })
/** The wire whose *base* colour is `color`. */
export const baseColor = (color) => ({ kind: 'color', color })
/** Any wire showing `color` at all — as its base or as its accent. */
export const hasColor = (color) => ({ kind: 'has', color })
/** A wire with `pattern` in `color`, e.g. stripes in white. */
export const withAccent = (pattern, color) => ({ kind: 'accent', pattern, color })
/** Any wire carrying `pattern`, whatever colour it is in. */
export const withPattern = (pattern) => ({ kind: 'pattern', pattern })
/** Every part must match. */
export const allOf = (...parts) => ({ kind: 'all', parts })
/** The part must not match. */
export const notMatching = (part) => ({ kind: 'not', part })

/** An ordered plan: every wire matching stage *i* is cut before stage *i+1*. */
export const plan = (stages) => ({ kind: 'plan', stages })

/**
 * Does `wire` match `selector`?
 * @param {PlainObject} selector
 * @param {PlainObject} wire
 * @returns {boolean}
 */
export function matches(selector, wire) {
  switch (selector?.kind) {
    case 'any':
      return true
    case 'color':
      return wire.color === selector.color
    case 'has':
      return wire.color === selector.color || wire.accent === selector.color
    case 'accent':
      return wire.pattern === selector.pattern && wire.accent === selector.color
    case 'pattern':
      return wire.pattern === selector.pattern
    case 'all':
      return (selector.parts ?? []).every((part) => matches(part, wire))
    case 'not':
      return !matches(selector.part, wire)
    default:
      return false
  }
}

// ── Reading a rule against a board ───────────────────────────────────────

/**
 * The plan a rule comes down to on this particular board. A branch is decided
 * by looking at the wires — which is the whole point of #728's "if there is no
 * amber wire…": the player must check the board before acting.
 * @param {PlainObject} rule
 * @param {PlainObject[]} wires
 * @returns {PlainObject} a plan
 */
export function resolvePlan(rule, wires) {
  if (rule?.kind !== 'branch') return rule
  const present = wires.some((w) => matches(rule.condition.selector, w))
  const holds = rule.condition.kind === 'absent' ? !present : present
  return holds ? rule.then : rule.otherwise
}

/**
 * The wire ids each stage claims. A wire belongs to the *first* stage it
 * matches, so the function is total even for an overlapping plan — and
 * {@link planIssues} is what refuses to ship one, rather than leaving the
 * order of an ambiguous cut up to chance.
 * @param {PlainObject} p a plan
 * @param {PlainObject[]} wires
 * @returns {string[][]}
 */
export function stageTargets(p, wires) {
  const stages = p?.stages ?? []
  return stages.map((_, i) =>
    wires.filter((w) => stages.findIndex((s) => matches(s, w)) === i).map((w) => w.id),
  )
}

/**
 * What is wrong with running `p` against this board: a stage naming a wire
 * that is not there, a wire two stages both claim, or nothing to cut at all.
 * The generator retries on a non-empty result, so an unsayable or unwinnable
 * bomb never reaches a player.
 * @returns {string[]} empty when the plan is sound
 */
export function planIssues(p, wires) {
  const stages = p?.stages ?? []
  const issues = []
  if (!stages.length) issues.push('no-stages')
  stages.forEach((selector, i) => {
    const hit = wires.filter((w) => matches(selector, w))
    if (!hit.length) issues.push(`empty-stage:${i}`)
    if (hit.some((w) => stages.findIndex((s) => matches(s, w)) !== i)) {
      issues.push(`ambiguous-stage:${i}`)
    }
  })
  if (!stageTargets(p, wires).flat().length) issues.push('nothing-to-cut')
  return issues
}

/**
 * The same check over a whole rule. Both arms of a branch are validated, not
 * just the one this board takes: a player who reasons the condition the wrong
 * way round must meet a real wrong answer, not a broken one. The arms must
 * also differ, or the condition is decoration.
 * @returns {string[]} empty when the rule is sound
 */
export function ruleIssues(rule, wires) {
  if (rule?.kind !== 'branch') return planIssues(rule, wires)
  const issues = [...planIssues(rule.then, wires), ...planIssues(rule.otherwise, wires)]
  const cutFor = (p) => stageTargets(p, wires).flat().join(',')
  if (cutFor(rule.then) === cutFor(rule.otherwise)) issues.push('branch-indistinct')
  return issues
}

/**
 * Grade a single cut against the plan, in the state the board is now in.
 * @param {PlainObject} p a plan
 * @param {PlainObject[]} wires
 * @param {string[]} cut  ids already cut, in the order they were cut
 * @param {string} wireId the wire being cut now
 * @returns {{ok: boolean, reason: string, stage?: number}}
 */
export function cutOutcome(p, wires, cut, wireId) {
  if (cut.includes(wireId)) return { ok: false, reason: 'already-cut' }
  const targets = stageTargets(p, wires)
  const stage = targets.findIndex((ids) => ids.includes(wireId))
  if (stage === -1) return { ok: false, reason: 'not-a-target' }
  const owed = targets
    .slice(0, stage)
    .flat()
    .filter((id) => !cut.includes(id))
  if (owed.length) return { ok: false, reason: 'out-of-order' }
  return { ok: true, reason: 'safe', stage }
}

/** Has every wire the plan asks for been cut? */
export function isDefused(p, wires, cut) {
  return stageTargets(p, wires)
    .flat()
    .every((id) => cut.includes(id))
}

// ── Saying it in Russian ─────────────────────────────────────────────────
// Rendering walks the selector down to a flat bag of features first, then
// builds the phrase from the bag. That keeps the renderer total — every
// selector kind contributes to the bag, and every bag has a phrase — instead
// of needing a template per shape the generator happens to produce.

function features(selector, bag = { color: null, accent: null, pattern: null, has: null, excludes: [] }) {
  switch (selector?.kind) {
    case 'color':
      bag.color = selector.color
      break
    case 'has':
      bag.has = selector.color
      break
    case 'accent':
      bag.pattern = selector.pattern
      bag.accent = selector.color
      break
    case 'pattern':
      bag.pattern = selector.pattern
      break
    case 'all':
      for (const part of selector.parts ?? []) features(part, bag)
      break
    case 'not':
      bag.excludes.push(selector.part)
      break
    default: // 'any' and anything unrecognised add no constraint
      break
  }
  return bag
}

function exceptRu(selector) {
  const f = features(selector)
  if (f.color) return COLORS[f.color].gen
  if (f.has) return `тех, где есть ${COLORS[f.has].m}`
  if (f.accent) return `тех, что с ${COLORS[f.accent].ins} ${PATTERN_RU[f.pattern]}`
  if (f.pattern) return `тех, что ${PATTERN_ONLY_RU[f.pattern]}`
  return 'остальны́х'
}

function exceptEn(selector) {
  const f = features(selector)
  if (f.color) return `the ${COLORS[f.color].en} one`
  if (f.has) return `the ones with ${COLORS[f.has].en} on them`
  if (f.accent) return `the ones with ${COLORS[f.accent].en} ${PATTERN_EN[f.pattern]}`
  if (f.pattern) return `the ones ${PATTERN_ONLY_EN[f.pattern]}`
  return 'the rest'
}

/** A selector as a Russian noun phrase — «кра́сный про́вод с си́ними поло́сками». */
export function phraseRu(selector) {
  const f = features(selector)
  let phrase
  if (f.color) {
    phrase = `${COLORS[f.color].m} про́вод`
    if (f.accent) phrase += ` с ${COLORS[f.accent].ins} ${PATTERN_RU[f.pattern]}`
  } else if (f.accent) {
    phrase = `все провода́ с ${COLORS[f.accent].ins} ${PATTERN_RU[f.pattern]}`
  } else if (f.pattern) {
    phrase = `все провода́ ${PATTERN_ONLY_RU[f.pattern]}`
  } else if (f.has) {
    phrase = `все провода́, где есть ${COLORS[f.has].m}`
  } else {
    phrase = 'все провода́'
  }
  for (const part of f.excludes) phrase += `, кро́ме ${exceptRu(part)}`
  return phrase
}

/** The same selector in English, for the written reveal. */
export function phraseEn(selector) {
  const f = features(selector)
  let phrase
  if (f.color) {
    phrase = `the ${COLORS[f.color].en} wire`
    if (f.accent) phrase += ` with ${COLORS[f.accent].en} ${PATTERN_EN[f.pattern]}`
  } else if (f.accent) {
    phrase = `all the wires with ${COLORS[f.accent].en} ${PATTERN_EN[f.pattern]}`
  } else if (f.pattern) {
    phrase = `all the wires ${PATTERN_ONLY_EN[f.pattern]}`
  } else if (f.has) {
    phrase = `all the wires with ${COLORS[f.has].en} on them`
  } else {
    phrase = 'all the wires'
  }
  for (const part of f.excludes) phrase += `, except ${exceptEn(part)}`
  return phrase
}

const planRu = (p) => `перере́жь ${(p?.stages ?? []).map(phraseRu).join(', пото́м ')}`
const planEn = (p) => `cut ${(p?.stages ?? []).map(phraseEn).join(', then ')}`
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * A rule as the sentence the player hears, plus its English gloss.
 *
 * Russian uses the familiar singular imperative «перере́жь» throughout: the
 * game addresses one learner, and the form is the one they will meet in
 * spoken instructions.
 * @param {PlainObject} rule
 * @returns {{ru: string, en: string}}
 */
export function describe(rule) {
  if (rule?.kind === 'branch') {
    const { condition } = rule
    const f = features(condition.selector)
    const ruCond =
      condition.kind === 'absent'
        ? `Е́сли нет ${f.color ? `${COLORS[f.color].gen} про́вода` : phraseRu(condition.selector)}`
        : `Е́сли есть ${phraseRu(condition.selector)}`
    const enCond =
      condition.kind === 'absent'
        ? `If there is no ${f.color ? `${COLORS[f.color].en} wire` : phraseEn(condition.selector)}`
        : `If there is ${phraseEn(condition.selector)}`
    return {
      ru: `${ruCond}, ${planRu(rule.then)}. Ина́че ${planRu(rule.otherwise)}.`,
      en: `${enCond}, ${planEn(rule.then)}. Otherwise ${planEn(rule.otherwise)}.`,
    }
  }
  return { ru: `${capitalise(planRu(rule))}.`, en: `${capitalise(planEn(rule))}.` }
}

/** A wire in English, for the screen-reader label. */
export function wireLabelEn(wire) {
  const base = `${COLORS[wire.color].en} wire`
  if (!wire.accent) return base
  return `${base} with ${COLORS[wire.accent].en} ${PATTERN_EN[wire.pattern]}`
}

// ── Difficulty ───────────────────────────────────────────────────────────
// #728: "It starts with simple instructions … but then ramps up. The colours
// get more obscure, the instructions get more complex and patterns get
// introduced." Each level turns exactly one of those knobs, so a player can
// feel what changed; the clock tightens across all of them.

/** @type {Array<PlainObject>} */
export const LEVELS = [
  { wires: [2, 3], palette: COMMON_COLORS, patterns: false, shapes: ['sequence2'], seconds: 30 },
  { wires: [3, 4], palette: COMMON_COLORS, patterns: false, shapes: ['sequence2', 'sequence3'], seconds: 28 },
  { wires: [4, 5], palette: COMMON_COLORS, patterns: false, shapes: ['sequence3', 'except'], seconds: 26 },
  { wires: [4, 6], palette: WIDE_COLORS, patterns: true, shapes: ['sequence2', 'except', 'accentPair'], seconds: 24 },
  { wires: [5, 7], palette: WIDE_COLORS, patterns: true, shapes: ['accentPair', 'afterThen', 'patternSet'], seconds: 22 },
  { wires: [6, 8], palette: WIDE_COLORS, patterns: true, shapes: ['branch', 'afterThen'], seconds: 20 },
  { wires: [6, 8], palette: WIDE_COLORS, patterns: true, shapes: ['branch', 'patternSet', 'afterThen'], seconds: 18 },
]

/** Index into {@link LEVELS} for a 1-based round; later rounds hold at the top. */
export function levelFor(round) {
  return Math.min(Math.max(1, round) - 1, LEVELS.length - 1)
}

// ── Generation ───────────────────────────────────────────────────────────
// Board first, rule second. Building the rule *from* the wires that exist is
// what makes "the instruction names a wire that isn't there" impossible by
// construction rather than by retry, and it leaves `planIssues` to catch the
// subtler failure — two stages claiming the same wire.

const pick = (items, rng) => items[Math.floor(rng() * items.length)]
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))

/**
 * Lay out a board. Base colours are distinct across the board, so "the blue
 * wire" always names exactly one — patterns add difficulty without making the
 * instruction ambiguous.
 */
function makeWires(spec, rng) {
  const n = Math.min(randInt(rng, spec.wires[0], spec.wires[1]), spec.palette.length)
  return sample(spec.palette, n, rng).map((color, i) => {
    const accent = spec.patterns && rng() < 0.5 ? pick(spec.palette.filter((c) => c !== color), rng) : null
    return {
      id: `w${i}`,
      color,
      pattern: accent ? (rng() < 0.5 ? 'striped' : 'spotted') : 'plain',
      accent,
    }
  })
}

/** The wire named by both its colour and its pattern — «кра́сный … с си́ними поло́сками». */
const accentSelector = (w) => allOf(baseColor(w.color), withAccent(w.pattern, w.accent))

/** "Blue then red" — k wires, named plainly, in order. */
function shapeSequence(wires, k, rng) {
  if (wires.length < k) return null
  return plan(sample(wires, k, rng).map((w) => baseColor(w.color)))
}

/** "All except black." */
function shapeExcept(wires, rng) {
  if (wires.length < 3) return null
  const spared = pick(wires, rng)
  return plan([allOf(anyWire(), notMatching(baseColor(spared.color)))])
}

/** "Red and blue stripes, then black and brown stripes." */
function shapeAccentPair(wires, rng) {
  const patterned = wires.filter((w) => w.accent)
  if (patterned.length < 2) return null
  return plan(sample(patterned, 2, rng).map(accentSelector))
}

/** "Purple with green dots, but only after the red and then the green wire." */
function shapeAfterThen(wires, rng) {
  const patterned = wires.filter((w) => w.accent)
  if (!patterned.length || wires.length < 3) return null
  const last = pick(patterned, rng)
  const rest = wires.filter((w) => w.id !== last.id)
  if (rest.length < 2) return null
  const [a, b] = sample(rest, 2, rng)
  return plan([baseColor(a.color), baseColor(b.color), accentSelector(last)])
}

/**
 * "Cut all the spotted wires unless they have green." Needs a pattern group
 * that the excluded colour splits — sparing none makes the exception
 * decoration, sparing all leaves nothing to cut.
 */
function shapePatternSet(wires, rng) {
  for (const pattern of shuffle(['spotted', 'striped'], rng)) {
    const group = wires.filter((w) => w.pattern === pattern)
    if (group.length < 2) continue
    const colors = shuffle([...new Set(group.flatMap((w) => [w.color, w.accent]))], rng)
    for (const color of colors) {
      const spared = group.filter((w) => w.color === color || w.accent === color)
      if (spared.length && spared.length < group.length) {
        return plan([allOf(withPattern(pattern), notMatching(hasColor(color)))])
      }
    }
  }
  return null
}

/**
 * What one arm of a conditional may ask for: a single named wire, or — when
 * the board carries a pattern to name — every wire showing it. The second kind
 * is what #728's own example asks for ("cut anything with a white stripe"), so
 * without it the conditional levels would only ever say "cut the green wire".
 */
function branchArms(wires) {
  const arms = wires.map((w) => plan([baseColor(w.color)]))
  for (const w of wires) {
    if (w.accent) arms.push(plan([withAccent(w.pattern, w.accent)]))
  }
  return arms
}

/**
 * "If there is no amber wire, cut … Otherwise cut …" The probe colour is
 * absent from the board half the time, so neither branch becomes the habit,
 * and the two arms are chosen to cut different wires — otherwise the condition
 * is decoration and `ruleIssues` would refuse the rule anyway.
 */
function shapeBranch(wires, spec, rng) {
  if (wires.length < 3) return null
  const onBoard = wires.map((w) => w.color)
  const missing = spec.palette.filter((c) => !onBoard.includes(c))
  const wantAbsent = rng() < 0.5
  const probe = wantAbsent ? pick(missing, rng) : pick(onBoard, rng)
  if (!probe) return null

  const arms = shuffle(branchArms(wires), rng)
  const cuts = (p) => stageTargets(p, wires).flat().join(',')
  const then = arms[0]
  const otherwise = arms.find((p) => cuts(p) !== cuts(then))
  if (!otherwise) return null
  return {
    kind: 'branch',
    condition: { kind: 'absent', selector: baseColor(probe) },
    then,
    otherwise,
  }
}

function buildShape(name, wires, spec, rng) {
  switch (name) {
    case 'sequence2':
      return shapeSequence(wires, 2, rng)
    case 'sequence3':
      return shapeSequence(wires, 3, rng)
    case 'except':
      return shapeExcept(wires, rng)
    case 'accentPair':
      return shapeAccentPair(wires, rng)
    case 'afterThen':
      return shapeAfterThen(wires, rng)
    case 'patternSet':
      return shapePatternSet(wires, rng)
    case 'branch':
      return shapeBranch(wires, spec, rng)
    default:
      return null
  }
}

/** How many boards to try before falling back to a shape that always works. */
const MAX_ATTEMPTS = 24

/**
 * A bomb for the given 1-based round: the wires, the rule, what to say, and
 * how long the player has.
 *
 * Total by construction. A shape can decline a board it cannot fit (no two
 * patterned wires for "red stripes then black stripes"), and a plan can turn
 * out ambiguous, so generation retries; after {@link MAX_ATTEMPTS} it falls
 * back to a plain two-wire sequence, which any board of three distinct
 * colours supports.
 *
 * @param {number} [round] 1-based
 * @param {() => number} [rng]
 * @returns {PlainObject} `{ round, level, seconds, wires, rule, ru, en }`
 */
export function generateBomb(round = 1, rng = Math.random) {
  const level = levelFor(round)
  const spec = LEVELS[level]
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const wires = makeWires(spec, rng)
    const rule = buildShape(pick(spec.shapes, rng), wires, spec, rng)
    if (rule && !ruleIssues(rule, wires).length) {
      return { round, level: level + 1, seconds: spec.seconds, wires: shuffle(wires, rng), rule, ...describe(rule) }
    }
  }
  const wires = makeWires({ ...spec, wires: [3, 3], patterns: false }, rng)
  const rule = shapeSequence(wires, 2, rng)
  return { round, level: level + 1, seconds: spec.seconds, wires, rule, ...describe(rule) }
}
