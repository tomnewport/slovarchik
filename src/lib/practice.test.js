import { describe, it, expect } from 'vitest'

import { emptyStat, describeStat } from './progress.js'
import { buildSkills } from './skills.js'
import { composeSession, SESSION_SIZES } from './practice.js'

const WORDS = [
  { key: 'лебедь=swan', pos: 'noun', gender: 'm', animacy: 'a', collections: ['animals'], headword: 'ле́бедь', ru: 'лебедь', forms: { sg: { nom: 'ле́бедь', gen: 'ле́бедя' }, pl: { nom: 'ле́беди', gen: 'лебеде́й' } } },
  { key: 'море=sea', pos: 'noun', gender: 'n', animacy: 'i', collections: ['nature'], headword: 'мо́ре', ru: 'море', forms: { sg: { nom: 'мо́ре', gen: 'мо́ря' }, pl: { nom: 'моря́', gen: 'море́й' } } },
  { key: 'река=river', pos: 'noun', gender: 'f', animacy: 'i', collections: ['nature'], headword: 'река́', ru: 'река', forms: { sg: { nom: 'река́', gen: 'реки́' }, pl: { nom: 'ре́ки', gen: 'рек' } } },
  { key: 'деньги=money', pos: 'noun', gender: null, animacy: 'i', collections: ['shopping'], headword: 'де́ньги', ru: 'деньги', forms: { pl: { nom: 'де́ньги', gen: 'де́нег' } } },
]
const wordsByKey = new Map(WORDS.map((w) => [w.key, w]))

const ev = (grade, level, at) => ({ grade, level, at })
function described(subject, evs) {
  return describeStat({ ...emptyStat(subject), events: evs }, wordsByKey)
}

const STATS = [
  described({ kind: 'word', key: 'лебедь=swan' }, [ev(2, 'advanced', 1)]), // animals: mastered
  described({ kind: 'word', key: 'море=sea' }, [ev(0, 'easy', 2)]), //        nature: not mastered
  described({ kind: 'form', key: 'деньги=money', slot: 'pl.gen' }, [ev(0, 'easy', 3)]),
]
const skills = buildSkills(STATS, WORDS)

// A tiny deterministic RNG so section contents are stable across runs.
function seededRng(seed = 1) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

const base = {
  currentCollection: 'nature',
  completedCollections: ['animals'],
  stats: STATS,
  words: WORDS,
  skills,
  now: 1000,
}

describe('composeSession', () => {
  it('resolves the named sizes and caps every section to it', () => {
    const session = composeSession({ size: 'small', ...base, rng: seededRng() })
    expect(session.size).toBe(SESSION_SIZES.small)
    for (const section of session.sections) {
      expect(section.items.length).toBeLessThanOrEqual(SESSION_SIZES.small)
    }
  })

  it('builds the issue #12 sections with the right level rules', () => {
    const session = composeSession({ size: 'medium', ...base, rng: seededRng() })
    const byId = new Map(session.sections.map((s) => [s.id, s]))

    // Recap pulls from completed collections (animals → swan) and forbids easy mode.
    const recap = byId.get('recap')
    expect(recap.items.every((i) => i.kind === 'word' && i.key === 'лебедь=swan')).toBe(true)
    expect(recap.levels).not.toContain('easy')

    // Current collection (nature → sea, river) allows any level.
    expect(byId.get('current').items.map((i) => i.key).sort()).toEqual(['море=sea', 'река=river'])
    expect(byId.get('current').levels).toContain('easy')

    // Grammar drills declension forms.
    expect(byId.get('grammar').items.every((i) => i.kind === 'form')).toBe(true)

    // New learning only offers not-yet-mastered current-collection words, no easy.
    expect(byId.get('new').items.every((i) => i.key !== 'лебедь=swan')).toBe(true)
    expect(byId.get('new').levels).not.toContain('easy')
  })

  it('reports exam readiness for the current collection', () => {
    const session = composeSession({ size: 'medium', ...base, rng: seededRng() })
    expect(session.exam.collection).toBe('nature')
    expect(session.exam.eligible).toBe(false) // sea not yet mastered
  })

  it('drops empty sections (e.g. no current collection → no current/new)', () => {
    const session = composeSession({
      ...base,
      currentCollection: null,
      completedCollections: [],
      rng: seededRng(),
    })
    const ids = session.sections.map((s) => s.id)
    expect(ids).not.toContain('current')
    expect(ids).not.toContain('new')
    expect(ids).not.toContain('recap')
    expect(ids).toContain('grammar') // forms always available
  })

  it('is deterministic for a fixed RNG', () => {
    const a = composeSession({ size: 'large', ...base, rng: seededRng(7) })
    const b = composeSession({ size: 'large', ...base, rng: seededRng(7) })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('drills a weak number topic in the weak-skills section', () => {
    const numStat = described({ kind: 'number', key: 'caseForm' }, [
      ev(0, 'advanced', 4),
      ev(0, 'advanced', 5),
      ev(0, 'advanced', 6),
    ])
    const stats = [...STATS, numStat]
    const skills = buildSkills(stats, WORDS, { numberLabels: { caseForm: 'Number cases' } })
    const session = composeSession({ ...base, stats, skills, size: 'large', rng: seededRng() })
    const weak = session.sections.find((s) => s.id === 'weak')
    const num = weak?.items.find((i) => i.kind === 'number')
    expect(num).toBeTruthy()
    expect(num.key).toBe('caseForm')
    expect(num.label).toBe('Number cases')
  })
})
