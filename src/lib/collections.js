// Central registry of valid collection names.
//
// Collections are free-form topic tags attached to words (see the `collections:`
// field in the vocab YAML). This module is the single source of truth for which
// names are allowed, so the set stays curated rather than drifting per file.
// The bundled vocab is checked against this list in collections.test.js.

/**
 * Every valid collection name, in (default `Array.prototype.sort`) order.
 * `DIY` is capitalised, so it sorts ahead of the lowercase names.
 */
export const COLLECTIONS = [
  'DIY',
  'abstract',
  'animals',
  'architecture',
  'character',
  'clothes',
  'colours and textures',
  'communication',
  'craft and construction',
  'daily life',
  'directions',
  'faith',
  'family',
  'feelings and sensations',
  'finance',
  'food and drink',
  'geography',
  'history',
  'hobbies and pastimes',
  'holiday',
  'home',
  'in the garden',
  'in the kitchen',
  'life and death',
  'measurement and calculation',
  'military',
  'motion',
  'nationalities',
  'nature',
  'parts of the body',
  'people',
  'places',
  'plants',
  'politics',
  'public transport',
  'reading',
  'restaurants and cafes',
  'romance and dating',
  'school',
  'science',
  'shapes and patterns',
  'shopping',
  'sickness and health',
  'society',
  'sport',
  'technology',
  'the arts',
  'the calendar',
  'the law',
  'time',
  'travel',
  'war and peace',
  'weather',
  'work',
]

/**
 * How many words a collection needs before it can name a batch.
 *
 * A named learning batch must draw `SAME_COLLECTION_RATIO` (0.75) of
 * `LEARNING_BATCH_SIZE` (20) words from one collection — see batches.js — so a
 * tag with fewer than 15 words in the corpus can only ever fall back to
 * "Random". collections.test.js holds every registered name to this bar, which
 * turns "this tag can never name a batch" into a CI failure rather than a
 * silently useless tag. (batches.js is not imported here: this module is
 * loaded by the vocab pipeline, which has no business pulling in the batch
 * engine. The test asserts the two stay in step.)
 */
export const MIN_COLLECTION_WORDS = 15

/** Fast membership lookup for the names above. */
export const COLLECTION_SET = new Set(COLLECTIONS)

/** Is `name` a registered collection? */
export function isCollection(name) {
  return COLLECTION_SET.has(name)
}

/** The subset of `names` that are not in the registry (de-duplicated). */
export function unknownCollections(names) {
  return [...new Set((names ?? []).filter((name) => !COLLECTION_SET.has(name)))]
}
