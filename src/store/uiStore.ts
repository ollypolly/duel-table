// Transient UI state (not persisted): the card open in the inspector (from the
// board, or a card name linked in text), the card selected for a free-play
// move, and the open pile.
import { create } from 'zustand'
import type { Iid, Player, ZoneRef } from '../engine'

type UiState = {
  inspected?: Iid // open in the inspector until closed
  inspectedCard?: number // a linked card's id, open in its own inspector
  selected?: Iid // free-play: the card the next zone click moves
  openPile?: ZoneRef
  openHands: boolean // free play: both hands face-up, for playing both sides
  setOpenHands: (on: boolean) => void
  freeSide: Player // free play: the side the toolbar draws and adds for
  setFreeSide: (p: Player) => void
  inspect: (iid?: Iid) => void
  inspectCard: (id?: number) => void
  select: (iid?: Iid) => void
  openPileViewer: (ref?: ZoneRef) => void
}

export const useUiStore = create<UiState>()((set) => ({
  openHands: false,
  freeSide: 'p1',
  setFreeSide: (freeSide) => set({ freeSide }),
  setOpenHands: (openHands) => set({ openHands }),
  inspect: (inspected) => set({ inspected }),
  inspectCard: (inspectedCard) => set({ inspectedCard }),
  select: (selected) => set({ selected }),
  openPileViewer: (openPile) => set({ openPile }),
}))
