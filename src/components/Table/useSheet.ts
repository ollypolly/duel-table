// The scene panel as a bottom sheet on a phone, after workout-app's live
// workout drawer: drag it by its handle and it follows your finger, then snaps
// open or closed by where you let go and how hard you flicked. Only the
// handle starts a drag, so the chat inside still scrolls.
import { animate, useDragControls, useMotionValue, type PanInfo } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'

const SNAP = { type: 'spring', duration: 0.3, bounce: 0 } as const
const FLICK = 500 // px/s: faster than this decides it, wherever it's let go
const GAP = 12 // the sheet's gap above the bottom edge (bottom-3), hidden with it
const CLICK_AFTER_DRAG_MS = 300 // the click that ends a drag, which can come first, isn't a tap

export const sheetOpens = (velocity: number, y: number, closedY: number) =>
  velocity < -FLICK ? true : velocity > FLICK ? false : y < closedY / 2

export function useSheet(open: boolean, setOpen: (open: boolean) => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const y = useMotionValue(0)
  const controls = useDragControls()
  const [height, setHeight] = useState(0)
  const dragging = useRef(false)
  const placed = useRef(false)
  const closedY = enabled ? height + GAP : 0

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // The first time it's measured it jumps into place rather than sliding in.
  useEffect(() => {
    if (!height) return
    const target = open ? 0 : closedY
    if (!placed.current) {
      placed.current = true
      y.jump(target)
      return
    }
    const animation = animate(y, target, SNAP)
    return () => animation.stop()
  }, [open, closedY, height, y])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    setTimeout(() => (dragging.current = false), CLICK_AFTER_DRAG_MS)
    const opens = sheetOpens(info.velocity.y, y.get(), closedY)
    if (opens !== open) setOpen(opens)
    else animate(y, open ? 0 : closedY, { ...SNAP, velocity: info.velocity.y })
  }

  // Grabbing the handle, or empty space in the bar beside it.
  const startDrag = (e: PointerEvent) => {
    if (enabled && !(e.target as Element).closest('button:not([data-sheet-handle]), select, input, a, label')) controls.start(e)
  }

  return {
    ref,
    motionProps: enabled
      ? {
          style: { y },
          drag: 'y' as const,
          dragControls: controls,
          dragListener: false,
          dragConstraints: { top: 0, bottom: closedY },
          dragElastic: { top: 0, bottom: 0.1 },
          dragMomentum: false,
          onDragStart: () => (dragging.current = true),
          onDragEnd,
        }
      : { style: { y } },
    startDrag,
    toggle: () => {
      if (!dragging.current) setOpen(!open)
    },
  }
}
