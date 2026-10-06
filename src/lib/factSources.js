// The sourcing rule for word facts: every authored `facts:` entry is backed by
// a dictionary, line by line, and someone other than its author has checked
// the citations. The evidence lives in review/facts-sources.jsonl — one line
// per fact, each claim the fact makes paired with the source that says so and
// the passage it says it in — so a fact can always be traced back to where it
// came from, and a fact written from memory has nowhere to hide.
//
// Facts written before the ledger existed are listed in
// review/facts-unsourced-baseline.json by fingerprint. That list is a ratchet:
// it may shrink (a legacy fact sourced, rewritten or removed) but nothing new
// may join it, so every fact added from here on arrives with its sources.
//
// Pure: the caller reads the files and hands over the parsed records.

/**
 * FNV-1a over the UTF-16 code units, as 8 hex digits. Not cryptographic — it
 * only has to notice that a fact's wording changed.
 *
 * @param {string} s
 * @returns {string}
 */
function fnv1a(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * The baseline's name for a fact: the word, the kind, and a hash of the
 * wording, so editing a legacy fact takes it off the baseline as surely as
 * deleting it does.
 *
 * @param {string} key the word's natural key
 * @param {{kind: string, text: string}} fact
 * @returns {string}
 */
export function factFingerprint(key, fact) {
  return `${key}|${fact.kind}|${fnv1a(fact.text)}`
}

/** Do a fact's chips match the ledger's, piece for piece? */
function sameParts(fact, rec) {
  const a = (fact.parts ?? []).map((p) => `${p.ru}\u0000${p.en}`)
  const b = (rec.parts ?? []).map((p) => `${p?.ru}\u0000${p?.en}`)
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/** Do a fact's `see:` links match the ledger's? */
function sameSee(fact, rec) {
  const a = fact.seeKeys ?? []
  const b = rec.see ?? []
  return a.length === b.length && a.every((x, i) => x === b[i])
}

const filled = (v) => typeof v === 'string' && v.trim() !== ''

/**
 * What is wrong with one ledger line on its own: a claim with no source, a
 * source with no passage, a review that has not happened.
 *
 * @param {PlainObject} rec
 * @returns {string[]}
 */
function recordProblems(rec) {
  const out = []
  if (!Array.isArray(rec.claims) || rec.claims.length === 0) out.push('cites no claims')
  for (const [i, c] of (Array.isArray(rec.claims) ? rec.claims : []).entries()) {
    if (!filled(c?.claim)) out.push(`claims[${i}] says nothing`)
    if (!Array.isArray(c?.sources) || c.sources.length === 0) out.push(`claims[${i}] has no source`)
    for (const [j, s] of (Array.isArray(c?.sources) ? c.sources : []).entries()) {
      for (const field of ['source', 'url', 'quote']) {
        if (!filled(s?.[field])) out.push(`claims[${i}].sources[${j}] has no ${field}`)
      }
    }
  }
  const r = rec.review ?? {}
  if (r.status !== 'approved') out.push(`review status is "${r.status ?? ''}", not "approved"`)
  else if (!filled(r.by) || !filled(r.date)) out.push('an approved review names who and when')
  return out
}

/**
 * Every way the corpus's facts and the sourcing ledger disagree:
 *
 * - a fact with no ledger line and no baseline entry — unsourced;
 * - a ledger line no fact matches word for word — the fact was edited after
 *   its review (or removed), so the review no longer covers what is shown;
 * - a ledger line whose chips or links differ from the fact's;
 * - a ledger line that is incomplete or not yet approved;
 * - two ledger lines for one fact;
 * - a baseline entry no unsourced fact answers to — prune it, so the ratchet
 *   cannot be spent twice.
 *
 * @param {PlainObject[]} words built word records ({key, facts})
 * @param {PlainObject[]} ledger parsed review/facts-sources.jsonl lines
 * @param {string[]} baseline fingerprints of facts that predate the ledger
 * @returns {Array<{key: string, message: string}>}
 */
export function factSourceIssues(words, ledger, baseline) {
  const issues = []
  const report = (key, message) => issues.push({ key, message })

  const factsByKey = new Map()
  for (const w of words ?? []) {
    if (w.facts?.length) factsByKey.set(w.key, w.facts)
  }

  const covered = new Set() // "key\0index" of facts a ledger line answers for
  for (const rec of ledger ?? []) {
    const key = String(rec?.key ?? '')
    const where = `${key} [${rec?.kind}]`
    for (const p of recordProblems(rec ?? {})) report(key, `ledger line ${where}: ${p}`)
    const facts = factsByKey.get(key) ?? []
    const i = facts.findIndex((f) => f.kind === rec?.kind && f.text === rec?.text)
    if (i === -1) {
      report(key, `ledger line ${where} matches no fact word for word — re-review the fact as it now reads, or drop the line`)
      continue
    }
    const id = `${key}\u0000${i}`
    if (covered.has(id)) report(key, `ledger line ${where} duplicates another line for the same fact`)
    covered.add(id)
    if (!sameParts(facts[i], rec)) report(key, `ledger line ${where}: parts differ from the fact's`)
    if (!sameSee(facts[i], rec)) report(key, `ledger line ${where}: see links differ from the fact's`)
  }

  const allowed = new Set(baseline ?? [])
  const used = new Set()
  for (const [key, facts] of factsByKey) {
    for (const [i, f] of facts.entries()) {
      if (covered.has(`${key}\u0000${i}`)) continue
      const fp = factFingerprint(key, f)
      if (allowed.has(fp)) used.add(fp)
      else report(key, `unsourced ${f.kind} fact — add it to review/facts-sources.jsonl with its sources: "${f.text}"`)
    }
  }
  for (const fp of allowed) {
    if (!used.has(fp)) report(fp.split('|')[0], `baseline entry "${fp}" matches no unsourced fact — remove it`)
  }
  return issues
}
