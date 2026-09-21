// Emoji illustrations for the literature reader: one picture every few
// sentences, the way a children's edition breaks a page of prose.
//
// The shipped books use a small authored set of important moments: normally
// three or four over the whole work, and every meaningful beat in a very short
// fable. That makes the pictures punctuation rather than wallpaper. The stem
// matcher below is the preview for a newly added book while its moments are
// being chosen; a corpus test requires that choice before the book ships. Pure
// and deterministic: the same book always gets the same pictures, which matters
// because the page they land on has to be stable across a re-render and a
// re-paginate.
//
// Matching is deliberately shallow. The Russian is matched by stem, because a
// literary text inflects everything and the reader's real dictionary is one
// module over; the English translation, which the pack already carries, is
// matched word for word as a second opinion. A wrong picture is worse than no
// picture, so the bar is a stem hit rather than a guess, and `LEXICON` is a
// hand-written list rather than anything derived.
import { normToken } from './phraseHint.js'

/**
 * How far past a stem an inflected form may run before the match is rejected.
 * Russian endings are short: «голубка» is голуб + ка, but «который» is not кот.
 */
const MAX_ENDING = 3

/** A picture needs more than one passing English word to earn its place. */
const MIN_SCORE = 3

/**
 * The story beats worth punctuating in the shipped library. Sentence IDs are
 * stable editorial IDs, so the choice stays beside the exact moment it was
 * made for even when pagination or screen size changes.
 *
 * The two-sentence polecat has two pictures rather than inventing a third beat;
 * the other very short works use three. Everything else gets four.
 */
export const FEATURED_MOMENTS = Object.freeze({
  'afanasyev-turnip': Object.freeze({
    'afanasyev-turnip:01': '🌱',
    'afanasyev-turnip:02': '👵',
    'afanasyev-turnip:04': '🐶',
    'afanasyev-turnip:07': '🎉',
  }),
  'chekhov-fat-thin': Object.freeze({
    'chekhov-fat-thin:001': '🚂',
    'chekhov-fat-thin:036': '🎓',
    'chekhov-fat-thin:060': '⭐',
    'chekhov-fat-thin:078': '🙇',
  }),
  'chorny-foal': Object.freeze({
    'chorny-foal:01': '🐴',
    'chorny-foal:02': '🐶',
    'chorny-foal:03': '🏇',
  }),
  'kropotkin-hostages-letter': Object.freeze({
    'kropotkin-hostages-letter:002': '🔒',
    'kropotkin-hostages-letter:007': '⏳',
    'kropotkin-hostages-letter:014': '😨',
    'kropotkin-hostages-letter:016': '💭',
  }),
  'krylov-crow-fox': Object.freeze({
    'krylov-crow-fox:02': '🧀',
    'krylov-crow-fox:03': '🦊',
    'krylov-crow-fox:05': '👑',
    'krylov-crow-fox:06': '🎵',
  }),
  'krylov-dragonfly-ant': Object.freeze({
    'krylov-dragonfly-ant:01': '☀️',
    'krylov-dragonfly-ant:03': '❄️',
    'krylov-dragonfly-ant:05': '🙏',
    'krylov-dragonfly-ant:09': '💃',
  }),
  'krylov-elephant-pug': Object.freeze({
    'krylov-elephant-pug:01': '🐘',
    'krylov-elephant-pug:02': '🐶',
    'krylov-elephant-pug:03': '🙉',
    'krylov-elephant-pug:04': '💪',
  }),
  'krylov-swan-pike-crayfish': Object.freeze({
    'krylov-swan-pike-crayfish:01': '🤝',
    'krylov-swan-pike-crayfish:02': '🛒',
    'krylov-swan-pike-crayfish:03': '🧭',
    'krylov-swan-pike-crayfish:04': '⏳',
  }),
  'lenin-state-revolution-1-1': Object.freeze({
    'lenin-state-revolution-1-1:003': '🖼️',
    'lenin-state-revolution-1-1:009': '🏛️',
    'lenin-state-revolution-1-1:018': '⚔️',
    'lenin-state-revolution-1-1:037': '🔥',
  }),
  'mayakovsky-good-and-bad': Object.freeze({
    'mayakovsky-good-and-bad:01': '👨‍👦',
    'mayakovsky-good-and-bad:06': '🧼',
    'mayakovsky-good-and-bad:12': '🛡️',
    'mayakovsky-good-and-bad:16': '✅',
  }),
  'pushkin-fisherman-fish': Object.freeze({
    'pushkin-fisherman-fish:03': '🐟',
    'pushkin-fisherman-fish:18': '🏠',
    'pushkin-fisherman-fish:31': '👑',
    'pushkin-fisherman-fish:42': '🪣',
  }),
  'tolstoy-ant-dove': Object.freeze({
    'tolstoy-ant-dove:02': '🌊',
    'tolstoy-ant-dove:03': '🕊️',
    'tolstoy-ant-dove:05': '🏹',
    'tolstoy-ant-dove:06': '🐜',
  }),
  'tolstoy-fine-threads': Object.freeze({
    'tolstoy-fine-threads:01': '🧵',
    'tolstoy-fine-threads:03': '🫥',
    'tolstoy-fine-threads:05': '👀',
    'tolstoy-fine-threads:06': '💰',
  }),
  'tolstoy-lion-dog': Object.freeze({
    'tolstoy-lion-dog:03': '🦁',
    'tolstoy-lion-dog:10': '🥩',
    'tolstoy-lion-dog:16': '💔',
    'tolstoy-lion-dog:23': '🕯️',
  }),
  'tolstoy-lion-mouse': Object.freeze({
    'tolstoy-lion-mouse:01': '🦁',
    'tolstoy-lion-mouse:04': '🙏',
    'tolstoy-lion-mouse:06': '🪢',
    'tolstoy-lion-mouse:07': '🐭',
  }),
  'tolstoy-plum-stone': Object.freeze({
    'tolstoy-plum-stone:01': '🍑',
    'tolstoy-plum-stone:07': '🤫',
    'tolstoy-plum-stone:14': '☠️',
    'tolstoy-plum-stone:16': '🪟',
  }),
  'tolstoy-polecat': Object.freeze({
    'tolstoy-polecat:01': '🔧',
    'tolstoy-polecat:02': '🩸',
  }),
  'tolstoy-snake-head-tail': Object.freeze({
    'tolstoy-snake-head-tail:01': '🐍',
    'tolstoy-snake-head-tail:03': '🌳',
    'tolstoy-snake-head-tail:05': '💔',
    'tolstoy-snake-head-tail:06': '🕳️',
  }),
  'tolstoy-stone': Object.freeze({
    'tolstoy-stone:01': '🙏',
    'tolstoy-stone:04': '🪨',
    'tolstoy-stone:07': '⛓️',
    'tolstoy-stone:08': '❤️',
  }),
  'tolstoy-tortoise-eagle': Object.freeze({
    'tolstoy-tortoise-eagle:01': '🐢',
    'tolstoy-tortoise-eagle:02': '🦅',
    'tolstoy-tortoise-eagle:03': '💥',
  }),
})

/**
 * Stems and the picture they earn. Each entry is
 * `{ emoji, ru, ruExact, en, weight }`: `ru` stems match a normalised token by
 * prefix, `ruExact` forms match one whole, `en` words match the translation
 * whole, and `weight` breaks ties towards the more concrete noun — a sentence
 * about a dove in a storm is a dove, not a cloud.
 *
 * `ruExact` is for short words whose prefix is another word's: «стол» is the
 * start of сто́лько, and «рак» of раке́та.
 */
export const LEXICON = Object.freeze([
  // Creatures
  { emoji: '🐜', ru: ['муравей', 'муравь'], en: ['ant', 'ants'], weight: 3 },
  { emoji: '🕊️', ru: ['голуб', 'голубк'], en: ['dove', 'pigeon'], weight: 3 },
  { emoji: '🦗', ru: ['стрекоз', 'кузнечик'], en: ['dragonfly', 'grasshopper'], weight: 3 },
  { emoji: '🐦', ru: ['птиц', 'птич'], en: ['bird', 'birds'], weight: 2 },
  { emoji: '🐟', ru: ['рыб'], en: ['fish'], weight: 2 },
  { emoji: '🦀', ru: [], ruExact: ['рак', 'рака', 'раком', 'раки'], en: ['crayfish', 'crab'], weight: 2 },
  { emoji: '🐴', ru: ['лошад', 'конь', 'кон'], en: ['horse'], weight: 2 },
  { emoji: '🐶', ru: ['собак', 'пёс', 'щен'], en: ['dog', 'puppy'], weight: 2 },
  { emoji: '🐱', ru: ['кошк', 'кот'], en: ['cat', 'kitten'], weight: 2 },
  { emoji: '🐺', ru: ['волк', 'волч'], en: ['wolf'], weight: 2 },
  { emoji: '🦊', ru: ['лис'], en: ['fox'], weight: 2 },
  { emoji: '🐻', ru: ['медвед'], en: ['bear'], weight: 2 },
  { emoji: '🐭', ru: ['мыш'], en: ['mouse'], weight: 2 },
  { emoji: '🐝', ru: ['пчел', 'пчёл'], en: ['bee', 'bees'], weight: 2 },

  // Weather, sky and season
  { emoji: '❄️', ru: ['зим', 'снег', 'снеж', 'мороз'], en: ['winter', 'snow', 'frost'], weight: 2 },
  { emoji: '☀️', ru: ['солнц', 'солнеч', 'лет'], en: ['sun', 'summer', 'sunlit'], weight: 2 },
  { emoji: '🌧️', ru: ['дожд', 'ливен', 'ливн'], en: ['rain', 'downpour'], weight: 2 },
  { emoji: '🌬️', ru: ['ветер', 'ветр', 'бур'], en: ['wind', 'storm', 'gale'], weight: 1 },
  { emoji: '🌙', ru: ['луна', 'лун', 'ноч'], en: ['moon', 'night'], weight: 1 },
  { emoji: '⭐', ru: ['звезд', 'звёзд'], en: ['star', 'stars'], weight: 2 },
  { emoji: '🌅', ru: ['утр', 'рассвет', 'заря'], en: ['morning', 'dawn'], weight: 1 },

  // Land and water
  { emoji: '🌊', ru: ['волн', 'мор', 'ручь', 'ручей', 'река', 'рек'], en: ['wave', 'sea', 'stream', 'river'], weight: 2 },
  { emoji: '🌲', ru: ['лес', 'ёлк', 'елк', 'сосн'], en: ['forest', 'wood', 'pine', 'fir'], weight: 2 },
  { emoji: '🌳', ru: ['дерев', 'дуб', 'берёз', 'берез'], en: ['tree', 'oak', 'birch'], weight: 2 },
  // No 'branch': a government branch is not a tree's, and Chekhov has both.
  { emoji: '🍃', ru: ['лист', 'ветк', 'ветв'], en: ['leaf', 'leaves', 'twig'], weight: 1 },
  // «поле», spelled out rather than stemmed to 'пол', which also starts полно,
  // полный, полк and половина.
  { emoji: '🌾', ru: ['поле', 'полей', 'полям', 'полях', 'трав', 'мурав', 'луг'], en: ['field', 'grass', 'meadow'], weight: 1 },
  { emoji: '🌸', ru: ['цвет', 'цветок'], en: ['flower', 'blossom'], weight: 2 },
  { emoji: '🏔️', ru: ['гор', 'холм'], en: ['mountain', 'hill'], weight: 1 },

  // Food and the table
  { emoji: '🍑', ru: ['слив'], en: ['plum', 'plums'], weight: 3 },
  { emoji: '🍒', ru: ['вишн', 'ягод'], en: ['cherry', 'cherries', 'berry'], weight: 2 },
  { emoji: '🍎', ru: ['яблок', 'яблон'], en: ['apple'], weight: 2 },
  { emoji: '🍞', ru: ['хлеб', 'каша'], en: ['bread', 'porridge'], weight: 2 },
  { emoji: '🍽️', ru: ['обед', 'ужин', 'завтрак'], ruExact: ['стол', 'стола', 'столе', 'столом'], en: ['dinner', 'supper', 'breakfast', 'table'], weight: 1 },
  { emoji: '🍷', ru: ['вино', 'вина', 'херес'], en: ['wine', 'sherry'], weight: 2 },
  { emoji: '🫖', ru: ['чай', 'чайник', 'кофе'], en: ['tea', 'coffee'], weight: 2 },

  // People and the body
  { emoji: '👶', ru: ['ребён', 'ребен', 'дит', 'младен'], en: ['child', 'baby', 'infant'], weight: 2 },
  { emoji: '👦', ru: ['мальчик', 'сын', 'ваня'], en: ['boy', 'son'], weight: 1 },
  { emoji: '👧', ru: ['девочк', 'доч'], en: ['girl', 'daughter'], weight: 1 },
  { emoji: '👩', ru: ['мать', 'матер', 'жена', 'жен'], en: ['mother', 'wife'], weight: 1 },
  { emoji: '👨', ru: ['отец', 'отц', 'муж'], en: ['father', 'husband'], weight: 1 },
  { emoji: '👴', ru: ['старик', 'дед'], en: ['old man', 'grandfather'], weight: 2 },
  { emoji: '👵', ru: ['старух', 'бабушк'], en: ['old woman', 'grandmother'], weight: 2 },
  { emoji: '👀', ru: ['глаз', 'взгляд', 'смотр'], en: ['eye', 'eyes', 'gaze'], weight: 1 },
  { emoji: '🤝', ru: ['рук', 'ладон'], en: ['hand', 'hands'], weight: 1 },

  // Feeling
  { emoji: '😂', ru: ['смех', 'смеял', 'хихик', 'хохот'], en: ['laugh', 'laughed', 'giggle', 'giggled'], weight: 2 },
  { emoji: '😢', ru: ['слез', 'плак', 'плач'], en: ['tear', 'tears', 'wept', 'cried'], weight: 2 },
  { emoji: '😨', ru: ['страх', 'испуг', 'бояз', 'боял'], en: ['fear', 'frightened', 'afraid'], weight: 2 },
  { emoji: '😴', ru: ['спал', 'сон', 'засн', 'уснул'], en: ['slept', 'sleep', 'asleep', 'dream'], weight: 2 },
  { emoji: '❤️', ru: ['любов', 'любил', 'серд'], en: ['love', 'loved', 'heart'], weight: 1 },
  // Exact forms keep кровать (bed) from becoming blood.
  { emoji: '🩸', ru: [], ruExact: ['кровь', 'крови', 'кровью'], en: ['blood'], weight: 2 },

  // Things and places
  { emoji: '🏠', ru: ['дом', 'изб', 'хат'], en: ['house', 'home', 'hut'], weight: 1 },
  { emoji: '🚂', ru: ['вокзал', 'поезд', 'вагон', 'железн'], en: ['station', 'train', 'carriage', 'railway'], weight: 2 },
  { emoji: '🧳', ru: ['чемодан', 'узл', 'картонк', 'багаж'], en: ['suitcase', 'bundle', 'hatbox', 'luggage'], weight: 2 },
  { emoji: '📖', ru: ['книг', 'книжк', 'читал', 'чтен'], en: ['book', 'read', 'reading'], weight: 2 },
  { emoji: '✉️', ru: ['письм', 'записк'], en: ['letter', 'note'], weight: 2 },
  { emoji: '🎓', ru: ['гимназ', 'школ', 'учил', 'ученик'], en: ['school', 'schoolboy', 'pupil'], weight: 2 },
  { emoji: '🕯️', ru: ['свеч', 'лампад'], en: ['candle', 'lamp'], weight: 2 },
  { emoji: '🔥', ru: ['огон', 'огн', 'пожар', 'костёр', 'костер'], en: ['fire', 'flame', 'bonfire'], weight: 2 },
  { emoji: '🪟', ru: ['окн', 'окош'], en: ['window'], weight: 1 },
  { emoji: '🚪', ru: ['двер', 'ворот'], en: ['door', 'gate'], weight: 1 },
  { emoji: '🕸️', ru: ['сет'], en: ['net'], weight: 2 },
  { emoji: '🏹', ru: ['охотник', 'охот', 'ружь'], en: ['hunter', 'hunt', 'gun'], weight: 2 },
  { emoji: '💰', ru: ['деньг', 'рубл', 'жаловань', 'копейк'], en: ['money', 'rouble', 'pay', 'wages'], weight: 2 },

  // The political shelf: the vocabulary Lenin actually argues in
  { emoji: '🏛️', ru: ['государств'], en: ['state'], weight: 2 },
  { emoji: '⚒️', ru: ['рабоч', 'пролетар', 'труд'], en: ['worker', 'workers', 'proletarian', 'labour'], weight: 2 },
  { emoji: '⚔️', ru: ['борьб', 'войн', 'революц'], en: ['struggle', 'war', 'revolution'], weight: 1 },
  { emoji: '⛓️', ru: ['угнет', 'гнёт', 'гнет', 'подавл'], en: ['oppression', 'oppressed', 'suppress'], weight: 2 },
  { emoji: '⚖️', ru: ['класс', 'противореч', 'примирен'], en: ['class', 'antagonism', 'reconciliation'], weight: 1 },
  { emoji: '📜', ru: ['учен', 'сочинен', 'цитат', 'теор'], en: ['teaching', 'writings', 'quotation', 'theory'], weight: 1 },
  { emoji: '🔒', ru: ['заложник'], en: ['hostage', 'hostages'], weight: 2 },
  { emoji: '💭', ru: ['помыс'], en: ['thought'], weight: 2 },
])

/** Every stem/word in the lexicon, indexed for a single pass over a sentence. */
const RU_STEMS = LEXICON.flatMap((entry) => (entry.ru ?? []).map((stem) => ({ stem, entry })))
  .sort((a, b) => b.stem.length - a.stem.length)
const RU_EXACT = new Map()
for (const entry of LEXICON) {
  for (const form of entry.ruExact ?? []) {
    if (!RU_EXACT.has(form)) RU_EXACT.set(form, entry)
  }
}
const EN_WORDS = new Map()
for (const entry of LEXICON) {
  for (const word of entry.en ?? []) {
    if (!EN_WORDS.has(word)) EN_WORDS.set(word, entry)
  }
}

/**
 * The best picture for one sentence, or null when nothing in it earns one.
 *
 * A Russian stem hit is worth more than an English one: the Russian is the text
 * the learner is reading, and the English is a translation that may have chosen
 * a different image. Score carries the entry's weight so a concrete noun wins
 * over the weather it happens to be in.
 *
 * @param {{ru?: string, en?: string}} sentence
 * @returns {{emoji: string, score: number}|null}
 */
export function illustrationFor(sentence) {
  const scores = new Map()
  const add = (entry, points) => scores.set(entry.emoji, (scores.get(entry.emoji) ?? 0) + points)

  for (const raw of String(sentence?.ru ?? '').split(/\s+/)) {
    const token = normToken(raw)
    if (token.length < 3) continue
    const exact = RU_EXACT.get(token)
    if (exact) {
      add(exact, 2 * exact.weight)
      continue
    }
    for (const { stem, entry } of RU_STEMS) {
      if (token.startsWith(stem) && token.length - stem.length <= MAX_ENDING) {
        add(entry, 2 * entry.weight)
        break // longest stem first, so the first hit is the most specific one
      }
    }
  }
  for (const raw of String(sentence?.en ?? '').toLowerCase().split(/[^a-z']+/)) {
    const entry = raw && EN_WORDS.get(raw)
    if (entry) add(entry, entry.weight)
  }

  let best = null
  for (const [emoji, score] of scores) {
    if (!best || score > best.score) best = { emoji, score }
  }
  return best
}

/**
 * Which sentences get a picture, as `sentence id → emoji`.
 *
 * A shipped book returns its authored story beats. An uncurated book falls back
 * to at most one match per window of `every` sentences, so the audit has useful
 * proposals without letting a richly matching passage become a strip cartoon.
 *
 * Never the same picture twice running, even where that costs a window its
 * picture. Half of Lenin's § 1 is about the state, and a column of identical
 * 🏛️ reads as a rendering bug rather than as illustration.
 *
 * @param {{id: string, ru?: string, en?: string}[]} sentences
 * @param {{every?: number}} [options]
 * @returns {Map<string, string>}
 */
export function illustrate(sentences, { every = 5 } = {}) {
  const chosen = new Map()
  const all = sentences ?? []
  const firstId = String(all[0]?.id ?? '')
  const separator = firstId.indexOf(':')
  const bookId = separator < 0 ? '' : firstId.slice(0, separator)
  const featured = FEATURED_MOMENTS[bookId]
  if (featured) {
    for (const sentence of all) {
      const emoji = featured[sentence.id]
      if (emoji) chosen.set(sentence.id, emoji)
    }
    return chosen
  }

  let previous = null
  for (let from = 0; from < all.length; from += every) {
    let best = null
    for (const sentence of all.slice(from, from + every)) {
      const found = illustrationFor(sentence)
      if (!found || found.score < MIN_SCORE || found.emoji === previous) continue
      if (!best || found.score > best.score) best = { id: sentence.id, emoji: found.emoji, score: found.score }
    }
    if (!best) continue
    chosen.set(best.id, best.emoji)
    previous = best.emoji
  }
  return chosen
}
