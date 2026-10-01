// Your hand, pinned to the bottom of the screen as a fan instead of lying on
// the table, so it stays put while the camera moves. Hovering a card shows it
// big (with its full-size image); clicking and dragging work as on the board.
import { useDraggable } from '@dnd-kit/core'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
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
  const zoomH = Math.min(cardH * ZOOM, (board.h - bottom) * 0.65)
  const zoomW = zoomH / ASPECT
  return (
    <div className="pointer-events-none absolute inset-x-0 z-[5]" style={{ bottom: `calc(${bottom}px + var(--safe-bottom, 0px))` }} data-testid="hand-fan">
      <AnimatePresence initial={false}>
        {cards.map((c, i) => (
          <FanCard
            key={c.iid}
            card={c}
            {...slot(i)}
            index={i}
            width={cardW}
            height={cardH}
            lit={lit.has(c.iid)}
            canDrag={canDrag.has(c.iid)}
            zoomed={zoomed === i}
            onHover={(on) => setHovered((h) => (on ? c.iid : h === c.iid ? undefined : h))}
            onClick={() => onCardClick?.(c.iid)}
          />
        ))}
      </AnimatePresence>
      {/* The hovered card itself seems to come up: this starts where it lies
          in the fan (its own is hidden meanwhile) and springs upright. */}
      <AnimatePresence>
        {zoomed >= 0 && <Zoomed key={cards[zoomed].iid} card={cards[zoomed]} from={{ ...slot(zoomed), height: cardH }} width={zoomW} height={zoomH} min={left + MARGIN} max={board.w - zoomW - MARGIN} />}
      </AnimatePresence>
    </div>
  )
}

type ZoomedProps = { card: PlacedCard; from: { x: number; angle: number; drop: number; height: number }; width: number; height: number; min: number; max: number }

function Zoomed({ card, from, width, height, min, max }: ZoomedProps) {
  const left = Math.min(Math.max(from.x - width / 2, min), max)
  // Where the card lies in the fan, as this box would have to sit to match it.
  const lying = { x: from.x - (left + width / 2), y: MARGIN + from.height * SINK + from.drop, rotate: from.angle, scale: from.height / height }
  return (
    <motion.div
      className="absolute z-[200] origin-bottom rounded-[4%] outline outline-2 outline-offset-2 outline-gold [box-shadow:0_0_2rem_0.25rem_color-mix(in_srgb,var(--color-gold)_45%,transparent),0_1.5rem_3rem_black]"
      style={{ bottom: MARGIN, left, width, height }}
      initial={lying}
      animate={{ x: 0, y: 0, rotate: 0, scale: 1, transition: { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 } }}
      exit={{ ...lying, opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } }}
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
  onHover: (on: boolean) => void
  onClick: () => void
}

function FanCard({ card, x, angle, drop, index, width, height, lit, canDrag, zoomed, onHover, onClick }: FanCardProps) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: card.iid, disabled: !canDrag })
  const lift = lit ? height * 0.12 : 0
  return (
    // The upright box is what's picked up, so the dragged card isn't sized
    // by the tilted one's bounding box.
    <div
      ref={setNodeRef}
      className={`absolute bottom-0 transition-[left,translate] duration-300 ease-out motion-reduce:transition-none ${isDragging ? 'opacity-30' : zoomed ? 'opacity-0' : ''}`}
      style={{ left: x - width / 2, width, height, translate: `0 ${height * SINK + drop - lift}px`, zIndex: index }}
    >
      <motion.div
        role="button"
        tabIndex={0}
        aria-label={card.visible ? card.name : 'Face-down card'}
        data-iid={card.iid}
        className={`pointer-events-auto h-full w-full origin-bottom rounded-[5%] shadow-lg shadow-black/70 ${canDrag ? 'cursor-grab touch-none' : 'cursor-pointer'} ${
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
          if (canDrag) listeners?.onPointerDown?.(e)
        }}
        onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(true)}
        onPointerLeave={() => onHover(false)}
      >
        <CardView card={card} />
      </motion.div>
    </div>
  )
}
