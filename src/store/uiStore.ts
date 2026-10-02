// Transient UI state (not persisted): the card open in the inspector (from the
// board, or a card name linked in text), the card selected for a free-play
// move, the open pile, and the deck hub (opened from the header, or by a
// deck's name linked in text).
import { create } from 'zustand'
import type { Iid, Player, ZoneRef } from '../engine'

type UiState = {
  inspected?: Iid // open in the inspector until closed
  inspectedCard?: number // a linked card's id, open in its own inspector
  selected?: Iid // free-play: the card the next zone click moves
  openPile?: ZoneRef
  decks?: { deck?: string } // the deck hub is open, on this deck if one was asked for
  openDecks: (deck?: string) => void
  closeDecks: () => void
  openHands: boolean // free play: both hands face-up, for playing both sides
  setOpenHands: (on: boolean) => void
  boxSelect: boolean // free play: a drag on the table draws a selection box
  setBoxSelect: (on: boolean) => void
  multi: Iid[] // the cards box-selected, which move together
  setMulti: (iids: Iid[]) => void
  freeSide: Player // free play: the side the toolbar draws and adds for
  setFreeSide: (p: Player) => void
  inspect: (iid?: Iid) => void
  inspectCard: (id?: number) => void
  select: (iid?: Iid) => void
  openPileViewer: (ref?: ZoneRef) => void
}

// ?decks=<id> opens the hub on that deck.
const linked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('decks')

export const useUiStore = create<UiState>()((set) => ({
  ...(linked !== null && { decks: { deck: linked } }),
  openDecks: (deck) => set({ decks: { deck } }),
  closeDecks: () => set({ decks: undefined }),
  openHands: false,
  // On by default with a mouse or trackpad, where the wheel pans. A finger drags the table instead.
  boxSelect: typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches,
  setBoxSelect: (boxSelect) => set({ boxSelect, multi: [] }),
  multi: [],
  setMulti: (multi) => set({ multi }),
  freeSide: 'p1',
  setFreeSide: (freeSide) => set({ freeSide }),
  setOpenHands: (openHands) => set({ openHands }),
  inspect: (inspected) => set({ inspected }),
  inspectCard: (inspectedCard) => set({ inspectedCard }),
  select: (selected) => set({ selected }),
  openPileViewer: (openPile) => set({ openPile }),
}))
