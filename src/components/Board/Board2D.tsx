// The 2D board: absolutely positions zones and cards from the shared layout,
// in % of a fixed-aspect container, so it scales with the window. Every card
// is a direct child keyed by iid, so moving between zones animates via CSS;
// Motion handles what CSS can't: cards leaving, flips and arrows drawing in.
import { AnimatePresence, motion } from 'motion/react'
import type { CSSProperties } from 'react'
import type { Iid } from '../../engine'
import type { PlacedCard, ZoneView } from '../../view/boardView'
import { BOUNDS, CARD, type Point } from '../../view/layout'
import { CardView } from '../CardView/CardView'
import type { BoardRendererProps, ScreenRect } from './BoardRenderer'

// Position only; rotation is applied to the card inside so labels stay upright.
const box = (p: Point): CSSProperties => ({
  left: `${((p.x - CARD.w / 2 - BOUNDS.minX) / BOUNDS.width) * 100}%`,
  top: `${((p.y - CARD.h / 2 - BOUNDS.minY) / BOUNDS.height) * 100}%`,
  width: `${(CARD.w / BOUNDS.width) * 100}%`,
  height: `${(CARD.h / BOUNDS.height) * 100}%`,
})

export function Board2D({ view, selected, onCardClick, onCardHover, onZoneClick }: BoardRendererProps) {
  return (
    <div
      className="@container relative w-full select-none overflow-hidden rounded-xl bg-gradient-to-b from-indigo-950 via-slate-900 to-emerald-950 shadow-inner"
      style={{ aspectRatio: `${BOUNDS.width} / ${BOUNDS.height}` }}
      data-testid="board"
    >
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-white/10" />
      {view.zones.map((z) => (
        <ZoneOutline key={z.key} zone={z} onClick={() => onZoneClick?.(z.ref)} />
      ))}
      <AnimatePresence initial={false}>
        {view.cards.map((c) => (
          <BoardCard
            key={c.iid}
            card={c}
            selected={selected === c.iid}
            onClick={(anchor) => onCardClick?.(c.iid, anchor)}
            onHover={onCardHover}
          />
        ))}
      </AnimatePresence>
      {view.zones
        .filter((z) => z.kind === 'pile' && z.count > 0)
        .map((z) => (
          <span
            key={z.key}
            className="pointer-events-none absolute z-[60] flex items-end justify-center"
            style={box(z.placement)}
          >
            <span className="mb-[-0.6cqw] rounded-full bg-black/85 px-[0.6cqw] font-mono text-[1cqw] text-white">{z.count}</span>
          </span>
        ))}
      <svg
        className="pointer-events-none absolute inset-0 z-50 h-full w-full"
        viewBox={`${BOUNDS.minX} ${BOUNDS.minY} ${BOUNDS.width} ${BOUNDS.height}`}
      >
        <defs>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#fbbf24" />
          </marker>
        </defs>
        {view.arrows.map((a) => (
          <motion.line
            key={`${a.fromIid}>${a.toIid}`}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            x1={a.from.x}
            y1={a.from.y}
            x2={a.to.x}
            y2={a.to.y}
            stroke="#fbbf24"
            strokeWidth={0.07}
            strokeLinecap="round"
            markerEnd="url(#arrowhead)"
            className="drop-shadow"
          />
        ))}
      </svg>
    </div>
  )
}

function ZoneOutline({ zone, onClick }: { zone: ZoneView; onClick: () => void }) {
  const pile = zone.kind === 'pile'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${zone.ref.player ?? ''} ${zone.label}${pile ? ` (${zone.count})` : ''}`}
      className={`absolute rounded-[6%] border border-dashed text-white/35 transition-colors hover:border-white/50 hover:bg-white/5 ${
        zone.ref.zone === 'extraMonster' ? 'border-sky-300/30' : 'border-white/20'
      }`}
      style={box(zone.placement)}
    >
      <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-[4%] text-center text-[0.9cqw] leading-tight">
        {zone.label}
      </span>
    </button>
  )
}

function BoardCard({
  card,
  selected,
  onClick,
  onHover,
}: {
  card: PlacedCard
  selected: boolean
  onClick: (anchor: ScreenRect) => void
  onHover?: (iid: Iid | undefined, anchor?: ScreenRect) => void
}) {
  const onField = card.stackIndex === undefined && card.handIndex === undefined && card.materialOf === undefined
  const isMonsterZone = card.zone.zone === 'monster' || card.zone.zone === 'extraMonster'
  const z = card.materialOf ? 10 + (card.materialIndex ?? 0) : card.handIndex !== undefined ? 30 + card.handIndex : 20
  const modified = card.atk !== card.baseAtk || card.def !== card.baseDef
  const inPile = card.stackIndex !== undefined
  const face = card.visible && !card.set ? 'up' : 'down'
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.25 }}
      role="button"
      tabIndex={0}
      aria-label={card.visible ? card.name : 'Face-down card'}
      data-iid={card.iid}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e.currentTarget.getBoundingClientRect())
      }}
      onKeyDown={(e) => e.key === 'Enter' && onClick(e.currentTarget.getBoundingClientRect())}
      onMouseEnter={(e) => onHover?.(card.iid, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => onHover?.(undefined)}
      className={`absolute cursor-pointer text-[1.6cqw] transition-[left,top] duration-300 ease-out hover:brightness-110 motion-reduce:transition-none ${inPile ? 'pointer-events-none' : ''}`}
      style={{ ...box(card.placement), zIndex: z }}
    >
      <div
        style={{ transform: `rotate(${card.placement.rotation + (isMonsterZone && card.position === 'def' ? 90 : 0)}deg)` }}
        className={`h-full w-full rounded-[5%] transition-transform duration-300 ${
          card.highlighted ? 'shadow-[0_0_1.2cqw_0.3cqw_rgba(251,191,36,0.9)] ring-2 ring-amber-300' : 'shadow-md shadow-black/60'
        } ${selected ? 'outline outline-2 outline-offset-2 outline-sky-300' : ''} ${card.revealed ? 'ring-2 ring-fuchsia-400' : ''}`}
      >
        {/* A flip when the face shown changes; initial={false} skips it when the card first appears. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={face}
            className="h-full w-full"
            initial={{ rotateY: -90 }}
            animate={{ rotateY: 0 }}
            exit={{ rotateY: 90 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
          >
            <CardView card={card} />
          </motion.div>
        </AnimatePresence>
      </div>
      {onField && isMonsterZone && card.visible && card.atk !== undefined && (
        <div
          className={`absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-[0.5cqw] font-mono text-[0.95cqw] ${
            card.controller === 'p1' ? '-bottom-[1.4cqw]' : '-top-[1.4cqw]'
          } ${modified ? 'text-amber-300' : 'text-white'}`}
        >
          {card.atk}
          {card.def !== undefined && ` / ${card.def}`}
        </div>
      )}
      {card.modifiers.length > 0 && card.visible && (
        <div className="absolute -right-[0.6cqw] -top-[0.6cqw] z-10 rounded-full bg-amber-400 px-[0.45cqw] text-[0.9cqw] font-bold text-black">
          {card.modifiers.length}
        </div>
      )}
    </motion.div>
  )
}
