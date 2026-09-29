// Each seat's sleeves, deck box and playmat: images you pick, kept in this
// browser's IndexedDB (too big for localStorage) and served as object URLs.
// They belong to the seat (p1 at the bottom, p2 at the top), not a scenario.
import { create } from 'zustand'
import type { Player } from '../engine'

export const COSMETICS = ['sleeve', 'deckBox', 'playmat'] as const
export type Cosmetic = (typeof COSMETICS)[number]
export type Cosmetics = Record<Player, Partial<Record<Cosmetic, string>>> // object URLs

const DB = 'duel-table'
const STORE = 'cosmetics'
const key = (player: Player, kind: Cosmetic) => `${player}:${kind}`

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
  cosmetics: Cosmetics
  load: () => Promise<void>
  set: (player: Player, kind: Cosmetic, file: Blob | undefined) => Promise<void>
}

export const useCosmeticsStore = create<CosmeticsState>()((set, get) => {
  const put = (player: Player, kind: Cosmetic, blob: Blob | undefined) => {
    const old = get().cosmetics[player][kind]
    if (old) URL.revokeObjectURL(old)
    const c = get().cosmetics
    set({ cosmetics: { ...c, [player]: { ...c[player], [kind]: blob && URL.createObjectURL(blob) } } })
  }
  return {
    cosmetics: { p1: {}, p2: {} },
    load: async () => {
      if (typeof indexedDB === 'undefined') return
      const [keys = [], blobs = []] = await Promise.all([tx('readonly', (s) => s.getAllKeys()), tx('readonly', (s) => s.getAll())])
      keys.forEach((k, i) => {
        const [player, kind] = String(k).split(':') as [Player, Cosmetic]
        put(player, kind, blobs[i] as Blob)
      })
    },
    set: async (player, kind, file) => {
      await tx('readwrite', (s) => (file ? s.put(file, key(player, kind)) : s.delete(key(player, kind))))
      put(player, kind, file)
    },
  }
})
