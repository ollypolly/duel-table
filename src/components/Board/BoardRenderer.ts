// The contract every board renderer implements. Board2D is the only one today;
// a Three.js renderer would take the same props and read the same BoardView.
// Sleeves, deck boxes and playmats come from useCosmeticsStore.
import type { ComponentType } from 'react'
import type { EngineEvent, Iid, ZoneRef } from '../../engine'
import type { BoardView } from '../../view/boardView'
import type { FocusArea } from '../../view/layout'

// A focus area to frame, or 'free' to let the viewer pan and zoom.
export type CameraMode = FocusArea | 'free'

export type BoardRendererProps = {
  view: BoardView
  events: EngineEvent[] // what the last step did, for animations
  selected?: Iid
  // The part of the table to frame. A 2D board pans and zooms; a 3D one
  // would move its camera.
  focus?: CameraMode
  // Px along the left covered by an overlay (the scene panel). The camera
  // frames the rest when there's room.
  insetLeft?: number
  onCameraMove?: () => void // the viewer panned or zoomed by hand
  onCardClick?: (iid: Iid) => void
  onCardHover?: (iid: Iid | undefined) => void
  onZoneClick?: (ref: ZoneRef) => void
}

export type BoardRenderer = ComponentType<BoardRendererProps>
