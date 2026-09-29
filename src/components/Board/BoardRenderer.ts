// The contract every board renderer implements. Board2D is the only one today;
// a Three.js renderer would take the same props and read the same BoardView.
import type { ComponentType } from 'react'
import type { EngineEvent, Iid, ZoneRef } from '../../engine'
import type { BoardView } from '../../view/boardView'

export type BoardRendererProps = {
  view: BoardView
  events: EngineEvent[] // what the last step did, for animations
  selected?: Iid
  onCardClick?: (iid: Iid) => void
  onCardHover?: (iid: Iid | undefined) => void
  onZoneClick?: (ref: ZoneRef) => void
}

export type BoardRenderer = ComponentType<BoardRendererProps>
