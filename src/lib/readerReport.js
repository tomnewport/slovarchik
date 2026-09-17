const ISSUE_URL = 'https://github.com/tomnewport/slovarchik/issues/new'

/** Prefill a reviewable GitHub report; the learner still writes their concern. */
export function translationIssueUrl(pack, sentenceId) {
  const index = pack.sentences.findIndex((sentence) => sentence.id === sentenceId)
  if (index < 0) throw new Error('Sentence missing from book')
  const current = pack.sentences[index]
  const before = pack.sentences.slice(Math.max(0, index - 2), index)
  const after = pack.sentences.slice(index + 1, index + 3)
  const contextLine = (sentence) => `- ${sentence.id}: ${sentence.ru}`
  const body = [
    '## Translation question', '',
    `**Book:** ${pack.title} — ${pack.author}`,
    `**Source edition:** ${pack.source.editionId}`,
    `**Russian source:** ${pack.source.url}`,
    `**Sentence ID:** ${current.id}`,
    `**Paragraph:** ${current.paragraph}`,
    `**Pack version:** ${pack.packVersion}`,
    `**Translation version:** ${pack.translationVersion}`, '',
    '**Russian:**', current.ru, '',
    '**Current English:**', current.en, '',
    '**Before:**', ...(before.length ? before.map(contextLine) : ['(start of work)']), '',
    '**After:**', ...(after.length ? after.map(contextLine) : ['(end of work)']), '',
    '## What would you change?', '',
    '<!-- Describe the concern or suggest a rendering. -->',
  ].join('\n')
  const params = new URLSearchParams({ title: `Translation question: ${pack.title} · ${current.id}`, body })
  return `${ISSUE_URL}?${params}`
}
