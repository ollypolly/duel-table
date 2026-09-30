// The 2D board: absolutely positions zones and cards from the shared layout,
// in % of a fixed-aspect "world" sized so the whole table fits. A camera pans
// and zooms the world to frame the focus area. Every card is a direct child
// keyed by iid, so moving between zones animates via CSS; Motion handles what
// CSS can't: the camera, cards leaving, flips and arrows drawing in. Dragging
// cards onto zones is dnd-kit.
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import * as Tooltip from '@radix-ui/react-tooltip'
import { AnimatePresence, motion } from 'motion/react'
import { useContext, useRef, useState, type CSSProperties } from 'react'
import { PLAYERS, type Iid, type Player } from '../../engine'
import { SeatDecks, useCosmeticsStore } from '../../store/cosmeticsStore'
import type { PlacedCard, ZoneView } from '../../view/boardView'
import { BOUNDS, CARD, DECK_BOX, deckBoxPlacement, type Point } from '../../view/layout'
import { CardView } from '../CardView/CardView'
import type { BoardRendererProps } from './BoardRenderer'
import { useBoardCamera } from './useBoardCamera'

// Position only; rotation is applied to the card inside so labels stay upright.
const box = (p: Point, size: { w: number; h: number } = CARD): CSSProperties => ({
  left: `${((p.x - size.w / 2 - BOUNDS.minX) / BOUNDS.width) * 100}%`,
  top: `${((p.y - size.h / 2 - BOUNDS.minY) / BOUNDS.height) * 100}%`,
  width: `${(size.w / BOUNDS.width) * 100}%`,
  height: `${(size.h / BOUNDS.height) * 100}%`,
})

export function Board2D({
  view,
  selected,
  choosable = [],
  focus = 'all',
  insetLeft = 0,
  onCameraMove,
  onCardClick,
  draggable = [],
  onCardDrop,
  onZoneClick,
}: BoardRendererProps) {
  const ref = useRef<HTMLDivElement>(null)
  const cam = useBoardCamera(ref, focus, insetLeft, onCameraMove)
  const seatDecks = useContext(SeatDecks)
  const byDeck = useCosmeticsStore((s) => s.cosmetics)
  const cosmetics = (p: Player) => (seatDecks[p] && byDeck[seatDecks[p]]) || {}
  const lit = new Set(choosable)
  const canDrag = new Set(onCardDrop ? draggable : [])
  const litPiles = new Set(view.cards.filter((c) => lit.has(c.iid) && c.stackIndex !== undefined).map((c) => `${c.zone.player}:${c.zone.zone}`))
  // A few px of movement before a press becomes a drag, so clicks still open cards.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [dragging, setDragging] = useState<PlacedCard>()
  return (
    <Tooltip.Provider delayDuration={300}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={({ active }) => setDragging(view.cards.find((c) => c.iid === active.id))}
        onDragCancel={() => setDragging(undefined)}
        onDragEnd={({ active, over }) => {
          setDragging(undefined)
          const to = over && view.zones.find((z) => z.key === over.id)?.ref
          if (to) onCardDrop?.(active.id as Iid, to)
        }}
      >
        <div
          ref={ref}
          className="felt relative isolate h-full w-full cursor-grab touch-none overflow-hidden active:cursor-grabbing"
          data-testid="board"
          data-focus={focus}
          {...cam.handlers}
        >
          <motion.div
            className="playmat @container absolute left-0 top-0 origin-top-left select-none"
            style={{
              width: cam.worldW ?? '100%',
              aspectRatio: `${BOUNDS.width} / ${BOUNDS.height}`,
              ...cam.style,
            }}
          >
            {PLAYERS.map((p) => cosmetics(p).playmat && <Playmat key={p} player={p} src={cosmetics(p).playmat!} />)}
            <div className="pointer-events-none absolute inset-x-[4%] top-1/2 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
            {view.zones.map((z) => (
              <ZoneOutline key={z.key} zone={z} placing={!!selected} lit={litPiles.has(`${z.ref.player}:${z.ref.zone}`)} onClick={() => onZoneClick?.(z.ref)} />
            ))}
            {PLAYERS.map(
              (p) =>
                cosmetics(p).deckBox && (
                  <img
                    key={p}
                    src={cosmetics(p).deckBox}
                    alt="Deck box"
                    draggable={false}
                    className="pointer-events-none absolute rounded-[6%] object-cover shadow-lg shadow-black/70"
                    style={{
                      ...box(deckBoxPlacement(p), DECK_BOX),
                      rotate: `${deckBoxPlacement(p).rotation}deg`,
                    }}
                  />
                ),
            )}
            <AnimatePresence initial={false}>
              {view.cards.map((c) => (
                <BoardCard key={c.iid} card={c} selected={selected === c.iid} lit={lit.has(c.iid)} onClick={() => onCardClick?.(c.iid)} canDrag={canDrag.has(c.iid)} />
              ))}
            </AnimatePresence>
            {view.zones
              .filter((z) => z.kind === 'pile' && z.count > 0)
              .map((z) => (
                <span key={z.key} className="pointer-events-none absolute z-[60] flex items-end justify-center" style={box(z.placement)}>
                  <span className="mb-[-0.7cqw] rounded-full border border-line bg-bg/90 px-[0.7cqw] font-display text-[1cqw] font-semibold text-ink">{z.count}</span>
                </span>
              ))}
            <svg className="pointer-events-none absolute inset-0 z-50 h-full w-full" viewBox={`${BOUNDS.minX} ${BOUNDS.minY} ${BOUNDS.width} ${BOUNDS.height}`}>
              <defs>
                <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" fill="var(--color-gold)" />
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
                  stroke="var(--color-gold)"
                  strokeWidth={0.07}
                  strokeLinecap="round"
                  markerEnd="url(#arrowhead)"
                  className="drop-shadow-[0_0_0.1px_var(--color-gold)]"
                />
              ))}
            </svg>
          </motion.div>
          {focus === 'free' && (
            <button type="button" className="btn absolute bottom-3 right-3 z-10" onClick={cam.reset} onPointerDown={(e) => e.stopPropagation()}>
              Reset view
            </button>
          )}
        </div>
        {/* Screen-sized, outside the zoomed world; no drop animation, since a
          card that moved slides to its new zone by itself. */}
        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="h-full w-full rotate-3 opacity-90 shadow-2xl shadow-black">
              <CardView card={dragging} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </Tooltip.Provider>
  )
}

// A player's playmat image fills their half, turned to face them, under a
// scrim so the zones stay readable, fading out into the table at its edges.
function Playmat({ player, src }: { player: Player; src: string }) {
  return (
    <div
      className={`pointer-events-none absolute -inset-x-[10%] h-[75%] overflow-hidden [mask-image:radial-gradient(ellipse_at_center,black_45%,transparent_72%)] ${player === 'p1' ? 'top-1/2' : '-top-1/4'}`}
    >
      <img src={src} alt="" draggable={false} className={`h-full w-full object-cover ${player === 'p2' ? 'rotate-180' : ''}`} />
      <div className="absolute inset-0 bg-bg/50" />
    </div>
  )
}

// Piles (Deck, GY…) sit above their top card so the whole stack is the click
// target, and light up with a "View" chip on hover.
function ZoneOutline({ zone, placing, lit, onClick }: { zone: ZoneView; placing: boolean; lit: boolean; onClick: () => void }) {
  const pile = zone.kind === 'pile'
  const { setNodeRef, isOver, active } = useDroppable({ id: zone.key })
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      aria-label={`${zone.ref.player ?? ''} ${zone.label}${pile ? ` (${zone.count})` : ''}`}
      className={`zone group absolute cursor-pointer rounded-[6%] border transition-[background-color,border-color,box-shadow] ${
        zone.ref.zone === 'extraMonster' ? 'border-gold/40 text-gold/50' : zone.ref.player === 'p2' ? 'border-p2/25 text-p2/40' : 'border-p1/25 text-p1/40'
      } ${pile ? 'z-[25] hover:border-gold hover:shadow-[0_0_1.2cqw_var(--color-gold)]' : ''} ${pile && zone.count > 0 ? 'bg-transparent hover:bg-bg/40' : ''} ${lit ? 'border-accent shadow-[0_0_1.2cqw_var(--color-accent)]' : ''} ${
        isOver ? 'border-gold bg-gold/15 shadow-[0_0_1.2cqw_var(--color-gold)]' : active ? 'border-dashed' : ''
      }`}
      style={box(zone.placement)}
    >
      {pile && zone.count > 0 ? (
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-gold px-[0.7cqw] py-[0.15cqw] font-display text-[0.9cqw] font-bold uppercase tracking-wider text-bg opacity-0 transition-opacity group-hover:opacity-100">
          {placing ? 'Move here' : lit ? 'Choose' : 'View'}
        </span>
      ) : (
        <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-[4%] text-center font-display text-[0.75cqw] font-semibold uppercase leading-tight tracking-wider">
          {zone.label}
        </span>
      )}
    </button>
  )
}

function BoardCard({ card, selected, lit, onClick, canDrag }: { card: PlacedCard; selected: boolean; lit: boolean; onClick: () => void; canDrag: boolean }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: card.iid,
    disabled: !canDrag,
  })
  const onField = card.stackIndex === undefined && card.handIndex === undefined && card.materialOf === undefined
  const isMonsterZone = card.zone.zone === 'monster' || card.zone.zone === 'extraMonster'
  const z = card.materialOf ? 10 + (card.materialIndex ?? 0) : card.handIndex !== undefined ? 30 + card.handIndex : 20
  const modified = card.atk !== card.baseAtk || card.def !== card.baseDef
  const inPile = card.stackIndex !== undefined
  const face = card.visible && !card.set ? 'up' : 'down'
  const el = (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.25 }}
      role="button"
      tabIndex={0}
      aria-label={card.visible ? card.name : 'Face-down card'}
      data-iid={card.iid}
      ref={setNodeRef}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      // The camera pans from the felt, not from cards you can pick up.
      onPointerDown={(e) => {
        if (!canDrag) return
        e.stopPropagation()
        listeners?.onPointerDown?.(e)
      }}
      className={`absolute text-[1.6cqw] transition-[left,top,translate] duration-300 ease-out hover:-translate-y-[0.4cqw] hover:brightness-110 motion-reduce:transition-none ${inPile ? 'pointer-events-none' : ''} ${
        canDrag ? 'cursor-grab touch-none' : 'cursor-pointer'
      } ${isDragging ? 'opacity-30' : ''}`}
      style={{ ...box(card.placement), zIndex: z }}
    >
      <div
        style={{
          transform: `rotate(${card.placement.rotation + (isMonsterZone && card.position === 'def' ? 90 : 0)}deg)`,
        }}
        className={`h-full w-full rounded-[5%] transition-transform duration-300 ${
          card.highlighted ? 'shadow-[0_0_1.4cqw_0.3cqw_var(--color-gold)] ring-2 ring-gold' : 'shadow-lg shadow-black/70'
        } ${selected ? 'outline outline-2 outline-offset-2 outline-accent' : ''} ${lit ? 'outline outline-2 outline-offset-[0.3cqw] outline-accent shadow-[0_0_1.4cqw_0.2cqw_var(--color-accent)]' : ''} ${card.revealed ? 'ring-2 ring-chain' : ''}`}
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
          className={`absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-line bg-bg/90 px-[0.5cqw] font-display text-[1cqw] font-semibold ${
            card.controller === 'p1' ? '-bottom-[1.5cqw]' : '-top-[1.5cqw]'
          } ${modified ? 'text-warn' : 'text-ink'}`}
        >
          {card.atk}
          {card.def !== undefined && ` / ${card.def}`}
        </div>
      )}
      {card.modifiers.length > 0 && card.visible && (
        <div className="absolute -right-[0.6cqw] -top-[0.6cqw] z-10 rounded-full bg-warn px-[0.45cqw] font-display text-[0.9cqw] font-bold text-bg">
          {card.modifiers.length}
        </div>
      )}
    </motion.div>
  )
  if (!card.visible) return el
  // Its name on hover (not on touch, and not while it's being picked up).
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{el}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="top" sideOffset={6} className="panel z-50 px-2 py-1 font-display text-xs font-semibold text-ink">
          {card.name}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
