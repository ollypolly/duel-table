// The 2D board's camera: pans and zooms the world to frame a focus area, or,
// in free mode, lets you drag to pan and wheel/pinch to zoom. Offsets are px
// with the world's transform origin at its top-left.
import { animate, useMotionValue } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { BOUNDS, focusRegion, type FocusArea } from '../../view/layout'
import type { CameraMode } from './BoardRenderer'

const MAX_FOCUS_ZOOM = 2.2
// A focused view may crop the table's sides by this much, so narrow (phone)
// screens can still zoom in on one player's half.
const MAX_SIDE_CROP = 0.35
const FREE_ZOOM = { min: 0.5, max: 5 }
const DRAG_THRESHOLD = 4 // px before a press becomes a drag rather than a click
const SPRING = { type: 'spring', stiffness: 90, damping: 20 } as const

type Size = { w: number; h: number }

function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<Size>()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

// Scale and offset that frame a focus area in a viewport of this size.
function frame(size: Size, worldW: number, focus: FocusArea) {
  const unit = worldW / BOUNDS.width
  const r = focusRegion(focus)
  const fitW = size.w / (r.width * unit)
  const scale = Math.min(MAX_FOCUS_ZOOM, focus === 'all' ? fitW : fitW / (1 - MAX_SIDE_CROP), size.h / (r.height * unit))
  const cx = (r.minX + r.width / 2 - BOUNDS.minX) * unit
  const cy = (r.minY + r.height / 2 - BOUNDS.minY) * unit
  return { scale, x: size.w / 2 - scale * cx, y: size.h / 2 - scale * cy }
}

export function useBoardCamera(ref: RefObject<HTMLElement | null>, mode: CameraMode) {
  const size = useSize(ref)
  const worldW = size && Math.min(size.w, (size.h * BOUNDS.width) / BOUNDS.height)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const scale = useMotionValue(1)
  const placed = useRef(false)

  const goTo = (target: { x: number; y: number; scale: number }, instant: boolean) => {
    for (const [mv, v] of [
      [x, target.x],
      [y, target.y],
      [scale, target.scale],
    ] as const) {
      if (instant) mv.jump(v)
      else animate(mv, v, SPRING)
    }
  }

  // Follow the focus. The first placement jumps rather than easing in; free
  // mode leaves the camera wherever it was.
  const target = size && worldW && mode !== 'free' ? frame(size, worldW, mode) : undefined
  useEffect(() => {
    if (!target) return
    goTo(target, !placed.current)
    placed.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.x, target?.y, target?.scale])

  // Free mode: drag to pan, wheel or pinch to zoom around the pointer.
  const free = mode === 'free'
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const dragged = useRef(false)
  const pinch = useRef<number>(undefined)

  const zoomAt = (px: number, py: number, factor: number) => {
    const s = scale.get()
    const next = Math.min(FREE_ZOOM.max, Math.max(FREE_ZOOM.min, s * factor))
    x.jump(px - (px - x.get()) * (next / s))
    y.jump(py - (py - y.get()) * (next / s))
    scale.jump(next)
  }

  useEffect(() => {
    const el = ref.current
    if (!el || !free) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
    }
    el.addEventListener('wheel', onWheel, { passive: false }) // React's onWheel is passive
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, free])

  const local = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const spread = () => {
    const [a, b] = [...pointers.current.values()]
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
  }

  const handlers = free
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.button !== 0) return
          pointers.current.set(e.pointerId, local(e))
          if (pointers.current.size === 1) dragged.current = false
          if (pointers.current.size === 2) pinch.current = spread().d
        },
        onPointerMove: (e: React.PointerEvent) => {
          const prev = pointers.current.get(e.pointerId)
          if (!prev) return
          const p = local(e)
          if (pointers.current.size === 2) {
            const before = spread()
            pointers.current.set(e.pointerId, p)
            const after = spread()
            x.jump(x.get() + after.mx - before.mx)
            y.jump(y.get() + after.my - before.my)
            if (pinch.current) zoomAt(after.mx, after.my, after.d / pinch.current)
            pinch.current = after.d
            dragged.current = true
            return
          }
          if (!dragged.current && Math.hypot(p.x - prev.x, p.y - prev.y) < DRAG_THRESHOLD) return
          if (!dragged.current) e.currentTarget.setPointerCapture(e.pointerId)
          dragged.current = true
          x.jump(x.get() + p.x - prev.x)
          y.jump(y.get() + p.y - prev.y)
          pointers.current.set(e.pointerId, p)
        },
        onPointerUp: (e: React.PointerEvent) => {
          pointers.current.delete(e.pointerId)
          pinch.current = undefined
        },
        onPointerCancel: (e: React.PointerEvent) => {
          pointers.current.delete(e.pointerId)
          pinch.current = undefined
        },
        // A drag ends with a click on whatever's under the pointer; swallow it.
        onClickCapture: (e: React.MouseEvent) => {
          if (!dragged.current) return
          e.stopPropagation()
          dragged.current = false
        },
      }
    : {}

  const reset = () => size && worldW && goTo(frame(size, worldW, 'all'), false)

  return { worldW, style: { x, y, scale }, handlers, reset }
}
