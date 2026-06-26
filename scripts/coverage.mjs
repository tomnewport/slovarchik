// Coverage maintenance tool for the in-context inflection drill.
//
//   node scripts/coverage.mjs stat                    coverage % per POS
//   node scripts/coverage.mjs dump <pos> <off> <lim>  draft `inflect:` decisions
//                                                     for unannotated words; words
//                                                     needing a hand call are flagged
//                                                     "# MANUAL" with their candidates
//   node scripts/coverage.mjs apply <decisions.jsonl> insert hand-reviewed decisions
//
// `dump` only auto-proposes high-confidence cases (preposition-governed or
// unambiguous oblique forms); everything ambiguous (nom/acc syncretism, animate
// gen/acc, verb-governed obliques) is left for a human. Run from the repo root.
// Coverage helper for hand-authoring context-drill annotations.
//   node _cov.mjs dump <pos> <offset> <limit>   → show unannotated words + candidates
//   node _cov.mjs apply <decisions.jsonl>        → insert hand-authored annotations
//   node _cov.mjs stat                           → coverage tally
import { readFileSync, writeFileSync } from 'node:fs'
import yaml from 'js-yaml'

const strip = (s) => String(s ?? '').normalize('NFC').replace(/́/g, '')
const coreT = (t) => String(t ?? '').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
const norm = (s) => strip(s).toLowerCase()
const CASES = ['nom', 'gen', 'dat', 'acc', 'ins', 'pre']
const NUMS = ['sg', 'pl']
const PERS = ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl']
const FILE = { noun: ['nouns', 'calendar'], verb: ['verbs'], adjective: ['adjectives'], pronoun: ['pronouns'] }

function loadDoc(f) { return yaml.load(readFileSync(`public/vocab/${f}.yml`, 'utf8')).words }
function allWords(pos) {
  const out = []
  for (const f of FILE[pos]) for (const [k, w] of Object.entries(loadDoc(f))) if (w.learn !== false) out.push([f, k, w])
  return out
}
const annotated = (w) => (w.usage ?? []).some((u) => u.inflect)

// slot map for a word: norm(form) -> [slotKey]
function slotMap(pos, w) {
  const m = new Map()
  const add = (slot, f) => { if (!f) return; const k = norm(f); if (!m.has(k)) m.set(k, []); m.get(k).push(slot) }
  if (pos === 'noun') {
    const d = w.declension || {}
    for (const num of NUMS) for (const c of CASES) add(`${num}.${c}`, d[`${num}_${c}`])
  } else if (pos === 'verb') {
    const c = w.conjugation || {}
    for (const p of PERS) { add(`present.${p}`, c.present?.[p]); add(`future.${p}`, c.future?.[p]) }
    for (const k of ['past_m', 'past_f', 'past_n', 'past_pl']) add(k, c[k])
  } else if (pos === 'adjective') {
    const d = w.declension || {}
    for (const g of ['m', 'n', 'f', 'pl']) for (const c of CASES) add(`${g}_${c}`, d[`${g}_${c}`])
  }
  return m
}

// Preposition → the case(s) it governs. Ambiguous spatial prepositions (в/на/за/под)
// govern several; we intersect with the form's actual slots to disambiguate.
const PREP = {
  'без': ['gen'], 'от': ['gen'], 'ото': ['gen'], 'до': ['gen'], 'из': ['gen'], 'у': ['gen'],
  'для': ['gen'], 'около': ['gen'], 'возле': ['gen'], 'против': ['gen'], 'после': ['gen'],
  'кроме': ['gen'], 'вокруг': ['gen'], 'из-за': ['gen'], 'из-под': ['gen'], 'ради': ['gen'], 'мимо': ['gen'],
  'к': ['dat'], 'ко': ['dat'], 'по': ['dat'], 'благодаря': ['dat'], 'согласно': ['dat'],
  'через': ['acc'], 'про': ['acc'], 'сквозь': ['acc'],
  'с': ['ins', 'gen'], 'со': ['ins', 'gen'], 'над': ['ins'], 'перед': ['ins'], 'пе́ред': ['ins'], 'между': ['ins'],
  'о': ['pre'], 'об': ['pre'], 'обо': ['pre'], 'при': ['pre'],
  'в': ['acc', 'pre'], 'во': ['acc', 'pre'], 'на': ['acc', 'pre'],
  'за': ['acc', 'ins'], 'под': ['acc', 'ins'],
}

const ruleFor = (pos, slot) => {
  if (pos === 'verb') return slot.startsWith('past') ? 'verb-past' : slot.startsWith('future') ? 'verb-future' : 'verb-present'
  if (pos === 'noun') { const [n, c] = slot.split('.'); return `noun-${c}-${n}` }
  return 'adj-agreement'
}
function decisionFor(pos, slot, key, ru, token) {
  if (pos === 'verb') {
    const past = slot.startsWith('past')
    return { key, pos, ru, token, tense: past ? 'past' : slot.split('.')[0], person: past ? slot : slot.split('.')[1], rule: ruleFor(pos, slot) }
  }
  const [a, c] = slot.split(pos === 'noun' ? '.' : '_')
  if (pos === 'noun') return { key, pos, ru, token, case: c, number: a, rule: ruleFor(pos, slot) }
  return { key, pos, ru, token, case: c, number: a === 'pl' ? 'pl' : 'sg', gender: a, rule: 'adj-agreement' }
}

// Emit a draft decision per word (cleanest single-slot, non-trivial, non-conditional
// candidate). Words with no clean candidate are flagged MANUAL with their usage so a
// new phrase can be authored or an ambiguous form resolved by hand.
function dump(pos, offset, limit) {
  const words = allWords(pos).filter(([, , w]) => !annotated(w))
  console.error(`# ${pos}: ${words.length} unannotated (showing ${offset}..${offset + limit})`)
  for (const [, key, w] of words.slice(offset, offset + limit)) {
    const m = slotMap(pos, w)
    const infin = pos === 'verb' ? norm(key.split('=')[0]) : null
    let best = null
    const manual = []
    for (const u of w.usage ?? []) {
      const ru = String(u.ru)
      const conditional = /\bбы\b/.test(ru)
      const toks = ru.trim().split(/\s+/)
      const hits = []
      toks.forEach((t, i) => {
        const c = norm(coreT(t))
        if (!c || (infin && c === infin)) return
        if (!m.has(c)) return
        const slots = m.get(c)
        if (pos === 'noun' && slots.length === 1 && slots[0].endsWith('.nom')) return
        hits.push({ token: i + 1, form: coreT(t), slots })
      })
      // Guard: a sentence-initial 2sg/2pl non-past form is almost always an
      // imperative (Извини́те…, Включи́те…), whose form coincides with the
      // conjugation — never a real "you will…". Send those to MANUAL.
      // Resolve a hit to a single slot using context (verbs: single-slot only).
      const resolve = (h) => {
        if (pos !== 'noun') {
          if (h.slots.length !== 1) return null
          const s = h.slots[0]
          if (h.token === 1 && /\.(2sg|2pl)$/.test(s)) return null // imperative
          return s
        }
        const prev = norm(coreT(toks[h.token - 2] ?? ''))
        const prevPrev = norm(coreT(toks[h.token - 3] ?? ''))
        const prepCases = PREP[prev] || PREP[prevPrev] || null
        const nonNom = h.slots.filter((s) => !s.endsWith('.nom'))
        const hasNom = nonNom.length !== h.slots.length
        const caseSet = new Set(nonNom.map((s) => s.split('.')[1]))
        let cands
        if (prepCases) {
          cands = nonNom.filter((s) => prepCases.includes(s.split('.')[1]))
        } else if (!hasNom && caseSet.size === 1) {
          cands = nonNom // unambiguous oblique form (e.g. де́нег → gen) — safe
        } else {
          cands = [] // nom/acc-syncretic or multi-case with no preposition → MANUAL
        }
        // Second-locative: в/на + -у dative-looking form is really prepositional → skip.
        if (['в', 'во', 'на'].includes(prev)) cands = cands.filter((s) => !s.endsWith('.dat'))
        return cands.length === 1 ? cands[0] : null
      }
      const clean = (() => { for (const h of hits) { const s = resolve(h); if (s) return { ...h, slot: s } } return null })()
      if (clean && !best && !conditional) best = { ru, ...clean }
      manual.push(`    "${ru}" => ${hits.map((h) => `t${h.token}=${h.form}[${h.slots.join('|')}]`).join('  ') || '(none)'}`)
    }
    if (best && pos !== 'adjective') {
      console.log(JSON.stringify(decisionFor(pos, best.slot, key, best.ru, best.token)))
    } else {
      console.log(`# MANUAL ${key}`)
      manual.forEach((l) => console.log('#' + l))
    }
  }
}

function stat() {
  for (const pos of ['noun', 'verb', 'adjective']) {
    const ws = allWords(pos)
    const done = ws.filter(([, , w]) => annotated(w)).length
    console.log(`${pos}: ${done}/${ws.length} (${(100 * done / ws.length).toFixed(1)}%)`)
  }
}

// ---- apply hand-authored decisions ----
function inflectVal(a) {
  const p = [`token: ${a.token}`]
  if (a.case) { p.push(`case: ${a.case}`, `number: ${a.number}`); if (a.gender) p.push(`gender: ${a.gender}`) }
  else { p.push(`tense: ${a.tense}`, `person: ${a.person}`) }
  if (a.rule) p.push(`rule: ${a.rule}`)
  return `inflect: { ${p.join(', ')} }`
}
function apply(file) {
  const decisions = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => JSON.parse(l))
  const cache = new Map()
  const lines = (f) => { if (!cache.has(f)) cache.set(f, readFileSync(`public/vocab/${f}.yml`, 'utf8').split('\n')); return cache.get(f) }
  const posFiles = (key, d) => FILE[d.pos] || ['nouns', 'calendar', 'verbs', 'adjectives']
  let ok = 0, bad = 0
  for (const d of decisions) {
    let done = false
    for (const f of posFiles(d.key, d)) {
      const ls = lines(f)
      const start = ls.findIndex((l) => l === `  "${d.key}":`)
      if (start === -1) continue
      let end = ls.length
      for (let i = start + 1; i < ls.length; i++) if (/^  "/.test(ls[i])) { end = i; break }
      if (d.newRu) {
        // insert a new usage item at the top of the usage list
        let uLine = -1
        for (let i = start; i < end; i++) if (/^\s*usage:\s*$/.test(ls[i])) { uLine = i; break }
        if (uLine === -1) { console.error('NO usage: for', d.key); break }
        // indentation of items = usage indent + 2 for '- ', + matching for fields
        const uIndent = ls[uLine].match(/^(\s*)/)[1]
        const itemIndent = uIndent + '  '
        const fieldIndent = itemIndent + '  '
        const block = [
          `${itemIndent}- ru: ${d.newRu}`,
          `${fieldIndent}en_gb: ${d.newEn}`,
          `${fieldIndent}${inflectVal(d)}`,
        ]
        ls.splice(uLine + 1, 0, ...block)
        ok++; done = true; break
      } else {
        let ruLine = -1
        for (let i = start; i < end; i++) {
          const m = ls[i].match(/^\s*-?\s*ru:\s*(.*?)\s*$/)
          if (m && strip(m[1].replace(/^["']|["']$/g, '')) === strip(d.ru)) { ruLine = i; break }
        }
        if (ruLine === -1) continue
        let en = -1
        for (let i = ruLine + 1; i < end; i++) { if (/^\s*en_gb:/.test(ls[i])) { en = i; break } if (/^\s*-\s*ru:/.test(ls[i])) break }
        const anchor = en !== -1 ? en : ruLine
        if (ls.slice(ruLine, anchor + 2).some((l) => /^\s*inflect:/.test(l))) { done = true; break }
        const indent = ls[anchor].match(/^(\s*)/)[1]
        ls.splice(anchor + 1, 0, `${indent}${inflectVal(d)}`)
        ok++; done = true; break
      }
    }
    if (!done) { bad++; console.error('UNMATCHED', JSON.stringify(d)) }
  }
  if (!bad) for (const [f, ls] of cache) writeFileSync(`public/vocab/${f}.yml`, ls.join('\n'))
  console.error(`applied=${ok} bad=${bad}${bad ? ' — NOT WRITTEN' : ''}`)
}

const [mode, a, b, c] = process.argv.slice(2)
if (mode === 'dump') dump(a, Number(b || 0), Number(c || 30))
else if (mode === 'apply') apply(a)
else stat()
