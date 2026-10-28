import { describe, expect, it, vi } from 'vitest'

describe('anonymous usage counts', () => {
  it('sends nothing outside the built site, and remembers a player switching it off', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
    const appended: unknown[] = []
    vi.stubGlobal('document', { createElement: () => ({ dataset: {} }), head: { appendChild: (n: unknown) => appended.push(n) } })
    const { GOATCOUNTER, initStats, setStatsAllowed, statsAllowed, track } = await import('../src/analytics')
    expect(GOATCOUNTER).toBe('mochimidi')
    // Never in development or tests: nothing is loaded or sent here even with the site code set.
    initStats(); track('lesson-started', 'first-tune')
    expect(appended).toEqual([]) // no script loaded, nothing sent
    expect(statsAllowed()).toBe(true)
    setStatsAllowed(false)
    expect(statsAllowed()).toBe(false)
    setStatsAllowed(true)
    expect(statsAllowed()).toBe(true)
    vi.unstubAllGlobals()
  })
})
