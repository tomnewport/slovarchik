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

test('a newer deployment is reported, with its release date and what it brings', async ({ page }) => {
  await page.route('**/version.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        commit: 'deadbee',
        released: '2099-01-01T00:00:00.000Z',
        notes: [
          { at: '2099-01-01T00:00:00.000Z', text: 'Teach participles and gerunds' },
          { at: '2000-01-01T00:00:00.000Z', text: 'Something this build already has' },
        ],
      }),
    }),
  )

  await page.goto('/#/data')

  await expect(page.locator('.deployed')).toContainText('A newer version is available')
  await expect(page.locator('.deployed')).toContainText('deadbee')
  await expect(page.locator('.whats-new')).toContainText('Teach participles and gerunds')
  // Sliced at this build's release date: a note it already carries is not new.
  await expect(page.locator('.whats-new')).not.toContainText('already has')
  await expect(page.getByRole('button', { name: 'Update now' })).toBeVisible()
})

test('the running version says what is in it, from the build itself', async ({ page }) => {
  await page.goto('/#/data')

  // Collapsed until asked for: what is in the version you already have is the
  // quieter half of the card.
  const notes = page.locator('.own-notes .notes li')
  await expect(notes.first()).toBeHidden()

  await page.locator('.own-notes summary').click()

  // Compiled in, so this survives the site being unreachable; the real commit
  // log is what fills it, so assert the shape rather than any one subject.
  await expect(notes.first()).toBeVisible()
  expect(await notes.count()).toBeGreaterThan(0)
})

test('an unreachable site reads as a failed check, not as up to date', async ({ page }) => {
  await page.route('**/version.json', (route) => route.abort())

  await page.goto('/#/data')

  await expect(page.locator('.checked')).toContainText("Couldn't reach it just now")
  await expect(page.locator('.deployed')).toContainText('Not yet checked against the live site')
})
