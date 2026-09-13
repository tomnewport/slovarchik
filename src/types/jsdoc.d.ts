// The JSDoc vocabulary the `checkJs` probe (#666) needs in order to say what
// the logic layers actually promise.

/**
 * A plain record whose fields this probe deliberately does not check.
 *
 * Most of `src/lib` passes around records built by `buildWords()` and the
 * paradigm/session assemblers — shapes with dozens of optional fields that grow
 * with the corpus and are described in prose beside each `@param`, not in a
 * type. Those blocks were annotated `{object}`, which TypeScript 5 and earlier
 * quietly treated as `any` in JS files whenever `noImplicitAny` was off. That
 * leniency is gone: TypeScript 7 reads JSDoc `object` as the real non-primitive
 * `object` type, which has no properties at all, so every `word.key` in the
 * layer became an error.
 *
 * `PlainObject` keeps exactly the checking the probe has always done, and names
 * the gap instead of hiding it behind a keyword that now means something else.
 * It is not a licence: a block that CAN state its shape should state it, and
 * narrowing these to real typedefs — starting with the word record — is worth
 * doing as its own change rather than buried in a dependency bump.
 *
 * One spelling stays `{object}` on purpose: the container of a destructured
 * parameter, the `@param {object} opts` that `@param {number} opts.size` hangs
 * off. TypeScript builds that object's type from its children and requires the
 * literal keyword (TS8032), so those blocks were always properly checked and
 * must not be switched over.
 */
type PlainObject = any
