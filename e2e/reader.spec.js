import { test, expect } from '@playwright/test'

test('swiping reveals a read-aloud action, and reading settings survive a reload', async ({ page }) => {
  await page.addInitScript(() => {
    window.__readerSpoken = []
    window.speechSynthesis.speak = (utterance) => {
      window.__readerSpoken.push({ text: utterance.text, lang: utterance.lang })
    }
    window.speechSynthesis.cancel = () => {}
  })
  await page.goto('/')
  await page.getByRole('button', { name: /Literature reader/ }).click()
  const fable = page.locator('.library-book').filter({ hasText: 'Стрекоза и Муравей' })
  await fable.locator('summary.library-book-summary').click()
  await fable.getByRole('button', { name: 'Download' }).click()
  await fable.getByRole('link', { name: 'Read' }).click()

  const text = page.getByRole('article', { name: 'Russian text' })
  await expect(text).toContainText('Попрыгунья Стрекоза')
  expect(await text.locator('.reader-word').count()).toBeGreaterThan(10)
  expect(await text.getByRole('button').count()).toBeLessThan(10)
  await expect(page.locator('.reader-appearance')).toBeHidden()
  await expect(text.getByRole('button', { name: 'Read Russian sentence aloud' })).toHaveCount(0)

  const nextVerse = text.locator('.reader-verse .reader-sentence + .reader-sentence').first()
  await expect(nextVerse).toBeVisible()
  expect(await nextVerse.evaluate((node) => parseFloat(getComputedStyle(node).marginBlockStart))).toBeGreaterThan(6)

  await page.setViewportSize({ width: 393, height: 600 })
  const progress = page.getByRole('progressbar', { name: 'Book progress' })
  await expect(progress).toHaveAttribute('aria-valuemin', '0')
  await expect(progress).toHaveAttribute('aria-valuemax', '100')
  await expect.poll(() => progress.locator('.reader-progress-current').evaluate((node) => parseFloat(node.style.width))).toBeLessThan(100)
  const firstPageEnd = await progress.locator('.reader-progress-current').evaluate((node) => parseFloat(node.style.width))
  expect(firstPageEnd).toBeGreaterThan(0)
  expect(firstPageEnd).toBeLessThan(100)
  await expect(page.locator('.reader-progress-label')).toContainText('Current page: 0–')
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect.poll(() => progress.locator('.reader-progress-current').evaluate((node) => parseFloat(node.style.left))).toBeCloseTo(firstPageEnd, 4)
  await expect.poll(() => progress.locator('.reader-progress-current').evaluate((node) => parseFloat(node.style.width))).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Previous page' }).click()
  await expect.poll(() => progress.locator('.reader-progress-current').evaluate((node) => parseFloat(node.style.left))).toBe(0)

  async function expectPageFits() {
    await expect.poll(() => text.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1)
    await expect.poll(() => page.evaluate(() => {
      const actual = document.querySelector('article.reader-page')
      const mirror = document.querySelector('.reader-measure')
      return Math.abs(actual.scrollHeight - mirror.scrollHeight)
    })).toBeLessThanOrEqual(1)
  }

  await expectPageFits()
  const firstSentence = text.locator('.reader-sentence').first()
  await firstSentence.dispatchEvent('pointerdown', { clientX: 160, clientY: 40 })
  await firstSentence.dispatchEvent('pointerup', { clientX: 60, clientY: 40 })
  await expect(text.getByText('The sprightly Dragonfly')).toBeVisible()
  await text.getByRole('button', { name: 'Read Russian sentence aloud' }).click()
  const spoken = await page.evaluate(() => window.__readerSpoken)
  expect(spoken).toHaveLength(1)
  expect(spoken[0].lang).toBe('ru-RU')
  expect(spoken[0].text).toContain('Попрыгунья Стрекоза')
  await expectPageFits()

  await page.getByRole('button', { name: 'Reading settings' }).click()
  await expect(page.locator('.reader-appearance')).toBeVisible()
  await page.getByRole('button', { name: 'Sans serif type' }).click()
  await expectPageFits()
  const normalSize = await text.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))
  await page.getByRole('button', { name: 'Increase font size' }).click()
  await expect(page.locator('.reader-size-label')).toHaveText('Large')
  expect(await text.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThan(normalSize)
  await expectPageFits()
  await page.setViewportSize({ width: 393, height: 851 })
  await expectPageFits()
  await page.getByRole('button', { name: 'Serif type', exact: true }).click()
  await page.getByRole('button', { name: 'Light mode' }).click()
  await expectPageFits()
  await page.keyboard.press('Escape')
  await expect(page.locator('.reader-appearance')).toBeHidden()

  await page.reload()
  await expect(text).toContainText('Попрыгунья Стрекоза')
  await expect(page.locator('.reader')).toHaveClass(/reader-light/)
  await expect(page.locator('.reader')).toHaveClass(/reader-serif/)
  await page.getByRole('button', { name: 'Reading settings' }).click()
  await expect(page.locator('.reader-size-label')).toHaveText('Large')
  await expectPageFits()
})

test('prose sentences have a visible gap without adding word buttons', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Literature reader/ }).click()
  const fable = page.locator('.library-book').filter({ hasText: 'Муравей и голубка' })
  await fable.locator('summary.library-book-summary').click()
  await fable.getByRole('button', { name: 'Download' }).click()
  await fable.getByRole('link', { name: 'Read' }).click()

  const text = page.getByRole('article', { name: 'Russian text' })
  const nextSentence = text.locator('.reader-paragraph:not(.reader-verse) .reader-sentence + .reader-sentence').first()
  await expect(nextSentence).toBeVisible()
  expect(await nextSentence.evaluate((node) => parseFloat(getComputedStyle(node).marginInlineStart))).toBeGreaterThan(6)
  expect(await text.locator('.reader-word').count()).toBeGreaterThan(await text.getByRole('button').count())
})

test('the book accordion fits a phone and Read looks like an action', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/')
  await page.getByRole('button', { name: /Literature reader/ }).click()
  const books = page.locator('.library-book')
  await expect(books).toHaveCount(4)
  await expect(page.locator('.library-book[open]')).toHaveCount(0)

  const first = books.filter({ hasText: 'Муравей и голубка' })
  await first.locator('summary.library-book-summary').click()
  await expect(first).toHaveAttribute('open', '')
  await expect(first.getByRole('button', { name: 'Download' })).toBeVisible()
  await first.getByRole('button', { name: 'Download' }).click()
  const read = first.getByRole('link', { name: 'Read' })
  await expect(read).toBeVisible()
  expect(await read.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(79, 125, 255)')

  const second = books.filter({ hasText: 'Косточка' })
  await second.locator('summary.library-book-summary').click()
  await expect(first).not.toHaveAttribute('open', '')
  await expect(second).toHaveAttribute('open', '')
  await second.getByText('Source and rights').click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

test('the complete Chekhov story downloads, paginates and retains its bookmark and position', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 620 })
  await page.goto('/')
  await page.getByRole('button', { name: /Literature reader/ }).click()
  const story = page.locator('.library-book').filter({ hasText: 'Толстый и тонкий' })
  await expect(story).toBeVisible()
  await story.locator('summary.library-book-summary').click()
  await expect(story.getByText('Антон Чехов')).toBeVisible()
  await story.getByRole('button', { name: 'Download' }).click()
  await story.getByRole('link', { name: 'Read' }).click()

  const text = page.getByRole('article', { name: 'Russian text' })
  await expect(text).toContainText('На вокзале Николаевской железной дороги')
  await text.getByRole('button', { name: /Reveal translation for На вокзале/ }).click()
  await expect(text.getByText('At the Nikolaevsky Railway station', { exact: false })).toBeVisible()
  await text.getByRole('button', { name: 'Bookmark' }).click()
  await expect(page.locator('.reader-saved')).toContainText('1')

  const next = page.getByRole('button', { name: 'Next page' })
  const currentPage = page.locator('.reader-progress-current')
  let pages = 0
  while (await next.isEnabled() && pages < 80) {
    const previousRange = await currentPage.getAttribute('style')
    await next.click()
    await expect(currentPage).not.toHaveAttribute('style', previousRange)
    pages++
  }
  expect(pages).toBeGreaterThan(1)
  await expect(next).toBeDisabled()
  await expect(text).toContainText('Все трое были приятно ошеломлены.')
  await expect(page.getByRole('progressbar', { name: 'Book progress' })).toHaveAttribute('aria-valuenow', '100')

  await page.reload()
  await expect(text).toContainText('Все трое были приятно ошеломлены.')
  await page.locator('.reader-saved').click()
  await page.locator('.reader-bookmarks').getByRole('button', { name: /На вокзале Николаевской/ }).click()
  await expect(text).toContainText('На вокзале Николаевской железной дороги')
})
