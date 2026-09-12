#!/usr/bin/env node
/**
 * gen-lemma-links.mjs — point each gloss-only stub at the word it is a form of.
 *
 * `glossary.yml` is keyed on **surface forms**, not lemmas: «купи́=buy» is an
 * entry in its own right, and so is «купи́ть=to buy» over in verbs.yml. The two
 * are one word. Nothing in the data said so, which is why phrase alignment saw
 * a contested form and refused to credit either (#706), and why the encounter
 * bars undercounted: `encounteredKeys` skips any token carrying more than one
 * sense, and a stub stacking against its own lemma is exactly that.
 *
 * A `lemma:` link fixes it once per stub rather than once per sentence. This
 * script proposes the links it can prove and, with `--apply`, writes them.
 *
 * A link is only proposed when the stub's surface form sits in **exactly one**
 * curriculum word's paradigm. Where two words could own the form the answer is
 * a genuine ambiguity and belongs to a human, not to a generator — so it is
 * left out and `check:align` reports the sentences that suffer for it.
 *
 * Usage:
 *   node scripts/gen-lemma-links.mjs            # report what it would link
 *   node scripts/gen-lemma-links.mjs --apply    # write them into glossary.yml
 *   node scripts/gen-lemma-links.mjs --json     # machine-readable proposals
 */
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { loadFixtureWords } from '../src/test/fixtures.js'
import { wordForms, normToken, normTokenStress } from '../src/lib/phraseHint.js'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const GLOSSARY = join(repo, 'public', 'vocab', 'glossary.yml')

/**
 * The curriculum words whose paradigm contains this stub's surface form.
 *
 * Stress-exact where the stub is accented and any curriculum word agrees, so
 * «сто́ит»/«стои́т» don't pool: a stub that names one of a heteronym pair must
 * not be linked to the other. Falls back to the stress-blind form otherwise,
 * which is what unaccented single-syllable stubs need.
 */
function owners(stub, bare, stressed) {
  const acc = stub.headword || stub.ru
  const exact = stressed.get(normTokenStress(acc))
  if (exact?.length) return exact
  return bare.get(normToken(stub.ru)) ?? []
}

export function proposeLemmaLinks(words) {
  const byKey = new Map(words.map((w) => [w.key, w]))
  const bare = new Map()
  const stressed = new Map()
  for (const w of words) {
    if (w.learnable === false) continue
    for (const f of wordForms(w, normToken)) {
      if (!bare.has(f)) bare.set(f, [])
      bare.get(f).push(w.key)
    }
    for (const f of wordForms(w, normTokenStress)) {
      if (!stressed.has(f)) stressed.set(f, [])
      stressed.get(f).push(w.key)
    }
  }

  const linked = []
  const contested = []
  const orphan = []
  for (const stub of words) {
    if (stub.learnable !== false) continue
    if (stub.lemma) continue
    // A stub spelled exactly like its supposed owner's dictionary form is not
    // an inflected form of it — it is a homograph. «есть» "there is" is not a
    // form of «есть» "to eat" (historically it is быть's), and linking them
    // would silently credit the wrong lexeme forever. Same-spelling entries are
    // what the `polysemy` rung is for: both glosses stay on show.
    const found = [...new Set(owners(stub, bare, stressed))].filter(
      (k) => normToken(byKey.get(k)?.ru ?? '') !== normToken(stub.ru),
    )
    if (found.length === 1) linked.push({ key: stub.key, lemma: found[0] })
    else if (found.length > 1) contested.push({ key: stub.key, candidates: found })
    else orphan.push({ key: stub.key })
  }
  return { linked, contested, orphan }
}

/**
 * Write `lemma:` into glossary.yml beneath each named entry's key line.
 *
 * Line-edited rather than re-serialised: js-yaml's dump would reflow the whole
 * file — quoting, key order, the header comment — and turn a 400-line change
 * into a 5,000-line one nobody can review. The same reason `sort-vocab.js`
 * exists as its own pass.
 */
export function applyLinks(text, links) {
  const want = new Map(links.map((l) => [l.key, l.lemma]))
  const out = []
  let current = null
  for (const line of text.split('\n')) {
    const k = line.match(/^ {2}"([^"]+)":\s*$/)
    if (k) {
      current = k[1]
      out.push(line)
      continue
    }
    // Insert directly after `learn: false`, which every stub carries and which
    // is the field `lemma:` qualifies: this entry is not taught, it is a form
    // of something that is.
    if (current && /^ {4}learn: false\s*$/.test(line)) {
      out.push(line)
      const lemma = want.get(current)
      if (lemma) out.push(`    lemma: ${JSON.stringify(lemma)}`)
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const { linked, contested, orphan } = proposeLemmaLinks(loadFixtureWords())

  if (args.includes('--json')) {
    console.log(JSON.stringify({ linked, contested, orphan }, null, 2))
  } else {
    console.log(`stubs linkable to one curriculum word: ${linked.length}`)
    console.log(`stubs whose form two words share (left for a human): ${contested.length}`)
    console.log(`stubs no curriculum paradigm covers (a lemma in its own right): ${orphan.length}`)
    for (const c of contested.slice(0, 20)) {
      console.log(`  ? ${c.key.padEnd(28)} ${c.candidates.join(' | ')}`)
    }
    if (contested.length > 20) console.log(`  …and ${contested.length - 20} more`)
  }

  if (args.includes('--apply')) {
    const text = readFileSync(GLOSSARY, 'utf8')
    writeFileSync(GLOSSARY, applyLinks(text, linked))
    console.log(`\nwrote ${linked.length} lemma links into public/vocab/glossary.yml`)
  }
}
