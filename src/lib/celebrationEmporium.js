// Celebration Emporium (#727): a cake shop whose customers ask, in Russian, for
// a cake for somebody's age — «Моему́ бра́ту девятна́дцать лет» — or for a year,
// «Мне ну́жен ты́сяча девятьсо́т два́дцать шесто́й год». The player hands over a
// cake from the cabinet whose tag matches, or dials a new one on the intercom.
//
// Everything that decides what a customer says, what a cake is and whether it
// suits them lives here, pure and seeded; the view owns the clocks, the voice
// and the taps. The Russian is built from lib/numerals.js, the same checked
// tables every number drill uses, so a sentence and the number it names cannot
// drift apart.
import { agree, cardinalNominative, yearOrdinal } from './numerals.js'

/** Three rows of three, for the customers and for the cakes alike. */
export const SLOTS = 9

/** Ages and years the shop bakes; anything else dialled is refused. */
export const AGE_RANGE = Object.freeze([1, 120])
export const YEAR_RANGE = Object.freeze([1800, 2099])

/** How long the kitchen takes over one cake ordered on the intercom. */
export const BAKE_MS = 3000

/** Customers who only want what is already on the shelves, before the rush. */
export const WARM_UP = 4

/**
 * Who a cake can be for, and how old they can plausibly be. The dative is what
 * the sentence needs («Моему́ сы́ну …»), and `gender` picks моему́ or мое́й — by
 * the person, not the noun's ending, which is why де́душка and дя́дя are `m`.
 */
export const RELATIONS = Object.freeze([
  { id: 'grandfather', dative: 'де́душке', gender: 'm', en: 'grandfather', min: 50, max: 120 },
  { id: 'grandmother', dative: 'ба́бушке', gender: 'f', en: 'grandmother', min: 50, max: 120 },
  { id: 'grandson', dative: 'вну́ку', gender: 'm', en: 'grandson', min: 1, max: 30 },
  { id: 'granddaughter', dative: 'вну́чке', gender: 'f', en: 'granddaughter', min: 1, max: 30 },
  { id: 'son', dative: 'сы́ну', gender: 'm', en: 'son', min: 1, max: 80 },
  { id: 'daughter', dative: 'до́чери', gender: 'f', en: 'daughter', min: 1, max: 80 },
  { id: 'nephew', dative: 'племя́ннику', gender: 'm', en: 'nephew', min: 1, max: 80 },
  { id: 'niece', dative: 'племя́ннице', gender: 'f', en: 'niece', min: 1, max: 80 },
  { id: 'uncle', dative: 'дя́де', gender: 'm', en: 'uncle', min: 20, max: 120 },
  { id: 'aunt', dative: 'тёте', gender: 'f', en: 'aunt', min: 20, max: 120 },
  { id: 'husband', dative: 'му́жу', gender: 'm', en: 'husband', min: 20, max: 120 },
  { id: 'wife', dative: 'жене́', gender: 'f', en: 'wife', min: 20, max: 120 },
  { id: 'boyfriend', dative: 'па́рню', gender: 'm', en: 'boyfriend', min: 20, max: 120 },
  { id: 'girlfriend', dative: 'де́вушке', gender: 'f', en: 'girlfriend', min: 20, max: 120 },
  { id: 'father', dative: 'па́пе', gender: 'm', en: 'dad', min: 20, max: 120 },
  { id: 'mother', dative: 'ма́ме', gender: 'f', en: 'mum', min: 20, max: 120 },
  { id: 'brother', dative: 'бра́ту', gender: 'm', en: 'brother', min: 1, max: 120 },
  { id: 'sister', dative: 'сестре́', gender: 'f', en: 'sister', min: 1, max: 120 },
  { id: 'friend', dative: 'дру́гу', gender: 'm', en: 'friend', min: 1, max: 120 },
  { id: 'girl-friend', dative: 'подру́ге', gender: 'f', en: 'friend', min: 1, max: 120 },
])

const YEARS_OLD = { one: 'год', few: 'го́да', many: 'лет' }

/** The customers who come in; purely decorative. */
export const FACES = Object.freeze(['🧑', '👩', '👨', '🧓', '👵', '👴', '👱‍♀️', '🧔', '👩‍🦰', '👨‍🦱'])

const pick = (list, rng) => list[Math.floor(rng() * list.length)]
/** @param {readonly number[]} range  [low, high], inclusive */
const between = (range, rng) => range[0] + Math.floor(rng() * (range[1] - range[0] + 1))

/** «девятна́дцать лет», «два́дцать оди́н год», «сто два го́да». */
export function ageWords(n) {
  return `${cardinalNominative(n)} ${agree(n, YEARS_OLD)}`
}

/** Which kind of cake a dialled number is, or null when the shop won't bake it. */
export function orderKind(n) {
  if (!Number.isInteger(n)) return null
  if (n >= AGE_RANGE[0] && n <= AGE_RANGE[1]) return 'age'
  if (n >= YEAR_RANGE[0] && n <= YEAR_RANGE[1]) return 'year'
  return null
}

/** A cake with its tag: the number, and so its kind, is all there is to it. */
export function makeCake(value, id) {
  const kind = orderKind(value)
  if (!kind) throw new RangeError(`celebrationEmporium: no cake for ${value}`)
  return { id, kind, value }
}

/** The relations it is believable to be `age` years old as. */
export function relationsFor(age) {
  return RELATIONS.filter((r) => age >= r.min && age <= r.max)
}

/**
 * What a customer says, in Russian and in English.
 * @param {{kind: 'age'|'year', value: number, relation?: string}} request
 * @returns {{ru: string, en: string}}
 */
export function requestText({ kind, value, relation }) {
  if (kind === 'year') {
    return { ru: `Мне ну́жен ${yearOrdinal(value, 'nom')} год.`, en: `I need the year ${value}.` }
  }
  const who = RELATIONS.find((r) => r.id === relation)
  if (!who) throw new RangeError(`celebrationEmporium: unknown relation ${relation}`)
  const my = who.gender === 'f' ? 'Мое́й' : 'Моему́'
  return {
    ru: `${my} ${who.dative} ${ageWords(value)}.`,
    en: `My ${who.en} is ${value}.`,
  }
}

/** A random age with someone believable to be it, or a random year. */
function freshRequest(rng, avoid) {
  for (let tries = 0; tries < 200; tries++) {
    const kind = rng() < 0.5 ? 'age' : 'year'
    const value = between(kind === 'age' ? AGE_RANGE : YEAR_RANGE, rng)
    if (avoid.has(value)) continue
    return { kind, value }
  }
  return { kind: 'year', value: between(YEAR_RANGE, rng) }
}

/**
 * The next customer to walk in.
 *
 * The first `WARM_UP` only ask for cakes already in the cabinet (and not already
 * promised to someone waiting), so a new player learns to read a request before
 * the intercom matters. After that every request is for a cake the cabinet does
 * not hold, so the intercom is the only way to serve it.
 *
 * @param {object} opts
 * @param {number} opts.arrived    customers who have come in so far
 * @param {{value: number}[]} opts.cabinet  cakes on the shelves
 * @param {{value: number}[]} [opts.waiting] customers already in the shop
 * @param {boolean} [opts.canSpeak] whether a request can be spoken at all
 * @param {() => number} [opts.rng]
 */
export function nextCustomer({ arrived, cabinet, waiting = [], canSpeak = true, rng = Math.random }) {
  const promised = new Set(waiting.map((c) => c.value))
  const onShelf = cabinet.filter((c) => !promised.has(c.value))
  const request =
    arrived < WARM_UP && onShelf.length
      ? (({ kind, value }) => ({ kind, value }))(pick(onShelf, rng))
      : freshRequest(rng, new Set([...cabinet.map((c) => c.value), ...promised]))
  if (request.kind === 'age') request.relation = pick(relationsFor(request.value), rng).id
  return {
    id: `customer-${arrived}`,
    ...request,
    ...requestText(request),
    face: pick(FACES, rng),
    // Half the customers say it and half show it written down; with no voice to
    // hear it from, all of them write it down.
    spoken: canSpeak && rng() < 0.5,
  }
}

/**
 * How long until the next customer, given how many have come in. Ten seconds
 * at the door, closing in steadily until they arrive as fast as the kitchen
 * bakes — one every `BAKE_MS` — after two dozen customers.
 */
export function arrivalGap(arrived) {
  const START = 10_000
  const RAMP = 24
  return Math.max(BAKE_MS, Math.round(START - ((START - BAKE_MS) * arrived) / RAMP))
}

/** Whether this cake is the one this customer asked for. */
export function suits(cake, customer) {
  return Boolean(cake && customer) && cake.kind === customer.kind && cake.value === customer.value
}

/** The shelves as the shop opens: nine cakes, a mix of ages and years. */
export function openingCabinet(rng = Math.random) {
  const seen = new Set()
  const cakes = []
  while (cakes.length < SLOTS) {
    const { value } = freshRequest(rng, seen)
    seen.add(value)
    cakes.push(makeCake(value, `cake-${cakes.length}`))
  }
  return cakes
}

/** Whether the shop is full, which ends the game. */
export function isFull(waiting) {
  return waiting.length >= SLOTS
}
