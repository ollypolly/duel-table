// Seeded RNG whose whole state is { seed, cursor }, so it can live in BoardState
// and replay stays pure: the nth random number is a function of (seed, n).

export type RngState = { seed: number; cursor: number }

function splitmix32(x: number): number {
  let z = (x + 0x9e3779b9) | 0
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
  z ^= z >>> 16
  return (z >>> 0) / 4294967296
}

export function randomAt(rng: RngState): number {
  return splitmix32((rng.seed + Math.imul(rng.cursor, 0x9e3779b9)) | 0)
}

// Fisher-Yates. Returns a new array and the advanced RNG state.
export function shuffle<T>(items: readonly T[], rng: RngState): { items: T[]; rng: RngState } {
  const out = [...items]
  let cursor = rng.cursor
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(randomAt({ seed: rng.seed, cursor: cursor++ }) * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return { items: out, rng: { seed: rng.seed, cursor } }
}
