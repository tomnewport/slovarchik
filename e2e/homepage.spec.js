import { test, expect } from '@playwright/test'

test('homepage renders key sections', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle(/Slovarchik/)

  // Learning batch card (always shown; no batch selected by default)
  await expect(page.getByText('Learning')).toBeVisible()
  await expect(page.getByText('Choose words to learn →')).toBeVisible()

  // Standard practice section
  await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Quick/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Normal/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Super/ })).toBeVisible()

  // Focused session buttons
  await expect(page.getByRole('button', { name: /Speaking/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Listening/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Words/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Phrases/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Grammar/ })).toBeVisible()
})
