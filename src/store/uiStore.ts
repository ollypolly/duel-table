// Transient UI state (not persisted): which card the detail panel shows and
// which pile is open.
import { create } from 'zustand'
import type { Iid, ZoneRef } from '../engine'

type UiState = {
  hovered?: Iid
  selected?: Iid
  openPile?: ZoneRef
  hover: (iid?: Iid) => void
  select: (iid?: Iid) => void
  openPileViewer: (ref?: ZoneRef) => void
}

export const useUiStore = create<UiState>()((set) => ({
  hover: (hovered) => set({ hovered }),
  select: (selected) => set({ selected }),
  openPileViewer: (openPile) => set({ openPile }),
}))
