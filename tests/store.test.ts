import { describe, expect, it, vi } from 'vitest'

describe('persisted store', () => {
  it('reports a failed save and picks up writes from another tab', async () => {
    const data = new Map<string, string>()
    let full = false
    const listeners: ((e: { key: string; newValue: string | null }) => void)[] = []
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { if (full) throw new Error('QuotaExceededError'); data.set(k, v) },
    })
    vi.stubGlobal('window', { addEventListener: (_: string, f: (typeof listeners)[0]) => listeners.push(f) })
    const { persisted } = await import('../src/store/store')
    const s = persisted('t', { n: 0 })
    expect(s.set({ n: 1 })).toBe(true)
    full = true
    expect(s.set({ n: 2 })).toBe(false) // caller can tell the user
    expect(s.get().n).toBe(2) // still in memory for this session
    let seen = 0
    s.subscribe(() => seen++)
    listeners.forEach((f) => f({ key: 'pianoapp.v1.t', newValue: JSON.stringify({ n: 7 }) }))
    expect(s.get().n).toBe(7)
    expect(seen).toBe(1)
    vi.unstubAllGlobals()
  })
})
