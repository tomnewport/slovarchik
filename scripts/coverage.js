// scripts/coverage.js — report how many words are tagged to each collection.
import { loadFixtureWords } from '../src/test/fixtures.js'
import { COLLECTIONS, unknownCollections } from '../src/lib/collections.js'

const words = loadFixtureWords()
const counts = Object.fromEntries(COLLECTIONS.map((c) => [c, 0]))
for (const w of words) for (const c of w.collections) if (c in counts) counts[c]++

const rows = COLLECTIONS.map((c) => [c, counts[c]]).sort((a, b) => a[1] - b[1])
for (const [c, n] of rows) console.log(`${String(n).padStart(3)}  ${c}`)

const byPos = {}
for (const w of words) byPos[w.pos] = (byPos[w.pos] || 0) + 1
console.log('\ntotal words:', words.length, JSON.stringify(byPos))
console.log('below 50:', rows.filter(([, n]) => n < 50).length, 'collections')
const unknown = unknownCollections(words.flatMap((w) => w.collections))
if (unknown.length) console.log('UNKNOWN COLLECTIONS:', unknown)
