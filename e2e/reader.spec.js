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
  await fable.getByRole('button', { name: 'Download' }).click()
  await fable.getByRole('link', { name: 'Read' }).click()

  const text = page.getByRole('article', { name: 'Russian text' })
  const nextSentence = text.locator('.reader-paragraph:not(.reader-verse) .reader-sentence + .reader-sentence').first()
  await expect(nextSentence).toBeVisible()
  expect(await nextSentence.evaluate((node) => parseFloat(getComputedStyle(node).marginInlineStart))).toBeGreaterThan(6)
  expect(await text.locator('.reader-word').count()).toBeGreaterThan(await text.getByRole('button').count())
})
