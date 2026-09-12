import { test, expect } from '@playwright/test'

// The version check is the one part of this that unit tests cannot prove: it turns
// on the constants compiled into the bundle agreeing with the document the
// server actually hands back. Only a real browser against a real server shows
// that — a stubbed fetch agrees with whatever it was told to say.

test('the Data screen confirms the running build against the served one', async ({ page }) => {
  await page.goto('/#/data')

  await expect(page.getByRole('heading', { name: 'Versions' })).toBeVisible()
  await expect(page.locator('.installed')).toContainText('This app: released')
  await expect(page.locator('.deployed')).toContainText("You're running the version that's deployed")
  await expect(page.locator('.checked')).toContainText('Last checked against the live site')
})

test('a newer deployment is reported, with its release date', async ({ page }) => {
  await page.route('**/version.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ commit: 'deadbee', released: '2099-01-01T00:00:00.000Z' }),
    }),
  )

  await page.goto('/#/data')

  await expect(page.locator('.deployed')).toContainText('A newer version is available')
  await expect(page.locator('.deployed')).toContainText('deadbee')
  await expect(page.getByRole('button', { name: 'Update now' })).toBeVisible()
})

test('an unreachable site reads as a failed check, not as up to date', async ({ page }) => {
  await page.route('**/version.json', (route) => route.abort())

  await page.goto('/#/data')

  await expect(page.locator('.checked')).toContainText("Couldn't reach it just now")
  await expect(page.locator('.deployed')).toContainText('Not yet checked against the live site')
})
