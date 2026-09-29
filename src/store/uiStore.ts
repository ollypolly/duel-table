// Transient UI state (not persisted): the card open in the inspector, the
// card selected for a free-play move, and the open pile.
import { create } from 'zustand'
import type { Iid, ZoneRef } from '../engine'

type UiState = {
  inspected?: Iid // open in the inspector until closed
  selected?: Iid // free-play: the card the next zone click moves
  openPile?: ZoneRef
  inspect: (iid?: Iid) => void
  select: (iid?: Iid) => void
  openPileViewer: (ref?: ZoneRef) => void
}

export const useUiStore = create<UiState>()((set) => ({
  inspect: (inspected) => set({ inspected }),
  select: (selected) => set({ selected }),
  openPileViewer: (openPile) => set({ openPile }),
}))
