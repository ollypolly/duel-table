// Each deck's sleeves (Main and Extra), deck box and playmat: images you pick in
// the deck hub, or a colour for sleeves, kept in this browser's IndexedDB (too
// big for localStorage). Images are served as object URLs, colours as "#rrggbb". The board shows a seat's through SeatDecks, the deck each
// player is using.
import { createContext, useContext } from 'react'
import { create } from 'zustand'
import type { Player } from '../engine'

export const COSMETICS = ['sleeve', 'extraSleeve', 'deckBox', 'playmat'] as const
export type Cosmetic = (typeof COSMETICS)[number]
type ByDeck = Record<string, Partial<Record<Cosmetic, string>>> // deck id → object URL or colour

const DB = 'duel-table'
const STORE = 'cosmetics'
const key = (deck: string, kind: Cosmetic) => `${deck}:${kind}`

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | IDBRequest<undefined>): Promise<T | undefined> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE)
  return new Promise((resolve, reject) => {
    const req = run(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

type CosmeticsState = {
  cosmetics: ByDeck
  // seatDecks: where images saved per seat (before they were per deck) go.
  load: (seatDecks: Partial<Record<Player, string>>) => Promise<void>
  set: (deck: string, kind: Cosmetic, value: Blob | string | undefined) => Promise<void>
}

export const useCosmeticsStore = create<CosmeticsState>()((set, get) => {
  const put = (deck: string, kind: Cosmetic, value: Blob | string | undefined) => {
    const old = get().cosmetics[deck]?.[kind]
    if (old?.startsWith('blob:')) URL.revokeObjectURL(old)
    const c = get().cosmetics
    set({ cosmetics: { ...c, [deck]: { ...c[deck], [kind]: value instanceof Blob ? URL.createObjectURL(value) : value } } })
  }
  return {
    cosmetics: {},
    load: async (seatDecks) => {
      if (typeof indexedDB === 'undefined') return
      const [keys = [], blobs = []] = await Promise.all([tx('readonly', (s) => s.getAllKeys()), tx('readonly', (s) => s.getAll())])
      for (const [i, k] of keys.entries()) {
        let [deck, kind] = String(k).split(':') as [string, Cosmetic]
        const moved = seatDecks[deck as Player]
        if (moved) {
          await tx('readwrite', (s) => s.put(blobs[i], key(moved, kind)))
          await tx('readwrite', (s) => s.delete(k))
          deck = moved
        }
        put(deck, kind, blobs[i] as Blob | string)
      }
    },
    set: async (deck, kind, value) => {
      await tx('readwrite', (s) => (value ? s.put(value, key(deck, kind)) : s.delete(key(deck, kind))))
      put(deck, kind, value)
    },
  }
})

// The deck each seat is playing, for its cosmetics. Set by the Table.
export const SeatDecks = createContext<Partial<Record<Player, string>>>({})

export function useSeatCosmetic(player: Player, kind: Cosmetic): string | undefined {
  const deck = useContext(SeatDecks)[player]
  return useCosmeticsStore((s) => (deck ? s.cosmetics[deck]?.[kind] : undefined))
}

// Extra Deck cards wear the Extra sleeves, or the Main ones when there are none.
export function useSleeve(player: Player, extra: boolean): string | undefined {
  const main = useSeatCosmetic(player, 'sleeve')
  const extraSleeve = useSeatCosmetic(player, 'extraSleeve')
  return (extra && extraSleeve) || main
}
