import { describe, expect, it } from 'vitest'
import { translationIssueUrl } from './readerReport.js'

describe('translation query', () => {
  it('includes exact sentence, neighbors, edition and both data versions', () => {
    const pack = { title: 'The Fable', author: 'Author', source: { editionId: '1910-print', url: 'https://example.org/1910' },
      packVersion: 2, translationVersion: 4,
      sentences: [
        { id: 'f:p1:1', paragraph: 'p1', ru: 'Сначала было тихо.', en: 'At first, it was quiet.' },
        { id: 'f:p1:2', paragraph: 'p1', ru: 'Потом снег.', en: 'Then came snow.' },
        { id: 'f:p2:1', paragraph: 'p2', ru: 'И тишина.', en: 'And silence.' },
      ] }
    const url = new URL(translationIssueUrl(pack, 'f:p1:2'))
    expect(url.hostname).toBe('github.com')
    const body = url.searchParams.get('body')
    for (const part of ['f:p1:2', '1910-print', 'Pack version:** 2', 'Translation version:** 4',
      'Потом снег.', 'Then came snow.', 'Сначала было тихо.', 'И тишина.', 'What would you change?']) {
      expect(body).toContain(part)
    }
  })
})
