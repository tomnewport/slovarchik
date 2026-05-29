// Pure, framework-free progression model: a standard way to record and query how
// well the learner uses each word, word-form and phrase. No I/O here (no fetch,
// no IndexedDB) so it stays trivially testable; the store layer persists it and
// joins it to the live vocab.
//
// Every attempt at a *subject* (a word, a single declension form, or a phrase)
// produces an *event* graded on issue #12's 0/1/2 scale. We keep only the last
// ten events per subject. Facets (gender, case, collection, …) are derived at
// query time from the current vocab — the single source of truth — so the stored
// data stays small and we can aggregate by any word attribute, even new ones.

/**
 * Grade an attempt earns. Matches issue #12: incorrect (0), correct but in an
 * assisted "easy" mode (1), or correct unaided — intermediate/advanced/hard (2).
 */
export const GRADES = Object.freeze({
  INCORRECT: 0,
  EASY: 1,
  CORRECT: 2,
})

/** Most recent attempts retained per tracked subject. */
export const MAX_EVENTS = 10

/**
 * Map a drill level and whether the answer was right to a {@link GRADES} value.
 * Every drill calls the same helper so grading is uniform across the app.
 * @param {string} level    the drill difficulty ('easy' | 'intermediate' | …)
 * @param {boolean} correct
 * @returns {number}
 */
export function gradeFor(level, correct) {
  if (!correct) return GRADES.INCORRECT
  return level === 'easy' ? GRADES.EASY : GRADES.CORRECT
}

// --- Subjects -----------------------------------------------------------------
// A subject is { kind, key, slot? }:
//   word   → the whole word, keyed by its "<ru>=<en>" natural key
//   form   → one declension slot of a noun, e.g. slot 'pl.gen'
//   phrase → a usage example, keyed by its "<ru>=<en>" phrase id

/** Stable string id for a subject, used as the storage key. */
export function subjectId(subject) {
  const { kind, key, slot } = subject
  if (kind === 'form') return `form:${key}#${slot}`
  return `${kind}:${key}`
}

/** Inverse of {@link subjectId}. */
export function parseSubjectId(id) {
  const sep = id.indexOf(':')
  const kind = id.slice(0, sep)
  const rest = id.slice(sep + 1)
  if (kind === 'form') {
    const h = rest.lastIndexOf('#')
    return { kind, key: rest.slice(0, h), slot: rest.slice(h + 1) }
  }
  return { kind, key: rest }
}

// --- Events -------------------------------------------------------------------

/** A fresh, empty stat record for a subject. */
export function emptyStat(subject) {
  const { kind, key, slot } = subject
  const stat = { id: subjectId(subject), kind, key, events: [] }
  if (slot != null) stat.slot = slot
  return stat
}

/** Append an event and keep only the most recent {@link MAX_EVENTS}. Pure. */
export function recordEvent(events, grade, at = Date.now()) {
  return [...(events ?? []), { at, grade }].slice(-MAX_EVENTS)
}

/** Return a new stat record with `grade` appended to its event history. Pure. */
export function applyEvent(stat, grade, at = Date.now()) {
  return { ...stat, events: recordEvent(stat.events, grade, at) }
}

/**
 * Roll up an event list into countable metrics. `errorRate` — the fraction of
 * attempts that were wrong — is the headline "gets it wrong X% of the time"
 * number; the per-grade counts are kept for future skill/mastery logic.
 * @param {Array<{at: number, grade: number}>} events
 */
export function summarize(events = []) {
  let incorrect = 0
  let easy = 0
  let correct = 0
  let lastAt = 0
  for (const e of events) {
    if (e.grade === GRADES.INCORRECT) incorrect += 1
    else if (e.grade === GRADES.EASY) easy += 1
    else if (e.grade === GRADES.CORRECT) correct += 1
    if (e.at > lastAt) lastAt = e.at
  }
  const attempts = events.length
  return {
    attempts,
    incorrect,
    easy,
    correct,
    errorRate: attempts ? incorrect / attempts : 0,
    lastAt: lastAt || null,
  }
}

// --- Describing subjects (join to vocab) --------------------------------------

/** Parse a 'pl.gen'-style slot into its number and case. */
function parseSlot(slot) {
  const [number, kase] = String(slot ?? '').split('.')
  return { number: number || null, case: kase || null }
}

/**
 * Resolve a stored stat against the current vocab, producing the human label and
 * the flat `facets` map that aggregation groups and filters on. Words that are
 * no longer in the vocab still get a usable label and `kind` so nothing is lost.
 * @param {object} record           stored stat ({ kind, key, slot, events })
 * @param {Map<string, object>} wordsByKey  normalised words keyed by natural key
 * @returns {{label: string, facets: object}}
 */
export function describeSubject(record, wordsByKey = new Map()) {
  const { kind, key, slot } = record
  const word = wordsByKey.get(key)
  const wordFacets = word
    ? {
        pos: word.pos ?? null,
        gender: word.gender ?? null,
        animacy: word.animacy ?? null,
        cefr: word.cefr ?? null,
        collections: word.collections ?? [],
      }
    : { pos: null, gender: null, animacy: null, cefr: null, collections: [] }
  const lemma = word ? word.headword || word.ru : null

  if (kind === 'form') {
    const { number, case: kase } = parseSlot(slot)
    return {
      label: `${lemma ?? key} · ${number ?? '?'} ${kase ?? '?'}`,
      facets: { kind, ...wordFacets, number, case: kase, slot },
    }
  }
  if (kind === 'word') {
    return { label: lemma ?? key, facets: { kind, ...wordFacets } }
  }
  // phrase (and any future kinds): minimal facets, label from the Russian side.
  return { label: String(key).split('=')[0] || key, facets: { kind } }
}

/**
 * Full "described" stat: the stored record plus its derived label, facets and
 * summary metrics. This is the unit that {@link aggregate} and the ranking
 * helpers operate on.
 */
export function describeStat(record, wordsByKey = new Map()) {
  return { ...record, ...describeSubject(record, wordsByKey), ...summarize(record.events) }
}

// --- Aggregation & ranking ----------------------------------------------------

/** The group key(s) a described stat falls under for a given `groupBy`. */
function keysFor(groupBy, stat) {
  if (!groupBy) return ['all']
  const value = typeof groupBy === 'function' ? groupBy(stat) : stat.facets?.[groupBy]
  if (value == null) return [] // not applicable — leave this stat out of the grouping
  return Array.isArray(value) ? value : [value]
}

function blankBucket(key) {
  return { key, attempts: 0, incorrect: 0, easy: 0, correct: 0, stats: [] }
}

/**
 * Group described stats into buckets and total their attempts/grades. A stat can
 * land in several buckets when its group key is multi-valued (e.g. a word that
 * belongs to more than one collection counts towards each).
 *
 * @param {object[]} stats described stats (see {@link describeStat})
 * @param {object} [opts]
 * @param {(stat: object) => boolean} [opts.filter]  keep only stats that pass
 * @param {string | ((stat: object) => any)} [opts.groupBy]  facet name or fn;
 *        omit to roll everything into a single 'all' bucket
 * @returns {Array<{key: any, attempts: number, incorrect: number, easy: number,
 *        correct: number, errorRate: number, stats: object[]}>}
 */
export function aggregate(stats, { filter, groupBy } = {}) {
  const buckets = new Map()
  for (const stat of stats) {
    if (filter && !filter(stat)) continue
    for (const key of keysFor(groupBy, stat)) {
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = blankBucket(key)
        buckets.set(key, bucket)
      }
      bucket.attempts += stat.attempts
      bucket.incorrect += stat.incorrect
      bucket.easy += stat.easy
      bucket.correct += stat.correct
      bucket.stats.push(stat)
    }
  }
  for (const bucket of buckets.values()) {
    bucket.errorRate = bucket.attempts ? bucket.incorrect / bucket.attempts : 0
  }
  return [...buckets.values()]
}

/**
 * Sort buckets (or described stats — they share the same metric fields) and trim
 * out anything below `minAttempts` so a single unlucky attempt doesn't top the
 * chart. Most-mistaken-first by default.
 * @param {object[]} buckets
 * @param {object} [opts]
 * @param {string} [opts.by]          metric to sort on (default 'errorRate')
 * @param {number} [opts.minAttempts] ignore buckets with fewer attempts (default 1)
 * @param {boolean} [opts.desc]       highest first (default true)
 * @param {number} [opts.limit]       keep only the top N
 */
export function rankBuckets(buckets, { by = 'errorRate', minAttempts = 1, desc = true, limit } = {}) {
  const out = buckets
    .filter((b) => b.attempts >= minAttempts)
    .sort(
      (a, b) =>
        (desc ? b[by] - a[by] : a[by] - b[by]) ||
        b.attempts - a.attempts || // more attempts ranks higher on a tie
        String(a.key ?? a.label).localeCompare(String(b.key ?? b.label)),
    )
  return limit != null ? out.slice(0, limit) : out
}

/**
 * A single combined summary over the stats matching `filter` — answers questions
 * like "how often do I get the nominative of neuter nouns wrong?" in one call.
 * @param {object[]} stats
 * @param {(stat: object) => boolean} [filter]
 */
export function combined(stats, filter) {
  const [bucket] = aggregate(stats, { filter })
  return bucket ?? { ...blankBucket('all'), errorRate: 0 }
}

/** Stats of one kind, ranked most-mistaken-first. Each stat is its own row. */
function rankSubjects(stats, { kind, ...opts } = {}) {
  return rankBuckets(
    kind ? stats.filter((s) => s.kind === kind) : stats,
    opts,
  )
}

/** Query 1: the words the learner gets wrong most often. */
export function mostMistakenWords(stats, opts) {
  return rankSubjects(stats, { kind: 'word', ...opts })
}

/** Query 2: the individual word-forms the learner gets wrong most often. */
export function mostMistakenForms(stats, opts) {
  return rankSubjects(stats, { kind: 'form', ...opts })
}

/**
 * Query 3 (generalised): roll attempts up by any facet and rank the groups —
 * e.g. `mistakenByFacet(stats, 'gender')` for "which noun gender trips me up
 * most?", or `mistakenByFacet(stats, 'case', { kind: 'form' })`.
 * @param {object[]} stats
 * @param {string | ((stat: object) => any)} facet
 * @param {object} [opts] `kind` to restrict the subjects; rest passed to ranking
 */
export function mistakenByFacet(stats, facet, { kind, ...opts } = {}) {
  const filter = kind ? (s) => s.kind === kind : undefined
  return rankBuckets(aggregate(stats, { filter, groupBy: facet }), opts)
}

/** Query 4: the collections the learner gets wrong most often. */
export function mostMistakenCollections(stats, opts) {
  return mistakenByFacet(stats, 'collections', { kind: 'word', ...opts })
}
