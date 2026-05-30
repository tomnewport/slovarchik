// Practice-session composer (issue #12). Pure: given the history, vocab and
// skills it lays out the sections of a session — it decides *what* to drill, not
// how to run it. `rng` is injectable so tests are deterministic.
import { shuffle } from './quiz.js'
import { subjectId } from './progress.js'
import { collectionReadiness, weakestSkills } from './skills.js'

/** Questions per section for each session size. */
export const SESSION_SIZES = Object.freeze({ small: 3, medium: 10, large: 20 })

const ALL_LEVELS = ['easy', 'intermediate', 'advanced']
const NON_EASY = ['intermediate', 'advanced'] // recap & new learning forbid easy mode

const dueScore = (item, now) => now - (item.lastAt ?? 0) // never-tested → most due

/** Shuffle for variety, then bias towards the least-recently-tested; take `n`. */
function pickDue(items, n, now, rng) {
  return shuffle(items, rng)
    .sort((a, b) => dueScore(b, now) - dueScore(a, now))
    .slice(0, Math.max(0, n))
}

const membersOf = (words, collection) =>
  collection ? words.filter((w) => (w.collections ?? []).includes(collection)) : []

/** Turn a word record into a drillable session item, tagged with its last-seen time. */
function wordItem(w, lastAtById) {
  return {
    kind: 'word',
    key: w.key,
    label: w.headword || w.ru,
    lastAt: lastAtById.get(`word:${w.key}`) ?? 0,
  }
}

/** Expand a weak skill into the concrete word/form items it would drill. */
function expandSkill(skill, wordsByKey, lastAtById) {
  if (skill.kind === 'form') {
    const slot = skill.id.slice('form:'.length)
    return skill.wordKeys.map((key) => ({
      kind: 'form',
      key,
      slot,
      label: `${wordsByKey.get(key)?.headword ?? key} · ${slot.replace('.', ' ')}`,
      lastAt: lastAtById.get(`form:${key}#${slot}`) ?? 0,
    }))
  }
  if (skill.kind === 'number') {
    // Number topics have no vocab words; the topic itself is the drillable item.
    const topic = skill.id.slice('number:'.length)
    return [
      { kind: 'number', key: topic, label: skill.label, lastAt: lastAtById.get(`number:${topic}`) ?? 0 },
    ]
  }
  // word / type / collection skills all resolve to their member words.
  return skill.wordKeys.map((key) => wordItem(wordsByKey.get(key) ?? { key }, lastAtById))
}

/** Drop duplicate subjects (a word can be reached via several weak skills). */
function dedupe(items) {
  const seen = new Set()
  return items.filter((it) => {
    const id = subjectId(it)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/**
 * Compose a practice session.
 * @param {object} opts
 * @param {string|number} [opts.size]             'small'|'medium'|'large' or a count
 * @param {string|null} [opts.currentCollection]  the collection being learned
 * @param {string[]} [opts.completedCollections]  collections available for recap
 * @param {object[]} [opts.stats]                 described stats (for recency & readiness)
 * @param {object[]} [opts.words]                 normalised vocab records
 * @param {object[]} [opts.skills]                built skills (for the weak section)
 * @param {number} [opts.now]
 * @param {() => number} [opts.rng]
 * @returns {{size, sections: object[], exam: object}}
 */
export function composeSession({
  size = 'medium',
  currentCollection = null,
  completedCollections = [],
  stats = [],
  words = [],
  skills = [],
  now = Date.now(),
  rng = Math.random,
} = {}) {
  const n = typeof size === 'number' ? size : (SESSION_SIZES[size] ?? SESSION_SIZES.medium)
  const wordsByKey = new Map(words.map((w) => [w.key, w]))
  const lastAtById = new Map(stats.map((s) => [s.id, s.lastAt ?? 0]))
  const masteryByWord = new Map()
  for (const s of stats) if (s.kind === 'word') masteryByWord.set(s.key, s.mastery ?? 0)

  // Recap: words from completed collections, least-recently-tested first.
  const recapPool = completedCollections.flatMap((c) => membersOf(words, c))
  const recap = pickDue(dedupe(recapPool.map((w) => wordItem(w, lastAtById))), n, now, rng)

  // Current collection learning (any level).
  const current = pickDue(
    membersOf(words, currentCollection).map((w) => wordItem(w, lastAtById)),
    n,
    now,
    rng,
  )

  // Grammar: every declension form the vocab supports.
  const grammarPool = words.flatMap((w) =>
    Object.entries(w.forms ?? {}).flatMap(([num, cases]) =>
      Object.keys(cases).map((c) => ({
        kind: 'form',
        key: w.key,
        slot: `${num}.${c}`,
        label: `${w.headword || w.ru} · ${num} ${c}`,
        lastAt: lastAtById.get(`form:${w.key}#${num}.${c}`) ?? 0,
      })),
    ),
  )
  const grammar = pickDue(grammarPool, n, now, rng)

  // Weakest 25% of skills, expanded to concrete items.
  const weakPool = dedupe(
    weakestSkills(skills, { fraction: 0.25 }).flatMap((s) =>
      expandSkill(s, wordsByKey, lastAtById),
    ),
  )
  const weak = pickDue(weakPool, n, now, rng)

  // New learning: current-collection words not yet mastered, never-seen first.
  const newPool = membersOf(words, currentCollection)
    .filter((w) => (masteryByWord.get(w.key) ?? 0) < 1)
    .map((w) => wordItem(w, lastAtById))
  const fresh = pickDue(newPool, n, now, rng)

  const sections = [
    { id: 'recap', title: 'Recap', help: 'Completed collections', allowEasy: false, levels: NON_EASY, items: recap },
    { id: 'current', title: 'Current collection', help: 'Keep learning', allowEasy: true, levels: ALL_LEVELS, items: current },
    { id: 'grammar', title: 'Grammar', help: 'Declension practice', allowEasy: true, levels: ALL_LEVELS, items: grammar },
    { id: 'weak', title: 'Weak skills', help: 'Your weakest 25%', allowEasy: true, levels: ALL_LEVELS, items: weak },
    { id: 'new', title: 'New words', help: 'Stretch ahead', allowEasy: false, levels: NON_EASY, items: fresh },
  ].filter((s) => s.items.length > 0)

  return {
    size: n,
    sections,
    exam: collectionReadiness(stats, words, currentCollection),
  }
}
