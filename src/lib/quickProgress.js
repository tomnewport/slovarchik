// The quick progression route (#725) — how a session notices that a learner
// already knows a word, and what it takes for the app to believe them.
//
// The old route was a button: "I know this word", pressed mid-exercise, on the
// learner's word alone. This replaces it with evidence. A learner who answers
// every exercise a word gets in a session *flawlessly* — right the first time,
// with no hint and no do-over — is asked, once, after the word's last exercise,
// whether they want it counted as learned (or mastered) there and then.
//
// Saying no costs nothing: the word keeps its place in the batch, and the
// flawless work still counts double, as it always has. Saying yes hands the
// word the relaxed single-answer criteria (lib/progression.js's
// KNOWN_CRITERIA), which is exactly what the old button did — so the promotion
// is fragile by construction: every dimension's window is one attempt long, so
// the next wrong answer drops the word straight back out of `learned`.
//
// Pure and framework-free: no Vue, no store, no I/O.

/**
 * Was this exercise result flawless *for one target word*: right the first
 * time, with no hint and no do-over?
 *
 * Three signals, in the order the exercises report them:
 *
 *   * `wrong` — a board that grades several words at once names the ones it
 *     missed. A word that isn't in the list was answered right.
 *   * `flawless: false` — an exercise that can be helped (the keyboard hint, an
 *     unlocked retry) says so explicitly, because "correct" alone cannot tell a
 *     word the learner knew from one the keyboard spelled for them.
 *   * `correctedOnRetry` — the first attempt missed and a built-in retry fixed
 *     it. That is the do-over the offer is meant to exclude.
 *
 * An exercise that reports none of them (nothing to hint, nothing to retry) is
 * flawless exactly when it was correct.
 *
 * @param {{correct?: boolean, wrong?: string[], flawless?: boolean,
 *   correctedOnRetry?: boolean}} result what the exercise component reported
 * @param {string} key the target word being asked about
 */
export function resultFlawless(result, key) {
  if (!result) return false
  if (result.flawless === false) return false
  if (result.correctedOnRetry) return false
  if (Array.isArray(result.wrong)) return !result.wrong.includes(key)
  return result.correct === true
}

/**
 * Fold one exercise result into the session's per-word flawless ledger.
 *
 * The ledger is sticky downwards: a word is flawless while every exercise it
 * has had this session was flawless, and one blemish settles it for good — a
 * later clean answer to the same word cannot wash out the earlier miss, or the
 * offer would appear precisely for the words that needed the drilling.
 *
 * @param {Map<string, boolean>} ledger word key → still flawless
 * @param {string[]} targets the exercise's target words
 * @param {PlainObject} result what the exercise component reported
 * @returns {Map<string, boolean>} the same (mutated) ledger
 */
export function trackFlawless(ledger, targets, result) {
  for (const key of (targets ?? []).filter(Boolean)) {
    ledger.set(key, (ledger.get(key) ?? true) && resultFlawless(result, key))
  }
  return ledger
}

/**
 * The words whose session is over and whose every exercise was flawless — the
 * candidates for the offer, in the order they were first drilled.
 *
 * "Over" is the caller's to decide: `remaining` is the set of words the session
 * still has exercises queued for, including the repeat round, so a word that
 * will come back is not offered early. `skip` holds the words already settled
 * (offered, declined, or already known), so the prompt appears once per word.
 *
 * @param {Map<string, boolean>} ledger the flawless ledger
 * @param {{remaining: Set<string>, skip?: Set<string>}} opts
 * @returns {string[]} candidate word keys
 */
export function flawlessFinished(ledger, { remaining, skip = new Set() }) {
  const out = []
  for (const [key, flawless] of ledger) {
    if (!flawless || remaining.has(key) || skip.has(key)) continue
    out.push(key)
  }
  return out
}
