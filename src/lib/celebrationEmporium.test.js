import { describe, expect, it } from 'vitest'

import {
  AGE_RANGE,
  BAKE_MS,
  RELATIONS,
  SLOTS,
  WARM_UP,
  YEAR_RANGE,
  ageWords,
  arrivalGap,
  isFull,
  makeCake,
  nextCustomer,
  openingCabinet,
  orderKind,
  relationsFor,
  requestText,
  suits,
} from './celebrationEmporium.js'

/** A small deterministic generator, so a run can be replayed exactly. */
function seeded(seed = 1) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('what a customer says', () => {
  it('asks for an age with the dative and the right word for years', () => {
    expect(requestText({ kind: 'age', value: 19, relation: 'brother' })).toEqual({
      ru: 'Моему́ бра́ту девятна́дцать лет.',
      en: 'My brother is 19.',
    })
    expect(requestText({ kind: 'age', value: 56, relation: 'son' }).ru).toBe('Моему́ сы́ну пятьдеся́т шесть лет.')
    expect(requestText({ kind: 'age', value: 21, relation: 'daughter' }).ru).toBe('Мое́й до́чери два́дцать оди́н год.')
  })

  it('agrees моему́ or мое́й with the person, not the ending of the noun', () => {
    expect(requestText({ kind: 'age', value: 72, relation: 'grandfather' }).ru).toMatch(/^Моему́ де́душке/)
    expect(requestText({ kind: 'age', value: 40, relation: 'uncle' }).ru).toMatch(/^Моему́ дя́де/)
    expect(requestText({ kind: 'age', value: 40, relation: 'aunt' }).ru).toMatch(/^Мое́й тёте/)
  })

  it('says a year as the ordinal Russian uses for it', () => {
    expect(requestText({ kind: 'year', value: 1926 })).toEqual({
      ru: 'Мне ну́жен ты́сяча девятьсо́т два́дцать шесто́й год.',
      en: 'I need the year 1926.',
    })
    expect(requestText({ kind: 'year', value: 2000 }).ru).toBe('Мне ну́жен двухты́сячный год.')
  })

  it('counts years with год, го́да and лет as Russian does', () => {
    expect(ageWords(1)).toBe('оди́н год')
    expect(ageWords(3)).toBe('три го́да')
    expect(ageWords(11)).toBe('оди́ннадцать лет')
    expect(ageWords(102)).toBe('сто два го́да')
  })
})

describe('who can be how old', () => {
  it('keeps grandparents over fifty and grandchildren under thirty', () => {
    const at = (age) => relationsFor(age).map((r) => r.id)
    expect(at(8)).not.toContain('grandmother')
    expect(at(8)).toContain('grandson')
    expect(at(64)).toContain('grandfather')
    expect(at(64)).not.toContain('granddaughter')
    expect(at(90)).not.toContain('son')
    expect(at(12)).not.toContain('wife')
  })

  it('has someone believable for every age the shop bakes', () => {
    for (let age = AGE_RANGE[0]; age <= AGE_RANGE[1]; age++) expect(relationsFor(age).length, age).toBeGreaterThan(0)
  })

  it('gives every relation a range inside the ages the shop bakes', () => {
    for (const r of RELATIONS) {
      expect(r.min).toBeGreaterThanOrEqual(AGE_RANGE[0])
      expect(r.max).toBeLessThanOrEqual(AGE_RANGE[1])
    }
  })
})

describe('the intercom', () => {
  it('bakes an age or a year and refuses anything else', () => {
    expect(orderKind(19)).toBe('age')
    expect(orderKind(120)).toBe('age')
    expect(orderKind(1800)).toBe('year')
    expect(orderKind(2099)).toBe('year')
    expect(orderKind(0)).toBeNull()
    expect(orderKind(121)).toBeNull()
    expect(orderKind(1799)).toBeNull()
    expect(orderKind(2100)).toBeNull()
    expect(() => makeCake(500, 'x')).toThrow(RangeError)
    expect(makeCake(1926, 'x')).toEqual({ id: 'x', kind: 'year', value: 1926 })
  })
})

describe('customers', () => {
  it('only asks for what is on the shelves while the shop warms up, then never does', () => {
    const rng = seeded(7)
    const cabinet = openingCabinet(rng)
    const onShelf = new Set(cabinet.map((c) => c.value))
    const waiting = []
    for (let arrived = 0; arrived < 30; arrived++) {
      const c = nextCustomer({ arrived, cabinet, waiting, rng })
      expect(onShelf.has(c.value), `customer ${arrived}`).toBe(arrived < WARM_UP)
      waiting.push(c)
    }
  })

  it('never promises one shelf cake to two customers at once', () => {
    const rng = seeded(3)
    const cabinet = openingCabinet(rng)
    const waiting = []
    for (let arrived = 0; arrived < WARM_UP; arrived++) waiting.push(nextCustomer({ arrived, cabinet, waiting, rng }))
    expect(new Set(waiting.map((c) => c.value)).size).toBe(WARM_UP)
  })

  it('makes every request believable and says it the way requestText does', () => {
    const rng = seeded(11)
    const cabinet = openingCabinet(rng)
    for (let arrived = 0; arrived < 200; arrived++) {
      const c = nextCustomer({ arrived, cabinet, rng })
      expect(orderKind(c.value)).toBe(c.kind)
      if (c.kind === 'age') expect(relationsFor(c.value).map((r) => r.id)).toContain(c.relation)
      expect(c.ru).toBe(requestText(c).ru)
    }
  })

  it('writes every request down when there is no voice to say it', () => {
    const rng = seeded(5)
    const cabinet = openingCabinet(rng)
    for (let arrived = 0; arrived < 50; arrived++) {
      expect(nextCustomer({ arrived, cabinet, canSpeak: false, rng }).spoken).toBe(false)
    }
  })

  it('comes in every ten seconds at first and as fast as the kitchen bakes at the end', () => {
    expect(arrivalGap(0)).toBe(10_000)
    expect(arrivalGap(12)).toBeLessThan(10_000)
    expect(arrivalGap(12)).toBeGreaterThan(BAKE_MS)
    expect(arrivalGap(24)).toBe(BAKE_MS)
    expect(arrivalGap(200)).toBe(BAKE_MS)
  })
})

describe('the shop', () => {
  it('opens with a full cabinet of distinct cakes', () => {
    const cabinet = openingCabinet(seeded(2))
    expect(cabinet).toHaveLength(SLOTS)
    expect(new Set(cabinet.map((c) => c.value)).size).toBe(SLOTS)
    for (const c of cabinet) {
      const [lo, hi] = c.kind === 'age' ? AGE_RANGE : YEAR_RANGE
      expect(c.value).toBeGreaterThanOrEqual(lo)
      expect(c.value).toBeLessThanOrEqual(hi)
    }
  })

  it('suits a customer only with the exact cake they asked for', () => {
    const customer = { kind: 'age', value: 19 }
    expect(suits({ kind: 'age', value: 19 }, customer)).toBe(true)
    expect(suits({ kind: 'age', value: 91 }, customer)).toBe(false)
    expect(suits(null, customer)).toBe(false)
  })

  it('is full, and the game over, when all nine places are taken', () => {
    expect(isFull(Array(8).fill({}))).toBe(false)
    expect(isFull(Array(9).fill({}))).toBe(true)
  })
})
