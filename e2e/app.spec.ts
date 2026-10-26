import { expect, test, type Page } from '@playwright/test'

const press = async (page: Page, code: string, holdMs = 120) => {
  await page.evaluate(([c]) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c })), [code])
  await page.waitForTimeout(holdMs)
  await page.evaluate(([c]) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c })), [code])
}

async function skipSetup(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /don't have a keyboard/ }).click()
  await page.getByRole('button', { name: 'I hear it' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
}

test('first-run setup leads to a first lesson that can be completed in Wait mode', async ({ page }) => {
  await skipSetup(page)
  await page.getByRole('button', { name: 'Start my first lesson' }).click()
  await page.getByRole('button', { name: /Start in Wait mode/ }).click()
  await expect(page.locator('.hud .pill')).toHaveText('Play the highlighted keys', { timeout: 5000 })
  // Hot Cross Buns: E D C | E D C | C C C C D D D D | E D C   (A = C4, S = D4, D = E4)
  for (const k of 'D S A D S A A A A A S S S S D S A'.split(' ')) { await press(page, `Key${k}`); await page.waitForTimeout(80) }
  const dialog = page.getByRole('dialog', { name: 'Results' })
  await expect(dialog).toBeVisible({ timeout: 25_000 })
  await expect(dialog).toContainText('Every note was correct (17/17)')
  await expect(dialog).toContainText('Notes learned')
  // Progress is saved and survives a reload.
  await page.reload()
  await expect(page.getByText('Best 100%')).toBeVisible()
})

test('UI stays responsive while notes are falling', async ({ page }) => {
  await skipSetup(page)
  await page.getByRole('button', { name: 'Look around first' }).click()
  await page.getByRole('button', { name: /Continue/ }).click()
  await page.getByRole('button', { name: 'Watch it first' }).click()
  const frames = await page.evaluate(() => new Promise<number[]>((res) => {
    const t: number[] = []
    const f = (now: number) => { t.push(now); if (t.length < 180) requestAnimationFrame(f); else res(t) }
    requestAnimationFrame(f)
  }))
  const gaps = frames.slice(1).map((v, i) => v - frames[i]).sort((a, b) => a - b)
  const p95 = gaps[Math.floor(gaps.length * 0.95)]
  expect(p95).toBeLessThan(40) // 60 fps target; 40 ms leaves room for a busy CI machine
})

test('create: record, save, reload and the composition is still there', async ({ page }) => {
  await skipSetup(page)
  await page.getByRole('button', { name: 'Look around first' }).click()
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('button', { name: /Record/ }).click()
  await page.waitForTimeout(60_000 / 90 * 4 + 100) // count-in
  for (const k of ['KeyA', 'KeyD', 'KeyG', 'KeyK']) { await press(page, k, 300); await page.waitForTimeout(300) }
  await page.getByRole('button', { name: /Stop recording/ }).click()
  await expect(page.locator('.roll-note')).toHaveCount(4)
  await page.getByRole('textbox', { name: 'Composition name' }).fill('E2E idea')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('textbox', { name: 'Composition name' })).toHaveValue('E2E idea')
  await expect(page.locator('.roll-note')).toHaveCount(4)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export .mid' }).click()
  expect((await download).suggestedFilename()).toBe('E2E idea.mid')
})

test('create: a take in progress survives leaving the page', async ({ page }) => {
  await skipSetup(page)
  await page.getByRole('button', { name: 'Look around first' }).click()
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('button', { name: 'New' }).click()
  await page.getByRole('button', { name: /Record/ }).click()
  await page.waitForTimeout(60_000 / 90 * 4 + 100)
  for (const k of ['KeyA', 'KeyS', 'KeyD']) { await press(page, k, 250); await page.waitForTimeout(250) }
  await page.getByRole('button', { name: 'Learn' }).click() // leave mid-recording
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.locator('.roll-note')).toHaveCount(3)
  await expect(page.getByText('unsaved')).toBeVisible()
})
