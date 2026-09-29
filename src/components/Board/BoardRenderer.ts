// The contract every board renderer implements. Board2D is the only one today;
// a Three.js renderer would take the same props and read the same BoardView.
import type { ComponentType } from 'react'
import type { EngineEvent, Iid, ZoneRef } from '../../engine'
import type { BoardView } from '../../view/boardView'

// Where a card is on screen (viewport px), so DOM panels can sit beside it.
// A 3D renderer would project the card's bounds.
export type ScreenRect = { left: number; top: number; right: number; bottom: number }

export type BoardRendererProps = {
  view: BoardView
  events: EngineEvent[] // what the last step did, for animations
  selected?: Iid
  onCardClick?: (iid: Iid, anchor?: ScreenRect) => void
  onCardHover?: (iid: Iid | undefined, anchor?: ScreenRect) => void
  onZoneClick?: (ref: ZoneRef) => void
}

export type BoardRenderer = ComponentType<BoardRendererProps>
