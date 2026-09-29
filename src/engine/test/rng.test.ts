import { randomAt, shuffle } from '../rng'

describe('rng', () => {
  it('is a pure function of seed and cursor', () => {
    expect(randomAt({ seed: 1, cursor: 5 })).toBe(randomAt({ seed: 1, cursor: 5 }))
    expect(randomAt({ seed: 1, cursor: 5 })).not.toBe(randomAt({ seed: 1, cursor: 6 }))
    const r = randomAt({ seed: 99, cursor: 0 })
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThan(1)
  })

  it('shuffles reproducibly and advances the cursor', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    const a = shuffle(items, { seed: 3, cursor: 0 })
    const b = shuffle(items, { seed: 3, cursor: 0 })
    expect(a).toEqual(b)
    expect(a.items).not.toEqual(items)
    expect([...a.items].sort((x, y) => x - y)).toEqual(items)
    expect(a.rng.cursor).toBe(19)
    expect(shuffle(items, a.rng).items).not.toEqual(a.items)
  })
})
