import { expect, test, type Page } from '@playwright/test'

const press = async (page: Page, code: string, holdMs = 120) => {
  await page.evaluate(([c]) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c })), [code])
  await page.waitForTimeout(holdMs)
  await page.evaluate(([c]) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c })), [code])
}

test('landing page: the demo lesson plays with laptop keys, with no setup', async ({ page }) => {
  await page.goto('/welcome/')
  await page.getByRole('button', { name: /Play the 30-second demo/ }).click()
  await page.getByRole('button', { name: /Start in Wait mode/ }).click()
  await expect(page.locator('.hud .pill')).toHaveText('Play the highlighted keys', { timeout: 10_000 })
  for (const k of 'D S A D S A A A A A S S S S D S A'.split(' ')) { await press(page, `Key${k}`); await page.waitForTimeout(80) }
  const dialog = page.getByRole('dialog', { name: 'Results' })
  await expect(dialog).toBeVisible({ timeout: 25_000 })
  await expect(dialog).toContainText('Every note was correct (17/17)')
  // The page scrolls like a normal page (the app's shell blocks scrolling).
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('auto')
})
