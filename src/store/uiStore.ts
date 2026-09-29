// Transient UI state (not persisted): which card is hovered or selected (and
// where it is on screen, for the detail popover) and which pile is open.
import { create } from 'zustand'
import type { ScreenRect } from '../components/Board/BoardRenderer'
import type { Iid, ZoneRef } from '../engine'

type UiState = {
  hovered?: Iid
  hoverAnchor?: ScreenRect
  selected?: Iid // clicked: its popover stays open until dismissed
  selectAnchor?: ScreenRect
  openPile?: ZoneRef
  hover: (iid?: Iid, anchor?: ScreenRect) => void
  select: (iid?: Iid, anchor?: ScreenRect) => void
  openPileViewer: (ref?: ZoneRef) => void
}

export const useUiStore = create<UiState>()((set) => ({
  hover: (hovered, hoverAnchor) => set({ hovered, hoverAnchor }),
  select: (selected, selectAnchor) => set({ selected, selectAnchor }),
  openPileViewer: (openPile) => set({ openPile }),
}))
