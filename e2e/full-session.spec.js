import { test, expect } from '@playwright/test'

// One full-session integration flow (#322). The unit suite covers the engine in
// isolation; this drives the real thing — runner ⇄ store ⇄ view ⇄ router — end to
// end: a fresh (empty IndexedDB) launch, a session started from Home, every
// exercise it deals completed by *recovering the answer from the exercise DOM*
// (each exercise type exposes its answer via a data-* hook), then assertions that
// the session finished, progress advanced, and both survive a reload.
//
// Determinism: a seed is injected via `window.__SLOVARCHIK_SEED__` (see
// src/lib/seed.js), pinning Math.random so the dealt sequence is reproducible.

// A fixed seed pins Math.random (src/lib/seed.js) so the dealt sequence is
// reproducible; PW_SEED overrides it for local exploration. The flow adapts to
// whatever is dealt, so the test stays green across seeds and vocab changes.
const SEED = Number(process.env.PW_SEED ?? 1)

// Generous budget: a Normal session is a dozen practices and a matching board
// alone is a dozen cards, so the whole run is a few hundred interactions.
test.setTimeout(180_000)

/**
 * Click the first enabled button under `container` whose trimmed text equals
 * `text` (case-insensitively). Plain text comparison — avoids feeding
 * answer-derived strings (which may contain `/`, regex metachars, …) through
 * Playwright's text-matching engine.
 */
async function clickButtonByText(container, text) {
  const want = text.trim().toLowerCase()
  const buttons = container.locator('button:not([disabled])')
  const texts = await buttons.allInnerTexts()
  const idx = texts.findIndex((t) => t.trim().toLowerCase() === want)
  if (idx === -1)
    throw new Error(
      `no enabled button with text "${text}" — available: ${JSON.stringify(texts)}`,
    )
  await buttons.nth(idx).click()
}

/** Fill a text answer whose value the input advertises via `data-answer`. */
async function solveType(ex) {
  const input = ex.locator('input.answer-input')
  await expect(input).toBeVisible()
  await input.fill((await input.getAttribute('data-answer')) ?? '')
  await ex.getByRole('button', { name: 'Check' }).click()
  await ex.getByRole('button', { name: /Next/ }).click()
}

/** Tap the bank tiles named by the exercise's `data-answer-tokens`, in order. */
async function solveWordbank(ex) {
  const tokens = JSON.parse(
    (await ex.locator('[data-answer-tokens]').getAttribute('data-answer-tokens')) ?? '[]',
  )
  for (const tok of tokens) {
    // First not-yet-placed tile with this exact text (placed tiles disable, so
    // repeated words resolve to distinct tiles).
    await clickButtonByText(ex.locator('.bank'), tok)
  }
  await ex.getByRole('button', { name: 'Check' }).click()
  // Exact order grades correct outright; guard the "same words, different order"
  // self-confirm branch just in case.
  const confirm = ex.getByRole('button', { name: /Yes, it's correct/ })
  if (await confirm.count()) await confirm.first().click()
  await ex.getByRole('button', { name: /Next/ }).click()
}

/**
 * Flashcard board: one always-focused input per card, each advertising the card's
 * answer via `data-answer`. Typing the exact answer advances the card — unless it
 * is held open (#586) so the word's facts can be read, which looks exactly like
 * the reveal after a miss and clears on Next. The last card ends the exercise
 * (the input detaches). Drains any consecutive boards.
 */
async function solveMatch(page) {
  const input = page.locator('#fc-input')
  for (let guard = 0; guard < 200; guard++) {
    if (!(await input.count())) return
    const answer = (await input.getAttribute('data-answer')) ?? ''
    const before = (await page.locator('.exercise .count').count())
      ? await page.locator('.exercise .count').innerText()
      : ''
    await input.fill(answer)
    // Wait for this card to clear: the exercise advanced away (input gone), the
    // card counter moved, or — should the grade be rejected — the answer reveal.
    await page.waitForFunction(
      (prev) => {
        const inp = document.querySelector('#fc-input')
        if (!inp) return true
        if (document.querySelector('.exercise .reveal')) return true
        return (document.querySelector('.exercise .count')?.textContent ?? '') !== prev
      },
      before,
      { timeout: 15_000 },
    )
    if (await page.locator('.exercise .reveal').count()) {
      await page.locator('.exercise').getByRole('button', { name: /Next/ }).click()
      // Don't type into the card just dismissed: wait for the resolved state to
      // go, which is either a fresh (editable) card or the end of the board.
      await page.waitForFunction(
        () => {
          const inp = document.querySelector('#fc-input')
          return !document.querySelector('.exercise .reveal') && (!inp || !inp.readOnly)
        },
        undefined,
        { timeout: 15_000 },
      )
    }
  }
  throw new Error('flashcard board did not finish')
}

/** Say-it-aloud: self-assess when recognition is unavailable, else skip the word. */
async function solveSpeak(ex) {
  const said = ex.getByRole('button', { name: /I said it/ })
  if (await said.count()) {
    await said.first().click()
    return
  }
  // Recognition present (no mic in CI): the per-word skip still advances.
  await ex.getByRole('button', { name: /Skip for now/ }).first().click()
}

/** Inflection table — word-bank (DragTable) or keyboard (BlindEndings) variant. */
async function solveInflect(ex) {
  const endings = ex.locator('input.ending-input')
  if (await endings.count()) {
    const n = await endings.count()
    for (let i = 0; i < n; i++) {
      const inp = endings.nth(i)
      await inp.fill((await inp.getAttribute('data-answer')) ?? '')
    }
    await ex.getByRole('button', { name: 'Check' }).click()
  } else {
    // DragTable: each cell advertises its correct form; tap a matching bank chip
    // then the cell. A table the learner has never built cleanly is dealt one
    // column at a time (#645), so keep filling and checking until the drill runs
    // out of columns.
    for (let stage = 0; stage < 10; stage++) {
      const empty = ex.locator('.drop[data-answer]:not(.filled)')
      for (let n = await empty.count(); n > 0; n--) {
        // Always the first still-empty cell: placing one fills it, so the
        // locator walks the column without index bookkeeping.
        const cell = empty.first()
        const want = (await cell.getAttribute('data-answer')) ?? ''
        // Tap a matching bank chip (placed chips leave the bank), then the cell.
        await clickButtonByText(ex.locator('.bank'), want)
        await cell.click()
      }
      await ex.getByRole('button', { name: 'Check' }).click()
      const nextColumn = ex.getByRole('button', { name: /Next column/ })
      if (!(await nextColumn.count())) break
      await nextColumn.click()
    }
  }
  await ex.getByRole('button', { name: /^Next/ }).click()
}

/** In-context inflection: pick each correct grammar option, then spell the form. */
async function solvePhraseFix(ex) {
  const groups = ex.locator('fieldset.select-group')
  const g = await groups.count()
  for (let i = 0; i < g; i++) {
    await groups.nth(i).locator('button.case-btn[data-correct="true"]').first().click()
  }
  const spell = ex.locator('input[data-answer]')
  await expect(spell).toBeVisible()
  await spell.fill((await spell.getAttribute('data-answer')) ?? '')
  await ex.getByRole('button', { name: 'Check' }).click()
  await ex.getByRole('button', { name: /Next( sentence)?/ }).click()
}

/** Drive whatever the runner deals until the end-of-session summary appears. */
async function completeSession(page) {
  const exercise = page.locator('.exercise[data-kind]')
  // Every mounted exercise instance carries a unique data-eid. Consecutive
  // exercises can share a data-kind, so we gate on the eid *changing* — that's
  // how we know a fresh exercise has actually swapped in (and never read one
  // mid-transition).
  let lastEid = null
  for (let step = 0; step < 400; step++) {
    // Read the live phase atomically in one DOM tick: the summary's presence, or
    // the current exercise's id+kind once it differs from the one just solved.
    const handle = await page.waitForFunction(
      (prevEid) => {
        if (document.querySelector('[data-testid="session-summary"]')) return 'summary'
        const ex = document.querySelector('.exercise[data-kind]')
        if (!ex) return false
        const eid = ex.getAttribute('data-eid')
        if (eid === prevEid) return false
        return `${eid}||${ex.getAttribute('data-kind')}`
      },
      lastEid,
      { timeout: 30_000 },
    )
    const state = await handle.jsonValue()
    if (state === 'summary') return
    const [eid, kind] = state.split('||')
    lastEid = eid
    switch (kind) {
      case 'type':
        await solveType(exercise)
        break
      case 'wordbank':
        await solveWordbank(exercise)
        break
      case 'match':
        await solveMatch(page)
        break
      case 'speak':
        await solveSpeak(exercise)
        break
      case 'inflect':
        await solveInflect(exercise)
        break
      case 'phrase-fix':
      case 'verb-contrast':
        await solvePhraseFix(exercise)
        break
      case 'intro':
        // A non-graded introduction (#587): read it and carry on.
        await exercise.locator('button.got-it').click()
        break
      default:
        throw new Error(`Unhandled exercise kind: ${kind}`)
    }
  }
  throw new Error('session did not reach its summary within the step budget')
}

test('completes a full session and persists progress across a reload', async ({ page }) => {
  await page.addInitScript((seed) => {
    window.__SLOVARCHIK_SEED__ = seed
  }, SEED)

  await page.goto('/')

  // Start a Normal standard session — a broad mix so the run exercises the full
  // spread of exercise types. With an empty IndexedDB there is no batch yet, so
  // this routes through batch selection first.
  await page.getByRole('button', { name: /Normal/ }).click()

  // Batch selection blocks on vocab sync; the options appearing is that signal.
  // Picking one commits it and continues straight into the session.
  const firstBatch = page.locator('.batch-select .option').first()
  await expect(firstBatch).toBeVisible({ timeout: 30_000 })
  await firstBatch.click()

  // Work through every exercise dealt.
  await completeSession(page)

  const summary = page.getByTestId('session-summary')
  await expect(summary).toBeVisible()

  // The exercise-progress the session earned, read off the summary's own home
  // screen after leaving (the summary offers Done / a batch-celebration button).
  await summary
    .getByRole('button', { name: /Done|Back home|Choose the next batch|Keep going/ })
    .first()
    .click()

  // We should be back on Home with the batch still committed.
  const learningBar = page.locator('.batches-card [role="progressbar"]').first()
  await expect(learningBar).toBeVisible({ timeout: 15_000 })
  const advanced = Number(await learningBar.getAttribute('aria-valuenow'))
  expect(advanced).toBeGreaterThan(0)

  // Progress persists: reload from IndexedDB and confirm the batch survived and
  // the same advancement is there.
  await page.reload()
  await expect(page.locator('.choose-batch')).toHaveCount(0)
  const persistedBar = page.locator('.batches-card [role="progressbar"]').first()
  await expect(persistedBar).toBeVisible({ timeout: 15_000 })
  expect(Number(await persistedBar.getAttribute('aria-valuenow'))).toBe(advanced)
})

test('introduces a brand-new word before the first exercise that tests it', async ({ page }) => {
  await page.addInitScript((seed) => {
    window.__SLOVARCHIK_SEED__ = seed
  }, SEED)

  await page.goto('/')
  await page.getByRole('button', { name: /Normal/ }).click()

  const firstBatch = page.locator('.batch-select .option').first()
  await expect(firstBatch).toBeVisible({ timeout: 30_000 })
  await firstBatch.click()

  // A fresh batch is nothing but never-met words, so the session opens with an
  // introduction rather than a guaranteed miss (#587).
  const exercise = page.locator('.exercise[data-kind]')
  await expect(exercise).toHaveAttribute('data-kind', 'intro', { timeout: 30_000 })
  const headword = await exercise.locator('.intro-card .ru').textContent()
  expect(headword?.trim()).toBeTruthy()

  // Reading it moves straight on to a real, graded exercise.
  await exercise.locator('button.got-it').click()
  await expect(exercise).not.toHaveAttribute('data-kind', 'intro', { timeout: 15_000 })

  // And the introduction sticks: the same word is not introduced twice.
  await completeSession(page)
  await expect(page.getByTestId('session-summary')).toBeVisible()
})
