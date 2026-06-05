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

/** Look up an achievement by id. Returns undefined if not found. */
export function achievementById(id) {
  return ACHIEVEMENTS.find((a) => a.id === id)
}

/**
 * Build cefrStats from a list of word objects and a stateOf function.
 * Words must have a `.cefr` property. Words without a cefr value are ignored.
 * @param {Array<{key: string, cefr: string|null}>} words
 * @param {(key: string) => string} stateOf  - returns word state ('unknown'|'learning'|'learned'|'mastered')
 * @returns {Object} { A1: { total, learned }, ... }
 */
export function buildCefrStats(words, stateOf) {
  const stats = {}
  for (const level of CEFR_ORDER) stats[level] = { total: 0, learned: 0 }
  for (const w of words) {
    if (!w.cefr || !stats[w.cefr]) continue
    stats[w.cefr].total++
    const s = stateOf(w.key)
    if (s === 'learned' || s === 'mastered') stats[w.cefr].learned++
  }
  return stats
}
