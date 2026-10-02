// Your hand, pinned to the bottom of the screen as a fan instead of lying on
// the table, so it stays put while the camera moves. Hovering a card shows it
// big (with its full-size image); clicking and dragging work as on the board.
//
// Under a finger there's no hover, so a touch reads the hand instead: hold a
// card, or slide sideways along the fan, and each card you pass shows big
// above your finger while its neighbours make room. Slide up out of the fan
// and the card you're on is picked up to drag onto the table; lift off inside
// the fan and nothing moves. A quick tap is still a click.
import { useDraggable, type DraggableSyntheticListeners } from '@dnd-kit/core'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Iid } from '../../engine'
import type { PlacedCard } from '../../view/boardView'
import { CARD } from '../../view/layout'
import { CardView } from '../CardView/CardView'
import { fanCardHeight, SINK } from './fan'

const ASPECT = CARD.h / CARD.w
const MAX_TILT = 5 // degrees between neighbours
const MAX_SPREAD = 36 // degrees across the whole fan
const ZOOM = 2.8
const MARGIN = 8
const HOLD = 180 // ms a finger rests before the card under it shows
const LIFE = 380 // px wide: about a real card on a phone, where the big one may cover the whole screen
const SLOP = 8 // px a finger may wander and still be a tap or a hold

type Props = {
  cards: PlacedCard[]
  board: { w: number; h: number }
  left: number // px on the left the fan keeps clear of (the scene panel)
  bottom: number // px on the bottom it sits above (the phone sheet)
  lit: Set<Iid>
  canDrag: Set<Iid>
  dragging: boolean
  onCardClick?: (iid: Iid) => void
}

export function HandFan({ cards, board, left, bottom, lit, canDrag, dragging, onCardClick }: Props) {
  const [hovered, setHovered] = useState<Iid>()
  const cardH = fanCardHeight(board)
  const cardW = cardH / ASPECT
  const n = cards.length
  const room = board.w - left - 2 * MARGIN
  const centre = left + (board.w - left) / 2
  // A lot of cards overlap more; they never shrink.
  const pitch = n > 1 ? Math.min(cardW * 0.72, (room - cardW) / (n - 1)) : 0
  const tilt = n > 1 ? Math.min(MAX_TILT, MAX_SPREAD / (n - 1)) : 0
  const radius = tilt ? pitch / Math.sin((tilt * Math.PI) / 180) : 0
  const slot = (i: number) => {
    const k = i - (n - 1) / 2
    return { x: centre + k * pitch, angle: k * tilt, drop: radius * (1 - Math.cos((k * tilt * Math.PI) / 180)) }
  }
  const zoomed = dragging ? -1 : cards.findIndex((c) => c.iid === hovered)
  // A finger reading the hand: where it went down, and what it has become.
  const touch = useRef<{ x: number; y: number; iid: Iid; mode: 'pending' | 'scrub' | 'drag'; timer: number }>(undefined)
  // Where the fan sits on the page while it's being read, since the card shown then isn't kept inside the table.
  const fan = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState<{ left: number; bottom: number; w: number; h: number }>()
  const scrubbing = !!page
  const pickers = useRef(new Map<Iid, DraggableSyntheticListeners>())
  const swallow = useRef(false)
  const scrub = (iid: Iid) => {
    if (touch.current) touch.current.mode = 'scrub'
    const r = fan.current!.getBoundingClientRect()
    setPage((p) => p ?? { left: r.left, bottom: r.bottom, w: window.innerWidth, h: window.innerHeight })
    setHovered(iid)
  }
  const letGo = () => {
    window.clearTimeout(touch.current?.timer)
    touch.current = undefined
    setPage(undefined)
    setHovered(undefined)
  }
  // Hand the card to the drag as if the finger had just come down on it here.
  const pickUp = (iid: Iid, e: React.PointerEvent) => {
    if (!canDrag.has(iid) || !touch.current) return
    window.clearTimeout(touch.current.timer)
    touch.current.mode = 'drag'
    setPage(undefined)
    setHovered(undefined)
    const down = new PointerEvent('pointerdown', { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: 'touch', isPrimary: true, button: 0 })
    pickers.current.get(iid)?.onPointerDown?.({ nativeEvent: down })
  }
  const reading = {
    onPointerMove: (e: React.PointerEvent) => {
      const t = touch.current
      if (!t || t.mode === 'drag' || e.pointerType !== 'touch') return
      const [dx, dy] = [e.clientX - t.x, e.clientY - t.y]
      if (t.mode === 'pending') {
        if (Math.hypot(dx, dy) < SLOP) return
        window.clearTimeout(t.timer)
        if (-dy > Math.abs(dx)) return pickUp(t.iid, e)
      }
      const r = e.currentTarget.getBoundingClientRect()
      // Read against where the cards lie at rest, so making room doesn't change which one is under the finger.
      const x = e.clientX - r.left
      const at = cards.reduce((best, _, i) => (Math.abs(slot(i).x - x) < Math.abs(slot(best).x - x) ? i : best), 0)
      if (e.clientY < r.bottom - cardH * 1.1) return pickUp(cards[at].iid, e)
      scrub(cards[at].iid)
    },
    onPointerUp: () => {
      if (touch.current?.mode === 'scrub') {
        // The click that follows isn't a tap on the card the finger started on.
        swallow.current = true
        setTimeout(() => (swallow.current = false))
      }
      letGo()
    },
    onPointerCancel: letGo,
  }
  // While a finger reads the hand, the cards either side of the one it's on move apart.
  const apart = scrubbing && zoomed >= 0 ? Math.min(cardW * 0.5, Math.max(0, cardW * 0.8 - pitch)) : 0
  const bigW = (p: NonNullable<typeof page>) => Math.min(LIFE, p.w - 2 * MARGIN, (p.bottom - cardH * 1.15 - 3 * MARGIN) / ASPECT)
  const lie = (i: number) => {
    const s = slot(i)
    return { ...s, x: s.x + Math.sign(i - zoomed) * apart }
  }
  const zoomH = Math.min(cardH * ZOOM, (board.h - bottom) * 0.65)
  const zoomW = zoomH / ASPECT
  return (
    <div className="pointer-events-none absolute inset-x-0 z-[5]" style={{ bottom: `calc(${bottom}px + var(--safe-bottom, 0px))` }} data-testid="hand-fan" ref={fan} {...reading}>
      <AnimatePresence initial={false}>
        {cards.map((c, i) => (
          <FanCard
            key={c.iid}
            card={c}
            {...lie(i)}
            index={i}
            width={cardW}
            height={cardH}
            lit={lit.has(c.iid)}
            canDrag={canDrag.has(c.iid)}
            zoomed={zoomed === i}
            peek={scrubbing}
            pickers={pickers}
            onTouchDown={(e) => {
              window.clearTimeout(touch.current?.timer)
              touch.current = { x: e.clientX, y: e.clientY, iid: c.iid, mode: 'pending', timer: window.setTimeout(() => scrub(c.iid), HOLD) }
            }}
            onHover={(on) => setHovered((h) => (on ? c.iid : h === c.iid ? undefined : h))}
            onClick={() => !swallow.current && onCardClick?.(c.iid)}
          />
        ))}
      </AnimatePresence>
      {/* The hovered card itself seems to come up: this starts where it lies
          in the fan (its own is hidden meanwhile) and springs upright. */}
      <AnimatePresence>
        {zoomed >= 0 && !page && <Zoomed key={cards[zoomed].iid} card={cards[zoomed]} from={{ ...slot(zoomed), height: cardH }} width={zoomW} height={zoomH} min={left + MARGIN} max={board.w - zoomW - MARGIN} />}
      </AnimatePresence>
      {/* Under a finger it's as near life size as the screen allows, above the hand and over anything else. */}
      {createPortal(
        <AnimatePresence>
          {zoomed >= 0 && page && (
            <Zoomed
              // One box for the whole read: the card in it changes as the finger moves.
              key="reading"
              card={cards[zoomed]}
              from={{ ...slot(zoomed), height: cardH }}
              width={bigW(page)}
              height={bigW(page) * ASPECT}
              min={MARGIN}
              max={page.w - bigW(page) - MARGIN}
              page={{ left: page.left, bottom: page.h - page.bottom, raise: cardH * 1.15 }}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

type ZoomedProps = { card: PlacedCard; from: { x: number; angle: number; drop: number; height: number }; width: number; height: number; min: number; max: number; page?: { left: number; bottom: number; raise: number } }

// page: placed on the page rather than in the fan (where the fan's corner is),
// and raised clear of the finger that's reading the hand.
function Zoomed({ card, from, width, height, min, max, page }: ZoomedProps) {
  const raise = page?.raise ?? 0
  const x = from.x + (page?.left ?? 0)
  const left = Math.min(Math.max(x - width / 2, min), max)
  // Where the card lies in the fan, as this box would have to sit to match it.
  const lying = { x: x - (left + width / 2), y: raise + MARGIN + from.height * SINK + from.drop, rotate: from.angle, scale: from.height / height }
  return (
    <motion.div
      className={`${page ? 'pointer-events-none fixed' : 'absolute'} z-[200] origin-bottom rounded-[4%] outline outline-2 outline-offset-2 outline-gold [box-shadow:0_0_2rem_0.25rem_color-mix(in_srgb,var(--color-gold)_45%,transparent),0_1.5rem_3rem_black]`}
      style={{ bottom: MARGIN + raise + (page?.bottom ?? 0), left, width, height }}
      initial={lying}
      // Quicker under a finger, which may be passing over several cards.
      animate={{ x: 0, y: 0, rotate: 0, scale: 1, transition: page ? { duration: 0.14, ease: 'easeOut' } : { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 } }}
      exit={page ? { opacity: 0, transition: { duration: 0.08 } } : { ...lying, opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } }}
      data-testid="hand-zoom"
    >
      {/* The small image shows at once; the full one covers it when it's in. */}
      <CardView card={card} />
      {card.visible && card.imageFull && (
        <div className="absolute inset-0">
          <CardView card={{ ...card, image: card.imageFull }} />
        </div>
      )}
    </motion.div>
  )
}

type FanCardProps = {
  card: PlacedCard
  x: number
  angle: number
  drop: number
  index: number
  width: number
  height: number
  lit: boolean
  canDrag: boolean
  zoomed: boolean
  peek: boolean // a finger is reading the hand: the card it's on lifts in place rather than hiding behind the big one
  pickers: React.RefObject<Map<Iid, DraggableSyntheticListeners>>
  onTouchDown: (e: React.PointerEvent) => void
  onHover: (on: boolean) => void
  onClick: () => void
}

function FanCard({ card, x, angle, drop, index, width, height, lit, canDrag, zoomed, peek, pickers, onTouchDown, onHover, onClick }: FanCardProps) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: card.iid, disabled: !canDrag })
  const lift = zoomed && peek ? height * 0.3 : lit ? height * 0.12 : 0
  useEffect(() => {
    const map = pickers.current
    map.set(card.iid, listeners)
    return () => void map.delete(card.iid)
  }, [pickers, card.iid, listeners])
  return (
    // The upright box is what's picked up, so the dragged card isn't sized
    // by the tilted one's bounding box.
    <div
      ref={setNodeRef}
      className={`absolute bottom-0 transition-[left,translate] duration-300 ease-out motion-reduce:transition-none ${isDragging ? 'opacity-30' : zoomed && !peek ? 'opacity-0' : ''}`}
      style={{ left: x - width / 2, width, height, translate: `0 ${height * SINK + drop - lift}px`, zIndex: index }}
    >
      <motion.div
        role="button"
        tabIndex={0}
        aria-label={card.visible ? card.name : 'Face-down card'}
        data-iid={card.iid}
        className={`pointer-events-auto h-full w-full origin-bottom select-none rounded-[5%] [-webkit-touch-callout:none] shadow-lg shadow-black/70 ${canDrag ? 'cursor-grab touch-none' : 'cursor-pointer'} ${
          lit ? 'outline outline-2 outline-offset-2 outline-accent shadow-[0_0_1rem_0.15rem_var(--color-accent)]' : card.highlighted ? 'ring-2 ring-gold' : ''
        }`}
        style={{ rotate: angle }}
        initial={{ y: height, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -height / 2, opacity: 0 }}
        transition={{ duration: 0.25 }}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        onKeyDown={(e) => e.key === 'Enter' && onClick()}
        // Not the camera's to pan from.
        onPointerDown={(e) => {
          e.stopPropagation()
          if (e.pointerType === 'touch') onTouchDown(e)
          else if (canDrag) listeners?.onPointerDown?.(e)
        }}
        onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(true)}
        onPointerLeave={() => onHover(false)}
      >
        <CardView card={card} />
      </motion.div>
    </div>
  )
}
