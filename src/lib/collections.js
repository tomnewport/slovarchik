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
  'actions',
  'agriculture',
  'animals',
  'architecture',
  'authority',
  'birds',
  'body',
  'character',
  'clothes',
  'clothing',
  'colours and textures',
  'communication',
  'conflict',
  'craft and construction',
  'daily life',
  'death',
  'directions',
  'emotions',
  'entertainment',
  'faith',
  'family',
  'feelings',
  'feelings and sensations',
  'finance',
  'flowers',
  'food and drink',
  'funeral',
  'geography',
  'geopolitics',
  'health',
  'history',
  'hobbies and pastimes',
  'holiday',
  'home',
  'in the garden',
  'in the kitchen',
  'language',
  'life and death',
  'materials',
  'measurement and calculation',
  'media',
  'military',
  'mind',
  'minerals',
  'motion',
  'movement',
  'names',
  'nationalities',
  'nature',
  'nautical',
  'numbers',
  'parts of the body',
  'people',
  'places',
  'plants',
  'politics',
  'public transport',
  'reading',
  'religion',
  'restaurants and cafes',
  'romance and dating',
  'safety',
  'school',
  'science',
  'seasons',
  'senses',
  'shapes and patterns',
  'shopping',
  'sickness and health',
  'society',
  'sport',
  'structure',
  'study',
  'technology',
  'the arts',
  'the calendar',
  'the law',
  'time',
  'time of day',
  'town',
  'travel',
  'trees',
  'values',
  'war and peace',
  'weapons',
  'weather',
  'work',
]

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
