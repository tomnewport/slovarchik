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
  'animals',
  'architecture',
  'clothes',
  'colours and textures',
  'craft and construction',
  'daily life',
  'faith',
  'family',
  'feelings and sensations',
  'finance',
  'history',
  'hobbies and pastimes',
  'holiday',
  'in the garden',
  'in the kitchen',
  'measurement and calculation',
  'nature',
  'parts of the body',
  'people',
  'places',
  'public transport',
  'reading',
  'restaurants and cafes',
  'romance and dating',
  'school',
  'shapes and patterns',
  'shopping',
  'sickness and health',
  'technology',
  'the arts',
  'the calendar',
  'the law',
  'travel',
  'war and peace',
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
