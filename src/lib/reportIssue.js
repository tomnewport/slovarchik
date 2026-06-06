// Build a pre-filled GitHub "new issue" URL from exercise context.

const REPO = 'tomnewport/slovarchik'
const BASE_URL = `https://github.com/${REPO}/issues/new`

const KIND_LABELS = {
  type: 'Type (spell)',
  wordbank: 'Word bank (assemble)',
  match: 'Match pairs',
  speak: 'Speak aloud',
  inflect: 'Inflection table',
}

const DIMENSION_LABELS = {
  usage: 'Usage',
  hearing: 'Listening',
  speaking: 'Speaking',
  inflection: 'Inflection',
}

/**
 * @param {object} ctx
 * @param {string} [ctx.ru]          Russian text of current item
 * @param {string} [ctx.en]          English text of current item
 * @param {string} [ctx.kind]        Exercise kind (type/wordbank/match/speak/inflect)
 * @param {string} [ctx.dimension]   Learning dimension
 * @param {string} [ctx.content]     'phrase' | 'word' | undefined
 * @param {string} [ctx.practiceType]  Raw practice type string
 * @param {number|null} [ctx.vocabVersion]   Manifest version number
 * @param {number|null} [ctx.lastSyncedAt]   Epoch ms of last vocab sync
 * @param {string} [ctx.submitted]   Learner's answer when disputing a grading
 *                                   (the "honesty system" mark-as-correct flow)
 * @param {string} [ctx.commitHash]  Git commit hash for reproducibility
 */
export function buildIssueUrl(ctx) {
  const isPhrase = ctx.content === 'phrase' || ctx.kind === 'wordbank'

  const title = isPhrase
    ? `Issue with phrase: ${ctx.ru ?? '(unknown)'}`
    : `Issue with word: ${ctx.ru ?? '(unknown)'}`

  const syncedDate = ctx.lastSyncedAt
    ? new Date(ctx.lastSyncedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    : 'unknown'

  const lines = [
    '## Details',
    '',
    `**Exercise type:** ${KIND_LABELS[ctx.kind] ?? ctx.kind ?? 'unknown'}`,
    `**Dimension:** ${DIMENSION_LABELS[ctx.dimension] ?? ctx.dimension ?? 'unknown'}`,
  ]

  if (isPhrase) {
    lines.push(`**Phrase (Russian):** ${ctx.ru ?? '—'}`)
    lines.push(`**Phrase (English):** ${ctx.en ?? '—'}`)
  } else {
    lines.push(`**Word (Russian):** ${ctx.ru ?? '—'}`)
    lines.push(`**Word (English):** ${ctx.en ?? '—'}`)
  }

  lines.push(`**Vocab version:** ${ctx.vocabVersion ?? 'unknown'}`)
  lines.push(`**Vocab last synced:** ${syncedDate}`)
  lines.push(`**App commit:** ${ctx.commitHash ?? 'unknown'}`)
  lines.push('')
  lines.push('## What seems wrong?')
  lines.push('')
  if (ctx.submitted != null && String(ctx.submitted).trim() !== '') {
    lines.push('My answer was marked incorrect, but I believe it is also a valid translation.')
    lines.push('')
    lines.push(`**My answer:** ${ctx.submitted}`)
    lines.push(`**Expected answer:** ${ctx.en ?? '—'}`)
    lines.push('')
    lines.push('<!-- Add any extra detail here -->')
  } else {
    lines.push('<!-- Please describe the issue here -->')
  }

  const params = new URLSearchParams({ title, body: lines.join('\n') })
  return `${BASE_URL}?${params.toString()}`
}
