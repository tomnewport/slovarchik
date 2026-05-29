// scripts/sort-vocab.js — reorder the `words:` entries of a vocab YAML file
// alphabetically by Russian headword (ignoring stress marks), preserving the
// header/meta block and the exact text of every entry. Run: node scripts/sort-vocab.js <file...>
import { readFileSync, writeFileSync } from 'node:fs'

const stripStress = (s) => s.normalize('NFC').replace(/[̀́]/g, '')

function sortFile(file) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const wi = lines.findIndex((l) => l.trimEnd() === 'words:')
  if (wi === -1) throw new Error(`no "words:" line in ${file}`)

  const head = lines.slice(0, wi + 1)
  const body = lines.slice(wi + 1)

  const blocks = []
  let cur = null
  for (const line of body) {
    if (/^ {2}"/.test(line)) {
      if (cur) blocks.push(cur)
      cur = [line]
    } else if (cur) {
      cur.push(line)
    }
  }
  if (cur) blocks.push(cur)

  // Drop trailing blank lines inside each block so sorting can't shuffle them.
  for (const b of blocks) while (b.length && b[b.length - 1].trim() === '') b.pop()

  const keyOf = (b) => stripStress((b[0].match(/^ {2}"([^"]*)"/)?.[1] ?? '').split('=')[0])
  blocks.sort((a, b) => keyOf(a).localeCompare(keyOf(b), 'ru'))

  const out = head.join('\n') + '\n' + blocks.map((b) => b.join('\n')).join('\n') + '\n'
  writeFileSync(file, out)
}

for (const file of process.argv.slice(2)) sortFile(file)
