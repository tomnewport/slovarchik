// Pure achievement definitions and earned-set computation.
// No Vue, no I/O — framework-free so it stays trivially unit-testable.

import { CEFR_ORDER } from './batches.js'

/**
 * Every achievement the app can grant.
 * type 'learned'  — triggered when learnedCount  >= threshold
 * type 'mastered' — triggered when masteredCount >= threshold
 * type 'cefr'     — triggered when every word at `level` has been learned
 */
export const ACHIEVEMENTS = [
  // First steps
  { id: 'learn-1',    type: 'learned',  threshold: 1,   icon: '🌱', label: 'First word',       desc: 'Learned your first Russian word' },
  { id: 'master-1',   type: 'mastered', threshold: 1,   icon: '⭐', label: 'First star',        desc: 'Mastered your first Russian word' },
  // Learned milestones
  { id: 'learn-5',    type: 'learned',  threshold: 5,   icon: '🌿', label: 'Sprout',            desc: 'Learned 5 words' },
  { id: 'learn-10',   type: 'learned',  threshold: 10,  icon: '📚', label: 'Bookshelf',         desc: 'Learned 10 words' },
  { id: 'learn-20',   type: 'learned',  threshold: 20,  icon: '💪', label: 'First batch',       desc: 'Learned 20 words' },
  { id: 'learn-50',   type: 'learned',  threshold: 50,  icon: '🎯', label: 'Fifty words',       desc: 'Learned 50 words' },
  { id: 'learn-100',  type: 'learned',  threshold: 100, icon: '💯', label: 'Century',           desc: 'Learned 100 words' },
  { id: 'learn-150',  type: 'learned',  threshold: 150, icon: '🏃', label: 'Hitting stride',    desc: 'Learned 150 words' },
  { id: 'learn-200',  type: 'learned',  threshold: 200, icon: '🚀', label: 'Two hundred',       desc: 'Learned 200 words' },
  { id: 'learn-300',  type: 'learned',  threshold: 300, icon: '🌟', label: 'Three hundred',     desc: 'Learned 300 words' },
  { id: 'learn-400',  type: 'learned',  threshold: 400, icon: '🎖️', label: 'Four hundred',      desc: 'Learned 400 words' },
  { id: 'learn-500',  type: 'learned',  threshold: 500, icon: '🏅', label: 'Five hundred',      desc: 'Learned 500 words' },
  { id: 'learn-600',  type: 'learned',  threshold: 600, icon: '🏆', label: 'Six hundred',       desc: 'Learned 600 words' },
  // Mastered milestones
  { id: 'master-5',   type: 'mastered', threshold: 5,   icon: '✨', label: 'Mastery begins',    desc: 'Mastered 5 words' },
  { id: 'master-10',  type: 'mastered', threshold: 10,  icon: '🔥', label: 'On fire',           desc: 'Mastered 10 words' },
  { id: 'master-20',  type: 'mastered', threshold: 20,  icon: '💎', label: 'Diamond mind',      desc: 'Mastered 20 words' },
  { id: 'master-50',  type: 'mastered', threshold: 50,  icon: '🎓', label: 'Scholar',           desc: 'Mastered 50 words' },
  { id: 'master-100', type: 'mastered', threshold: 100, icon: '👑', label: 'Crown',             desc: 'Mastered 100 words' },
  { id: 'master-150', type: 'mastered', threshold: 150, icon: '🌙', label: 'Night owl',         desc: 'Mastered 150 words' },
  { id: 'master-200', type: 'mastered', threshold: 200, icon: '☀️', label: 'Sunrise',           desc: 'Mastered 200 words' },
  { id: 'master-300', type: 'mastered', threshold: 300, icon: '🌊', label: 'Deep water',        desc: 'Mastered 300 words' },
  { id: 'master-400', type: 'mastered', threshold: 400, icon: '⚡', label: 'Lightning',         desc: 'Mastered 400 words' },
  { id: 'master-500', type: 'mastered', threshold: 500, icon: '🌈', label: 'Rainbow',           desc: 'Mastered 500 words' },
  { id: 'master-600', type: 'mastered', threshold: 600, icon: '🦅', label: 'Eagle',             desc: 'Mastered 600 words' },
  // CEFR level completion (all words in that level learned)
  { id: 'cefr-A1',    type: 'cefr',     level: 'A1',    icon: '🇷🇺', label: 'A1 complete',       desc: 'Learned every A1 word' },
  { id: 'cefr-A2',    type: 'cefr',     level: 'A2',    icon: '📖', label: 'A2 complete',       desc: 'Learned every A2 word' },
  { id: 'cefr-B1',    type: 'cefr',     level: 'B1',    icon: '🎓', label: 'B1 complete',       desc: 'Learned every B1 word' },
  { id: 'cefr-B2',    type: 'cefr',     level: 'B2',    icon: '🔬', label: 'B2 complete',       desc: 'Learned every B2 word' },
  { id: 'cefr-C1',    type: 'cefr',     level: 'C1',    icon: '🏆', label: 'C1 complete',       desc: 'Learned every C1 word' },
]

/**
 * Build a set of earned achievement IDs from snapshot counts.
 *
 * @param {number} learnedCount  - total words at learned-or-above state
 * @param {number} masteredCount - total words at mastered state
 * @param {Object} cefrStats     - map of CEFR level → { total, learned }
 *                                 e.g. { A1: { total: 120, learned: 80 }, ... }
 * @returns {Set<string>}
 */
export function earnedSet(learnedCount, masteredCount, cefrStats) {
  const earned = new Set()
  for (const a of ACHIEVEMENTS) {
    if (a.type === 'learned' && learnedCount >= a.threshold) {
      earned.add(a.id)
    } else if (a.type === 'mastered' && masteredCount >= a.threshold) {
      earned.add(a.id)
    } else if (a.type === 'cefr') {
      const s = cefrStats[a.level]
      if (s && s.total > 0 && s.learned >= s.total) earned.add(a.id)
    }
  }
  return earned
}

/**
 * Return the IDs present in `next` but not in `prev`.
 * Both arguments should be Sets of achievement IDs.
 * @param {Set<string>} prev
 * @param {Set<string>} next
 * @returns {string[]}
 */
export function newlyUnlocked(prev, next) {
  return [...next].filter((id) => !prev.has(id))
}

/**
 * The milestones for one curriculum part (#674): half way, and complete.
 *
 * These are generated rather than listed with the fixed achievements above
 * because the parts themselves are data — the corpus decides how many there
 * are. Their ids are built from the part id, which `check:parts` holds stable,
 * because `seenAchievements` persists them: an id that changed meaning would
 * silently re-fire, or never fire again.
 *
 * @param {Array<{id: string, name: string}>} parts
 * @returns {Array<{id: string, type: string, part: string, at: number,
 *   icon: string, label: string, desc: string}>}
 */
export function partAchievements(parts) {
  return (parts ?? []).flatMap((p) => [
    {
      id: `part-${p.id}-half`,
      type: 'part',
      part: p.id,
      at: 0.5,
      icon: '🌗',
      label: `${p.name} half way`,
      desc: `Learned half of ${p.name}`,
    },
    {
      id: `part-${p.id}-done`,
      type: 'part',
      part: p.id,
      at: 1,
      icon: '🌕',
      label: `${p.name} complete`,
      desc: `Learned every word in ${p.name}`,
    },
  ])
}

/**
 * Which part milestones the learner currently meets.
 *
 * "Currently" is the operative word, and the reason `stampEarned` exists: a part
 * gains words as the corpus grows, so a completion met today can be unmet
 * tomorrow. The stamp is what makes it permanent; this only reports the live
 * comparison.
 *
 * @param {Array<{id: string, name: string}>} parts
 * @param {Record<string, {total: number, learned: number}>} partStats
 * @returns {Set<string>}
 */
export function earnedPartSet(parts, partStats) {
  const earned = new Set()
  for (const a of partAchievements(parts)) {
    const s = partStats?.[a.part]
    if (!s || s.total <= 0) continue
    if (s.learned >= Math.ceil(s.total * a.at)) earned.add(a.id)
  }
  return earned
}

/**
 * Fold the currently-earned set into the stamped record, which only ever grows.
 *
 * {@link earnedSet} answers "does the learner meet this threshold *right now*",
 * and that is not the same question as "have they earned this". A `cefr`
 * achievement compares learned against the level's total, so adding words to
 * the corpus drops it back below the bar and silently un-earns something the
 * learner was already shown — and `seenAchievements` means it never fires
 * again. Slipping words do the same to a `learned`/`mastered` threshold.
 *
 * So the stamp is the record of truth: an id that enters keeps its original
 * timestamp and is never removed. Curriculum parts (#674) make this sharper,
 * with nine smaller denominators for corpus growth to move underneath.
 *
 * @param {Record<string, number>} stamped id → epoch ms first earned
 * @param {Set<string>|string[]} earned ids meeting their threshold right now
 * @param {number} now timestamp to stamp newly-earned ids with
 * @returns {{next: Record<string, number>, added: string[]}} `next` is the
 *   original object when nothing was added, so callers can skip a write
 */
export function stampEarned(stamped, earned, now) {
  const added = [...earned].filter((id) => !(id in (stamped ?? {})))
  if (!added.length) return { next: stamped ?? {}, added }
  const next = { ...(stamped ?? {}) }
  for (const id of added) next[id] = now
  return { next, added }
}

/** Look up an achievement by id. Returns undefined if not found. */
export function achievementById(id) {
  return ACHIEVEMENTS.find((a) => a.id === id)
}

/**
 * Build cefrStats from a list of word objects and a stateOf function.
 * Words must have a `.cefr` property. Words without a cefr value are ignored.
 * The three counts nest, so a bar can draw one inside the next: `met` counts
 * every word the learner has encountered at all — anything ever attempted, plus
 * anything `hasMet` reports from a phrase they got right (#675) — `learned`
 * counts mastered words too (mastery is above learned), and `mastered` is the
 * subset of those.
 * @param {Array<{key: string, cefr: string|null}>} words
 * @param {(key: string) => string} stateOf  - returns word state ('unknown'|'learning'|'learned'|'mastered')
 * @param {(key: string) => boolean} [hasMet] - met in a phrase, without being drilled
 * @returns {Object} { A1: { total, met, learned, mastered }, ... }
 */
export function buildCefrStats(words, stateOf, hasMet = () => false) {
  const stats = {}
  for (const level of CEFR_ORDER) stats[level] = { total: 0, met: 0, learned: 0, mastered: 0 }
  for (const w of words) {
    if (!w.cefr || !stats[w.cefr]) continue
    stats[w.cefr].total++
    const s = stateOf(w.key)
    // Derived rather than stored, so the nesting holds by construction: a word
    // being drilled has plainly been met, whether or not a phrase logged it.
    if (s !== 'unknown' || hasMet(w.key)) stats[w.cefr].met++
    if (s === 'learned' || s === 'mastered') stats[w.cefr].learned++
    if (s === 'mastered') stats[w.cefr].mastered++
  }
  return stats
}
