// Exercise generators for the number drill. Pure functions: each takes a random
// source and returns a self-contained question the view can present and grade.
//
// An exercise is:
//   { id, kind, value, prompt, instruction, answers, reveal, note }
// where `answers` is the list of accepted Russian strings (graded stress- and
// ё/е-insensitively by quiz.checkAnswer) and `reveal` is the canonical,
// stress-marked form to show as the model answer.

import {
  cardinal as declineCardinal,
  cardinalNominative,
  ordinal,
  yearOrdinal,
  yearPhrase,
  agree,
} from './numerals.js'

const CASE_NAMES = {
  gen: 'genitive',
  dat: 'dative',
  ins: 'instrumental',
  pre: 'prepositional',
}
const CASE_HINTS = {
  gen: 'of … / нет …',
  dat: 'to … / к …',
  ins: 'with / by … / с …',
  pre: 'about … / о …',
}

const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))

const YEAR_FRAMES = [
  (y) => `I was born in ${y}.`,
  (y) => `It happened in ${y}.`,
  (y) => `She moved to Moscow in ${y}.`,
  (y) => `The book was published in ${y}.`,
]

// Genitive of a few months, for "the Nth of <month>" date questions.
const MONTHS_GEN = [
  'января́',
  'февраля́',
  'ма́рта',
  'апре́ля',
  'ма́я',
  'ию́ня',
  'ию́ля',
  'а́вгуста',
  'сентября́',
  'октября́',
  'ноября́',
  'декабря́',
]
const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const ГОД = { one: 'год', few: 'го́да', many: 'лет' }
const РУБЛЬ = { one: 'рубль', few: 'рубля́', many: 'рубле́й' }

/** "in <year>" — the prepositional ordinal "… году́". */
function year(rng) {
  const y = randInt(rng, 1900, 2100)
  const phrase = yearPhrase(y) // "… году́"
  return {
    id: `year:${y}`,
    kind: 'year',
    value: y,
    prompt: YEAR_FRAMES[randInt(rng, 0, YEAR_FRAMES.length - 1)](y),
    instruction: 'Type the year as in «в … году́».',
    answers: [phrase, yearOrdinal(y)], // accept with or without «году»
    reveal: phrase,
    note: `${y}`,
  }
}

/** Spell a whole number in the nominative. */
function cardinal(rng) {
  const n = randInt(rng, 11, 999)
  return {
    id: `cardinal:${n}`,
    kind: 'cardinal',
    value: n,
    prompt: `Write this number in words: ${n}`,
    instruction: 'Nominative case.',
    answers: [cardinalNominative(n)],
    reveal: cardinalNominative(n),
    note: '',
  }
}

/** An age, exercising год / года / лет agreement. */
function age(rng) {
  const n = randInt(rng, 1, 99)
  const word = `${cardinalNominative(n)} ${agree(n, ГОД)}`
  return {
    id: `age:${n}`,
    kind: 'age',
    value: n,
    prompt: `Say this age: ${n} years old`,
    instruction: 'Number + the right form of «год».',
    answers: [word],
    reveal: word,
    note: 'e.g. «Мне … »',
  }
}

/** A price in roubles, exercising рубль / рубля / рублей agreement. */
function price(rng) {
  const n = randInt(rng, 1, 999)
  const word = `${cardinalNominative(n)} ${agree(n, РУБЛЬ)}`
  return {
    id: `price:${n}`,
    kind: 'price',
    value: n,
    prompt: `How much does it cost? ${n} ₽`,
    instruction: 'Number + the right form of «рубль».',
    answers: [word],
    reveal: word,
    note: '',
  }
}

/** A date "the Nth of <month>" — genitive ordinal practice. */
function date(rng) {
  const day = randInt(rng, 1, 28)
  const m = randInt(rng, 0, 11)
  const word = `${ordinal(day, { case: 'gen' })} ${MONTHS_GEN[m]}`
  return {
    id: `date:${day}:${m}`,
    kind: 'date',
    value: day,
    prompt: `What's the date? the ${ordinalEn(day)} of ${MONTHS_EN[m]}`,
    instruction: 'Genitive ordinal + month, e.g. «восьмо́го ма́рта».',
    answers: [word],
    reveal: word,
    note: '',
  }
}

/** Put a whole number into an oblique case — drills full cardinal declension. */
function caseForm(rng) {
  const n = randInt(rng, 11, 999)
  const kase = ['gen', 'dat', 'ins', 'pre'][randInt(rng, 0, 3)]
  const word = declineCardinal(n, { case: kase })
  return {
    id: `caseForm:${n}:${kase}`,
    kind: 'caseForm',
    value: n,
    prompt: `Put ${n} into the ${CASE_NAMES[kase]}`,
    instruction: `${CASE_NAMES[kase]} — ${CASE_HINTS[kase]}`,
    answers: [word],
    reveal: word,
    note: `${n}`,
  }
}

/** English ordinal suffix, just for the prompt text. */
function ordinalEn(n) {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`
}

export const GENERATORS = { year, cardinal, age, price, date, caseForm }

/** Human labels for each exercise kind (used by the progress dashboard too). */
export const TOPIC_LABELS = {
  year: 'Years',
  cardinal: 'Whole numbers',
  age: 'Ages',
  price: 'Prices',
  date: 'Dates',
  caseForm: 'Number cases',
}

/** Named focus areas the UI offers, each a set of exercise kinds. */
export const FOCUSES = [
  { id: 'mixed', label: 'Mixed', kinds: ['year', 'cardinal', 'age', 'price', 'date', 'caseForm'] },
  { id: 'years', label: 'Years', kinds: ['year'] },
  { id: 'numbers', label: 'Whole numbers', kinds: ['cardinal'] },
  { id: 'cases', label: 'Number cases', kinds: ['caseForm'] },
  { id: 'dates', label: 'Dates', kinds: ['date'] },
  { id: 'agreement', label: 'Ages & prices', kinds: ['age', 'price'] },
]

/**
 * Produce the next exercise drawn from the given kinds.
 * @param {string[]} kinds
 * @param {() => number} [rng]
 * @returns {object}
 */
export function nextExercise(kinds, rng = Math.random) {
  const pick = kinds[Math.floor(rng() * kinds.length)]
  return GENERATORS[pick](rng)
}
