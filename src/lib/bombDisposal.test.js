import { describe as suite, it, expect } from 'vitest'

import {
  COLORS,
  LEVELS,
  allOf,
  anyWire,
  baseColor,
  cutOutcome,
  describe,
  generateBomb,
  hasColor,
  isDefused,
  levelFor,
  matches,
  notMatching,
  phraseEn,
  phraseRu,
  plan,
  planIssues,
  resolvePlan,
  ruleIssues,
  stageTargets,
  wireLabelEn,
  withAccent,
  withPattern,
} from './bombDisposal.js'

/** A seedable RNG, so a failing property test names a board we can rebuild. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const wire = (id, color, pattern = 'plain', accent = null) => ({ id, color, pattern, accent })

const red = wire('r', 'red')
const blue = wire('b', 'blue')
const blackGreenDots = wire('k', 'black', 'spotted', 'green')
const purpleWhiteStripes = wire('p', 'purple', 'striped', 'white')

suite('matches', () => {
  it('matches a base colour, and only that wire', () => {
    expect(matches(baseColor('red'), red)).toBe(true)
    expect(matches(baseColor('red'), blue)).toBe(false)
  })

  it('finds a colour whether it is the base or the accent', () => {
    expect(matches(hasColor('green'), blackGreenDots)).toBe(true)
    expect(matches(hasColor('black'), blackGreenDots)).toBe(true)
    expect(matches(hasColor('white'), blackGreenDots)).toBe(false)
  })

  it('takes an accent as a pattern and a colour together', () => {
    expect(matches(withAccent('spotted', 'green'), blackGreenDots)).toBe(true)
    // Right colour, wrong pattern.
    expect(matches(withAccent('striped', 'green'), blackGreenDots)).toBe(false)
  })

  it('matches a pattern whatever colour it is in', () => {
    expect(matches(withPattern('spotted'), blackGreenDots)).toBe(true)
    expect(matches(withPattern('plain'), red)).toBe(true)
  })

  it('takes every wire for `any`, and combines and negates', () => {
    expect(matches(anyWire(), red)).toBe(true)
    expect(matches(allOf(baseColor('black'), withPattern('spotted')), blackGreenDots)).toBe(true)
    expect(matches(allOf(baseColor('black'), withPattern('striped')), blackGreenDots)).toBe(false)
    expect(matches(notMatching(baseColor('red')), blue)).toBe(true)
    expect(matches(allOf(), red)).toBe(true)
  })

  it('refuses a selector it does not recognise rather than matching everything', () => {
    expect(matches({ kind: 'nonsense' }, red)).toBe(false)
    expect(matches(null, red)).toBe(false)
  })
})

suite('stageTargets', () => {
  const wires = [red, blue, blackGreenDots]

  it('gives each stage the wires it claims', () => {
    const p = plan([baseColor('blue'), baseColor('red')])
    expect(stageTargets(p, wires)).toEqual([['b'], ['r']])
  })

  it('gathers a whole set into one stage', () => {
    const p = plan([allOf(anyWire(), notMatching(baseColor('black')))])
    expect(stageTargets(p, wires)).toEqual([['r', 'b']])
  })

  it('awards a contested wire to the first stage that claims it', () => {
    const p = plan([anyWire(), baseColor('red')])
    expect(stageTargets(p, wires)).toEqual([['r', 'b', 'k'], []])
  })

  it('has no stages when there is no plan', () => {
    expect(stageTargets(null, wires)).toEqual([])
  })
})

suite('planIssues', () => {
  const wires = [red, blue, blackGreenDots]

  it('passes a sound plan', () => {
    expect(planIssues(plan([baseColor('red'), baseColor('blue')]), wires)).toEqual([])
  })

  it('refuses a stage naming a wire that is not on the board', () => {
    expect(planIssues(plan([baseColor('pink')]), wires)).toContain('empty-stage:0')
  })

  it('refuses two stages claiming the same wire — the cut order would be luck', () => {
    // "Cut all the wires, then the red one": first-match gives stage 0 every
    // wire, so stage 1 is named for a wire it will never be handed. The
    // *losing* stage is the one flagged, since that is where the instruction
    // and the board come apart.
    const p = plan([anyWire(), baseColor('red')])
    expect(planIssues(p, wires)).toContain('ambiguous-stage:1')
    expect(stageTargets(p, wires)[1]).toEqual([])
  })

  it('refuses a plan with no stages at all', () => {
    expect(planIssues(plan([]), wires)).toEqual(['no-stages', 'nothing-to-cut'])
  })

  it('refuses a plan that asks for nothing to be cut', () => {
    const issues = planIssues(plan([allOf(anyWire(), notMatching(anyWire()))]), wires)
    expect(issues).toContain('nothing-to-cut')
  })
})

suite('resolvePlan and ruleIssues', () => {
  const wires = [red, blue, blackGreenDots]
  const cutRed = plan([baseColor('red')])
  const cutBlue = plan([baseColor('blue')])

  it('takes the `then` arm when the named colour really is absent', () => {
    const rule = { kind: 'branch', condition: { kind: 'absent', selector: baseColor('pink') }, then: cutRed, otherwise: cutBlue }
    expect(resolvePlan(rule, wires)).toBe(cutRed)
    expect(ruleIssues(rule, wires)).toEqual([])
  })

  it('takes the `otherwise` arm when it is present', () => {
    const rule = { kind: 'branch', condition: { kind: 'absent', selector: baseColor('blue') }, then: cutRed, otherwise: cutBlue }
    expect(resolvePlan(rule, wires)).toBe(cutBlue)
  })

  it('reads an `exists` condition the other way round', () => {
    const rule = { kind: 'branch', condition: { kind: 'exists', selector: baseColor('blue') }, then: cutRed, otherwise: cutBlue }
    expect(resolvePlan(rule, wires)).toBe(cutRed)
  })

  it('leaves a plain plan alone', () => {
    expect(resolvePlan(cutRed, wires)).toBe(cutRed)
  })

  it('validates the arm the board does NOT take — a mis-read condition must meet a real wrong answer', () => {
    const rule = {
      kind: 'branch',
      condition: { kind: 'absent', selector: baseColor('pink') },
      then: cutRed,
      otherwise: plan([baseColor('orange')]), // not on this board
    }
    expect(ruleIssues(rule, wires)).toContain('empty-stage:0')
  })

  it('refuses a branch whose arms cut the same wires — the condition would be decoration', () => {
    const rule = { kind: 'branch', condition: { kind: 'absent', selector: baseColor('pink') }, then: cutRed, otherwise: plan([baseColor('red')]) }
    expect(ruleIssues(rule, wires)).toEqual(['branch-indistinct'])
  })
})

suite('cutOutcome', () => {
  const wires = [red, blue, blackGreenDots]
  const p = plan([baseColor('blue'), baseColor('red')])

  it('accepts the first stage first', () => {
    expect(cutOutcome(p, wires, [], 'b')).toEqual({ ok: true, reason: 'safe', stage: 0 })
  })

  it('blows up on a wire the instruction never named', () => {
    expect(cutOutcome(p, wires, [], 'k')).toEqual({ ok: false, reason: 'not-a-target' })
  })

  it('blows up on the right wire at the wrong time', () => {
    expect(cutOutcome(p, wires, [], 'r')).toEqual({ ok: false, reason: 'out-of-order' })
  })

  it('accepts it once its turn comes', () => {
    expect(cutOutcome(p, wires, ['b'], 'r')).toEqual({ ok: true, reason: 'safe', stage: 1 })
  })

  it('refuses a wire already cut', () => {
    expect(cutOutcome(p, wires, ['b'], 'b')).toEqual({ ok: false, reason: 'already-cut' })
  })

  it('lets a set-stage be cut in any order within itself', () => {
    const set = plan([allOf(anyWire(), notMatching(baseColor('black')))])
    expect(cutOutcome(set, wires, [], 'b').ok).toBe(true)
    expect(cutOutcome(set, wires, ['b'], 'r').ok).toBe(true)
    expect(cutOutcome(set, wires, ['r'], 'b').ok).toBe(true)
  })
})

suite('isDefused', () => {
  const wires = [red, blue, blackGreenDots]
  const p = plan([baseColor('blue'), baseColor('red')])

  it('is not defused while a named wire is intact', () => {
    expect(isDefused(p, wires, ['b'])).toBe(false)
  })

  it('is defused once every named wire is cut, and ignores the ones left alone', () => {
    expect(isDefused(p, wires, ['b', 'r'])).toBe(true)
  })
})

// The seven instructions #728 lists, rendered. These are the acceptance test
// for the grammar: if the AST cannot say one of them, it is the wrong AST.
suite('describe — the instructions from the issue', () => {
  it('says "blue then red"', () => {
    expect(describe(plan([baseColor('blue'), baseColor('red')])).ru).toBe(
      'Перере́жь си́ний про́вод, пото́м кра́сный про́вод.',
    )
  })

  it('says "green after yellow" as the order it means', () => {
    const { ru, en } = describe(plan([baseColor('yellow'), baseColor('green')]))
    expect(ru).toBe('Перере́жь жёлтый про́вод, пото́м зелёный про́вод.')
    expect(en).toBe('Cut the yellow wire, then the green wire.')
  })

  it('says "all except black"', () => {
    const { ru, en } = describe(plan([allOf(anyWire(), notMatching(baseColor('black')))]))
    expect(ru).toBe('Перере́жь все провода́, кро́ме чёрного.')
    expect(en).toBe('Cut all the wires, except the black one.')
  })

  it('says "red and blue stripes, then black and brown stripes"', () => {
    const { ru } = describe(
      plan([
        allOf(baseColor('red'), withAccent('striped', 'blue')),
        allOf(baseColor('black'), withAccent('striped', 'brown')),
      ]),
    )
    expect(ru).toBe(
      'Перере́жь кра́сный про́вод с си́ними поло́сками, пото́м чёрный про́вод с кори́чневыми поло́сками.',
    )
  })

  it('says "purple with green dots, but only after the red and then green wire"', () => {
    const { ru, en } = describe(
      plan([baseColor('red'), baseColor('green'), allOf(baseColor('purple'), withAccent('spotted', 'green'))]),
    )
    expect(ru).toBe(
      'Перере́жь кра́сный про́вод, пото́м зелёный про́вод, пото́м фиоле́товый про́вод с зелёными то́чками.',
    )
    expect(en).toBe('Cut the red wire, then the green wire, then the purple wire with green dots.')
  })

  it('says "if there is no X, cut anything with a white stripe; otherwise the green wire"', () => {
    const { ru, en } = describe({
      kind: 'branch',
      condition: { kind: 'absent', selector: baseColor('orange') },
      then: plan([withAccent('striped', 'white')]),
      otherwise: plan([baseColor('green')]),
    })
    expect(ru).toBe(
      'Е́сли нет ора́нжевого про́вода, перере́жь все провода́ с бе́лыми поло́сками. Ина́че перере́жь зелёный про́вод.',
    )
    expect(en).toBe(
      'If there is no orange wire, cut all the wires with white stripes. Otherwise cut the green wire.',
    )
  })

  it('says "cut all the spotted wires unless they have green"', () => {
    const { ru, en } = describe(plan([allOf(withPattern('spotted'), notMatching(hasColor('green')))]))
    expect(ru).toBe('Перере́жь все провода́ с то́чками, кро́ме тех, где есть зелёный.')
    expect(en).toBe('Cut all the wires with dots, except the ones with green on them.')
  })
})

suite('describe — the shapes the examples do not reach', () => {
  it('states a positive condition', () => {
    const { ru, en } = describe({
      kind: 'branch',
      condition: { kind: 'exists', selector: baseColor('grey') },
      then: plan([baseColor('red')]),
      otherwise: plan([baseColor('blue')]),
    })
    expect(ru).toBe('Е́сли есть се́рый про́вод, перере́жь кра́сный про́вод. Ина́че перере́жь си́ний про́вод.')
    // синий glosses as "dark blue" — English has one word where Russian has
    // two, and the gloss has to keep them apart from голубой.
    expect(en).toBe('If there is the grey wire, cut the red wire. Otherwise cut the dark blue wire.')
  })

  it('states a condition about a pattern rather than a colour', () => {
    const { ru, en } = describe({
      kind: 'branch',
      condition: { kind: 'absent', selector: withPattern('striped') },
      then: plan([baseColor('red')]),
      otherwise: plan([baseColor('blue')]),
    })
    expect(ru).toContain('Е́сли нет все провода́ с поло́сками')
    expect(en).toContain('If there is no all the wires with stripes')
  })
})

suite('phraseRu / phraseEn', () => {
  it('names a bare pattern group', () => {
    expect(phraseRu(withPattern('striped'))).toBe('все провода́ с поло́сками')
    expect(phraseEn(withPattern('plain'))).toBe('all the wires with no pattern')
  })

  it('names an accent with no base colour', () => {
    expect(phraseRu(withAccent('spotted', 'pink'))).toBe('все провода́ с ро́зовыми то́чками')
    expect(phraseEn(withAccent('spotted', 'pink'))).toBe('all the wires with pink dots')
  })

  it('names wires carrying a colour anywhere', () => {
    expect(phraseRu(hasColor('lightblue'))).toBe('все провода́, где есть голубо́й')
    expect(phraseEn(hasColor('lightblue'))).toBe('all the wires with light blue on them')
  })

  it('names every wire when nothing constrains it', () => {
    expect(phraseRu(anyWire())).toBe('все провода́')
    expect(phraseEn(anyWire())).toBe('all the wires')
  })

  it('excludes by pattern and by accent', () => {
    expect(phraseRu(allOf(anyWire(), notMatching(withPattern('spotted'))))).toBe(
      'все провода́, кро́ме тех, что с то́чками',
    )
    expect(phraseEn(allOf(anyWire(), notMatching(withAccent('striped', 'white'))))).toBe(
      'all the wires, except the ones with white stripes',
    )
    expect(phraseRu(allOf(anyWire(), notMatching(withAccent('striped', 'white'))))).toBe(
      'все провода́, кро́ме тех, что с бе́лыми поло́сками',
    )
  })

  it('falls back rather than saying nothing when an exclusion constrains nothing', () => {
    expect(phraseRu(allOf(anyWire(), notMatching(anyWire())))).toBe('все провода́, кро́ме остальны́х')
    expect(phraseEn(allOf(anyWire(), notMatching(anyWire())))).toBe('all the wires, except the rest')
  })
})

suite('wireLabelEn', () => {
  it('names a plain wire', () => {
    expect(wireLabelEn(red)).toBe('red wire')
  })

  it('names a patterned wire — the only description a screen reader gets', () => {
    expect(wireLabelEn(blackGreenDots)).toBe('black wire with green dots')
    expect(wireLabelEn(purpleWhiteStripes)).toBe('purple wire with white stripes')
  })
})

suite('levelFor', () => {
  it('starts at the first level and climbs one per round', () => {
    expect(levelFor(1)).toBe(0)
    expect(levelFor(3)).toBe(2)
  })

  it('holds at the top rather than running off the end', () => {
    expect(levelFor(99)).toBe(LEVELS.length - 1)
  })

  it('treats a round below one as the first', () => {
    expect(levelFor(0)).toBe(0)
  })
})

suite('generateBomb', () => {
  // The generator is the part that can quietly produce an unwinnable or
  // unsayable bomb, so it is swept rather than sampled: every level, many
  // seeds, each bomb played through to a defusal.
  it('produces a sound, sayable, winnable bomb at every level', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const rng = mulberry32(seed)
      for (let round = 1; round <= LEVELS.length + 2; round += 1) {
        const bomb = generateBomb(round, rng)
        const where = `seed ${seed}, round ${round}`

        expect(ruleIssues(bomb.rule, bomb.wires), where).toEqual([])
        expect(bomb.seconds, where).toBeGreaterThan(0)
        expect(bomb.level, where).toBe(levelFor(round) + 1)

        // Nothing unsaid: a missing lexicon entry shows up as "undefined" in
        // the sentence the player hears.
        expect(bomb.ru, where).not.toMatch(/undefined/)
        expect(bomb.en, where).not.toMatch(/undefined/)
        expect(bomb.ru.length, where).toBeGreaterThan(10)

        // Base colours are distinct, so "the blue wire" names exactly one.
        const colors = bomb.wires.map((w) => w.color)
        expect(new Set(colors).size, where).toBe(colors.length)
        for (const w of bomb.wires) {
          expect(COLORS[w.color], where).toBeTruthy()
          if (w.accent) expect(COLORS[w.accent], where).toBeTruthy()
          expect(w.accent ? w.pattern !== 'plain' : w.pattern === 'plain', where).toBe(true)
        }

        // Play it: stage by stage, every cut is safe and the bomb ends defused.
        const p = resolvePlan(bomb.rule, bomb.wires)
        const cut = []
        for (const stage of stageTargets(p, bomb.wires)) {
          expect(stage.length, where).toBeGreaterThan(0)
          for (const id of stage) {
            expect(cutOutcome(p, bomb.wires, cut, id), where).toMatchObject({ ok: true })
            cut.push(id)
          }
        }
        expect(isDefused(p, bomb.wires, cut), where).toBe(true)
      }
    }
  })

  it('blows up on a wire outside the plan, wherever one exists', () => {
    let checked = 0
    for (let seed = 1; seed <= 40; seed += 1) {
      const rng = mulberry32(seed)
      const bomb = generateBomb(4, rng)
      const p = resolvePlan(bomb.rule, bomb.wires)
      const targets = stageTargets(p, bomb.wires).flat()
      const spare = bomb.wires.find((w) => !targets.includes(w.id))
      if (!spare) continue
      expect(cutOutcome(p, bomb.wires, [], spare.id)).toEqual({ ok: false, reason: 'not-a-target' })
      checked += 1
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('falls back to a plain sequence when no shape fits the board it is given', () => {
    // Level 5 offers only pattern-hungry shapes; an RNG that never rolls under
    // 0.5 gives every wire a plain body, so all three decline every attempt.
    const bomb = generateBomb(5, () => 0.999)
    expect(bomb.wires.every((w) => w.pattern === 'plain')).toBe(true)
    expect(bomb.rule.kind).toBe('plan')
    expect(bomb.rule.stages).toHaveLength(2)
    expect(ruleIssues(bomb.rule, bomb.wires)).toEqual([])
    expect(bomb.ru).toMatch(/^Перере́жь /)
  })

  it('defaults to the first round', () => {
    const bomb = generateBomb(undefined, mulberry32(7))
    expect(bomb.round).toBe(1)
    expect(bomb.level).toBe(1)
  })

  it('gives a conditional arm a pattern to name, not only a bare colour', () => {
    // #728's own conditional is "…cut anything with a white stripe. Otherwise
    // cut the green wire." Arms built solely from base colours can never say
    // the first half, so the example would exist only in this test file.
    let patterned = 0
    let total = 0
    for (let seed = 1; seed <= 80; seed += 1) {
      const rng = mulberry32(seed)
      for (const round of [6, 7]) {
        const bomb = generateBomb(round, rng)
        if (bomb.rule.kind !== 'branch') continue
        total += 1
        const arms = [bomb.rule.then, bomb.rule.otherwise]
        if (arms.some((p) => p.stages.some((s) => s.kind === 'accent'))) patterned += 1
      }
    }
    expect(total).toBeGreaterThan(0)
    expect(patterned).toBeGreaterThan(0)
  })

  it('reaches every shape across a sweep — no shape is dead code', () => {
    const seen = new Set()
    for (let seed = 1; seed <= 80; seed += 1) {
      const rng = mulberry32(seed)
      for (let round = 1; round <= LEVELS.length; round += 1) {
        const bomb = generateBomb(round, rng)
        if (bomb.rule.kind === 'branch') {
          seen.add('branch')
          continue
        }
        const stages = bomb.rule.stages
        if (stages.some((s) => s.kind === 'all' && s.parts.some((p) => p.kind === 'pattern'))) {
          seen.add('patternSet')
        } else if (stages.some((s) => s.kind === 'all' && s.parts.some((p) => p.kind === 'not'))) {
          seen.add('except')
        } else if (stages.some((s) => s.kind === 'all')) {
          seen.add(stages.length >= 3 ? 'afterThen' : 'accentPair')
        } else {
          seen.add(`sequence${stages.length}`)
        }
      }
    }
    expect([...seen].sort()).toEqual(
      ['accentPair', 'afterThen', 'branch', 'except', 'patternSet', 'sequence2', 'sequence3'].sort(),
    )
  })
})
