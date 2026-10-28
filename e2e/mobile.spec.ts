import { expect, test } from '@playwright/test'

// A phone-sized touch screen. Headless Edge does not enforce the autoplay rule (audio may start without a gesture),
// so these check the flow and the visible prompt; the real gesture rule is only exercised on a device.
test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true })

test('phone: the first tap turns the sound on', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pianoapp.v1.settings', JSON.stringify({ onboarded: true })))
  await page.goto('/')
  const pill = page.getByText('Click to enable sound')
  const gate = page.getByRole('status').filter({ hasText: /Tap anywhere to turn on sound/ })
  await expect(pill).toBeAttached()
  await expect(gate).toBeVisible() // the sidebar hint is icon-only on a phone, so this label says it
  await page.locator('.lesson-card').first().tap()
  await expect(pill).toHaveCount(0, { timeout: 5000 })
  await expect(gate).toHaveCount(0)
})

test('phone: a start attempt without permission does not block later taps', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pianoapp.v1.settings', JSON.stringify({ onboarded: true })))
  await page.goto('/')
  // On a real phone a touch's press-down is not a gesture that may start audio; an untrusted event stands in for it.
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' })))
  await page.waitForTimeout(300)
  await page.locator('.lesson-card').first().tap()
  await expect(page.getByText('Click to enable sound')).toHaveCount(0, { timeout: 5000 })
})

test('phone: the first touch on a key plays it (the sound prompt lets touches through)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pianoapp.v1.settings', JSON.stringify({ onboarded: true })))
  await page.goto('/')
  const gate = page.getByRole('status').filter({ hasText: /Tap anywhere to turn on sound/ })
  await expect(gate).toBeVisible()
  const box = (await gate.boundingBox())!
  // The prompt sits over the bottom of the screen, where the drawn keys are: a touch there must reach what is below.
  const below = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.sound-gate') === null, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
  expect(below).toBe(true)
})
