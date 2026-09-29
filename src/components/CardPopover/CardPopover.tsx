// Card details as a popover beside the card instead of a docked panel.
// Hovering shows it after a short delay and it ignores the pointer, so it
// never gets in the way of hovering the next card. Clicking pins it (with
// its actions on top) until ✕, Esc or clicking the card again.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { ScreenRect } from '../Board/BoardRenderer'
import type { CardFace } from '../../view/boardView'
import { CardDetailPanel } from '../CardDetailPanel/CardDetailPanel'

const HOVER_DELAY_MS = 250
const GAP = 12
const MARGIN = 8

// In the gutter right of the board when it fits, so the board stays
// clickable; otherwise beside the card (right if it fits, else left). Level
// with the card, kept within the board's height (so off the header and
// controls) where possible. No anchor (picked from a pile):
// vertically centred.
function place(anchor: ScreenRect | undefined, board: ScreenRect | undefined, w: number, h: number) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const [minTop, maxBottom] = board && board.bottom - board.top >= h ? [board.top, board.bottom] : [MARGIN, vh - MARGIN]
  const clampTop = (t: number) => Math.min(Math.max(minTop, t), maxBottom - h)
  const top = clampTop(anchor ? (anchor.top + anchor.bottom) / 2 - h / 2 : (vh - h) / 2)
  if (board && vw - board.right >= w + GAP + MARGIN) return { left: board.right + GAP, top }
  if (!anchor) return { left: vw - w - MARGIN, top }
  const left = anchor.right + GAP + w <= vw - MARGIN ? anchor.right + GAP : Math.max(MARGIN, anchor.left - GAP - w)
  return { left, top }
}

export function CardPopover({
  hovered,
  hoverAnchor,
  pinned,
  pinAnchor,
  board,
  materialsOf,
  onDismiss,
  actions,
}: {
  hovered?: CardFace
  hoverAnchor?: ScreenRect
  pinned?: CardFace
  pinAnchor?: ScreenRect
  board?: RefObject<HTMLElement | null> // kept clear when there's room
  materialsOf: (card: CardFace) => CardFace[]
  onDismiss: () => void
  actions?: ReactNode // shown on the pinned card
}) {
  // Delay hover popovers so sweeping the mouse across the board stays calm.
  const [shownHover, setShownHover] = useState<{ card: CardFace; anchor?: ScreenRect }>()
  useEffect(() => {
    const t = setTimeout(() => setShownHover(hovered && { card: hovered, anchor: hoverAnchor }), hovered ? HOVER_DELAY_MS : 0)
    return () => clearTimeout(t)
  }, [hovered, hoverAnchor])

  useEffect(() => {
    if (!pinned) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinned, onDismiss])

  // Hovering another card previews it over the pinned one.
  const showHover = shownHover && shownHover.card.iid !== pinned?.iid
  const card = showHover ? shownHover.card : pinned
  const anchor = showHover ? shownHover.anchor : pinAnchor
  const isPinned = !showHover && !!pinned

  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos(place(anchor, board?.current?.getBoundingClientRect(), el.offsetWidth, el.offsetHeight))
  }, [anchor, card, board])

  if (!card) return null
  return (
    <div
      ref={ref}
      role={isPinned ? 'dialog' : 'tooltip'}
      aria-label={card.visible ? card.name : 'Face-down card'}
      className={`fixed z-40 max-h-[calc(100vh-1rem)] w-72 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur ${
        isPinned ? '' : 'pointer-events-none'
      }`}
      style={pos ?? { left: -9999, top: 0 }}
    >
      {isPinned && (
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-2 top-2 z-10 rounded px-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label="Close card details"
          title="Close (Esc)"
        >
          ✕
        </button>
      )}
      {isPinned && actions}
      <CardDetailPanel card={card} materials={materialsOf(card)} />
    </div>
  )
}
