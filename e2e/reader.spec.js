import { test, expect } from '@playwright/test'

test('reading pages fit after resizing, changing typeface, and revealing a translation', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Literature reader/ }).click()
  const fable = page.locator('.library-book').filter({ hasText: 'Стрекоза и Муравей' })
  await fable.getByRole('button', { name: 'Download' }).click()
  await fable.getByRole('link', { name: 'Read' }).click()

  const text = page.getByRole('article', { name: 'Russian text' })
  await expect(text).toContainText('Попрыгунья Стрекоза')
  expect(await text.locator('.reader-word').count()).toBeGreaterThan(10)
  expect(await text.getByRole('button').count()).toBeLessThan(10)

  async function expectPageFits() {
    await expect.poll(() => text.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1)
    await expect.poll(() => page.evaluate(() => {
      const actual = document.querySelector('article.reader-page')
      const mirror = document.querySelector('.reader-measure')
      return Math.abs(actual.scrollHeight - mirror.scrollHeight)
    })).toBeLessThanOrEqual(1)
  }

  await expectPageFits()
  await page.getByRole('button', { name: /Reveal translation for Попрыгунья Стрекоза/ }).click()
  await expect(text.getByText('The sprightly Dragonfly')).toBeVisible()
  await expectPageFits()
  await page.getByRole('button', { name: 'Sans serif type' }).click()
  await expectPageFits()
  await page.setViewportSize({ width: 393, height: 851 })
  await expectPageFits()
  await page.getByRole('button', { name: 'Serif type', exact: true }).click()
  await expectPageFits()
})
