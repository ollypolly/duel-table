// Pure lookup over the card JSON. Callers pass the data in (the browser imports
// data/cards.json, the server reads it from disk) so this runs anywhere.

export type CardData = {
  id: number // passcode
  name: string
  type: string // e.g. "Effect Monster", "Spell Card" (Spell/Trap subtype lives in race)
  frameType: string // normal | effect | fusion | xyz | link | spell | trap | ...
  desc: string
  atk?: number
  def?: number
  level?: number
  rank?: number
  linkval?: number
  attribute?: string
  race: string // monster type, or spell/trap subtype
  archetype?: string
}

export type CardDbFile = { dbVersion: string; cards: CardData[] }

export type CardDb = {
  byId(id: number): CardData | undefined
  byName(name: string): CardData | undefined
  closeMatches(name: string, limit?: number): string[]
  all(): readonly CardData[]
}

export const imagePath = (id: number, size: 'full' | 'small' = 'small') =>
  size === 'small' ? `/cards/small/${id}.jpg` : `/cards/${id}.jpg`

export const isExtraDeckCard = (c: CardData) => /fusion|synchro|xyz|link/.test(c.frameType)
export const isMonster = (c: CardData) => c.type.includes('Monster')

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}

export function createCardDb(file: CardDbFile): CardDb {
  const ids = new Map(file.cards.map((c) => [c.id, c]))
  const names = new Map(file.cards.map((c) => [normalise(c.name), c]))
  return {
    byId: (id) => ids.get(id),
    // Case and punctuation insensitive, so "ash blossom & joyous spring" works.
    byName: (name) => names.get(normalise(name)),
    closeMatches(name, limit = 3) {
      const n = normalise(name)
      return file.cards
        .map((c) => {
          const cn = normalise(c.name)
          const score = cn.includes(n) || n.includes(cn) ? 0 : levenshtein(n, cn)
          return { name: c.name, score }
        })
        .filter((x) => x.score <= Math.max(3, n.length / 3))
        .sort((a, b) => a.score - b.score)
        .slice(0, limit)
        .map((x) => x.name)
    },
    all: () => file.cards,
  }
}
