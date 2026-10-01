// The 2D board: absolutely positions zones and cards from the shared layout,
// in % of a fixed-aspect "world" sized so the whole table fits. A camera pans
// and zooms the world to frame the focus area. Every card is a direct child
// keyed by iid, so moving between zones animates via CSS; Motion handles what
// CSS can't: the camera, cards leaving, flips and arrows drawing in. Dragging
// cards onto zones is dnd-kit.
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import * as Tooltip from '@radix-ui/react-tooltip'
import { AnimatePresence, motion, useMotionValueEvent } from 'motion/react'
import { useContext, useRef, useState, type CSSProperties } from 'react'
import { PLAYERS, type Iid, type Player, type ZoneRef } from '../../engine'
import { SeatDecks, useCosmeticsStore } from '../../store/cosmeticsStore'
import { VIEWER, type CardFace, type PlacedCard, type ZoneView } from '../../view/boardView'
import { BOUNDS, CARD, DECK_BOX, deckBoxPlacement, type Point } from '../../view/layout'
import { CardView } from '../CardView/CardView'
import { FullArt } from '../CardView/fullArt'
import type { BoardRendererProps } from './BoardRenderer'
import { fanCardHeight, fanHeight } from './fan'
import { HandFan } from './HandFan'
import { coveredLeft, useBoardCamera, useSize } from './useBoardCamera'

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
  pinnedHand = false,
  insetBottom = 0,
  onCameraMove,
  onCardClick,
  draggable = [],
  onCardDrop,
  onZoneClick,
  choosableZones = [],
  boxSelect = false,
  multi = [],
  onMultiSelect,
}: BoardRendererProps) {
  const ref = useRef<HTMLDivElement>(null)
  const swallow = useRef(false)
  // Unmeasured (a test's DOM), the fan lays out for a desktop.
  const size = useSize(ref) ?? { w: 1280, h: 800 }
  const fan = pinnedHand ? insetBottom + fanHeight(fanCardHeight(size)) : 0
  const cam = useBoardCamera(ref, focus, insetLeft, onCameraMove, pinnedHand ? { height: fan } : undefined, boxSelect)
  const inFan = (c: PlacedCard) => pinnedHand && c.handIndex !== undefined && c.zone.player === VIEWER
  const seatDecks = useContext(SeatDecks)
  const byDeck = useCosmeticsStore((s) => s.cosmetics)
  const cosmetics = (p: Player) => (seatDecks[p] && byDeck[seatDecks[p]]) || {}
  const lit = new Set([...choosable, ...multi])
  const canDrag = new Set(onCardDrop ? draggable : [])
  const zoneChoice = (r: ZoneRef) => choosableZones.find((z) => z.ref.zone === r.zone && z.ref.player === r.player && z.ref.slot === r.slot)
  const litPiles = new Set(view.cards.filter((c) => lit.has(c.iid) && c.stackIndex !== undefined).map((c) => `${c.zone.player}:${c.zone.zone}`))
  // A few px of movement before a press becomes a drag, so clicks still open cards.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [dragging, setDragging] = useState<CardFace>()
  // The selection box, in the board's own pixels. It starts on the table, not
  // on a card, and a second finger (a pan or pinch) calls it off.
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number }>()
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const down = useRef(0)
  // Zoomed in close, the table swaps to the full-size art: the small scan is
  // 268px wide and goes soft well before a card fills that many pixels.
  const [fullArt, setFullArt] = useState(false)
  useMotionValueEvent(cam.style.scale, 'change', (scale) => {
    // offsetWidth is the zone's size before the camera's zoom, which hasn't reached the page yet.
    const zone = ref.current?.querySelector<HTMLElement>('.playmat button')
    if (zone) setFullArt(zone.offsetWidth * scale * devicePixelRatio > 180)
  })
  // Where a press on the table began: it becomes a box once it has moved a
  // few px, so a plain click still opens a pile or places what's selected.
  const press = useRef<{ x: number; y: number }>(undefined)
  // The table only shows a pile's top card, so a card picked from further down is found in its zone.
  const piled = new Map(view.zones.filter((z) => z.kind === 'pile').flatMap((z) => z.cards.map((c) => [c.iid, c] as const)))
  const inPiles = multi.filter((iid) => piled.has(iid))
  const faceOf = (iid: Iid): CardFace | undefined => piled.get(iid) ?? view.cards.find((c) => c.iid === iid)
  // What moves when a drag starts: the whole selection as one pile if the
  // dragged card is part of it, lead card on top.
  const [group, setGroup] = useState<CardFace[]>([])
  const select = {
    onPointerDown: (e: React.PointerEvent) => {
      cam.handlers.onPointerDown(e)
      down.current++
      if (!boxSelect || e.button !== 0) return
      press.current = undefined
      if (down.current > 1) return setMarquee(undefined)
      if ((e.target as Element).closest('[data-iid]')) return
      press.current = at(e)
    },
    onPointerMove: (e: React.PointerEvent) => {
      cam.handlers.onPointerMove(e)
      const p = at(e)
      const from = press.current
      if (marquee) return setMarquee({ ...marquee, x1: p.x, y1: p.y })
      if (!from || Math.hypot(p.x - from.x, p.y - from.y) < 6) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setMarquee({ x0: from.x, y0: from.y, x1: p.x, y1: p.y })
    },
    onPointerUp: (e: React.PointerEvent) => {
      cam.handlers.onPointerUp(e)
      down.current = Math.max(0, down.current - 1)
      const pressed = press.current
      press.current = undefined
      // A click on bare table, not a zone: clear the selection.
      if (!marquee) return void (pressed && !(e.target as Element).closest('button') && onMultiSelect?.([]))
      setMarquee(undefined)
      const r = ref.current!.getBoundingClientRect()
      const [l, t, rt, b] = [Math.min(marquee.x0, marquee.x1) + r.left, Math.min(marquee.y0, marquee.y1) + r.top, Math.max(marquee.x0, marquee.x1) + r.left, Math.max(marquee.y0, marquee.y1) + r.top]
      const loose = new Set(view.cards.filter((c) => c.stackIndex === undefined).map((c) => c.iid))
      const hit = [...ref.current!.querySelectorAll<HTMLElement>('[data-iid]')].filter((el) => {
        const c = el.getBoundingClientRect()
        return loose.has(el.dataset.iid!) && c.left < rt && c.right > l && c.top < b && c.bottom > t
      })
      // Cards picked out of a list stay picked: a box only reaches what's on the table.
      onMultiSelect?.([...new Set([...inPiles, ...hit.map((el) => el.dataset.iid!)])])
      swallow.current = true
      setTimeout(() => (swallow.current = false))
    },
    onPointerCancel: (e: React.PointerEvent) => {
      cam.handlers.onPointerCancel(e)
      down.current = 0
      press.current = undefined
      setMarquee(undefined)
    },
    // The click that ends a box isn't a click on the zone under it.
    onClickCapture: (e: React.MouseEvent) => {
      if (swallow.current) {
        swallow.current = false
        return e.stopPropagation()
      }
      cam.handlers.onClickCapture(e)
    },
  }
  return (
    <Tooltip.Provider delayDuration={300}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={({ active }) => {
          const lead = active.id === HELD ? inPiles[0] : (active.id as Iid)
          const ids = multi.includes(lead) ? [lead, ...multi.filter((m) => m !== lead)] : [lead]
          setDragging(faceOf(lead))
          setGroup(ids.flatMap((iid) => faceOf(iid) ?? []))
        }}
        onDragCancel={() => {
          setDragging(undefined)
          setGroup([])
        }}
        onDragEnd={({ over }) => {
          setDragging(undefined)
          setGroup([])
          const to = over && view.zones.find((z) => z.key === over.id)?.ref
          if (to && dragging) onCardDrop?.(dragging.iid, to)
        }}
      >
        <div
          ref={ref}
          className={`felt relative isolate h-full w-full touch-none overflow-hidden ${boxSelect ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
          data-testid="board"
          data-focus={focus}
          {...select}
        >
          {marquee && (
            <div
              className="pointer-events-none absolute z-[80] rounded-sm border border-accent bg-accent/15"
              data-testid="marquee"
              style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
            />
          )}
          <motion.div
            className="playmat @container absolute left-0 top-0 origin-top-left select-none"
            style={{
              width: cam.worldW ?? '100%',
              aspectRatio: `${BOUNDS.width} / ${BOUNDS.height}`,
              ...cam.style,
            }}
          >
            <FullArt.Provider value={fullArt}>
            {PLAYERS.map((p) => cosmetics(p).playmat && <Playmat key={p} player={p} src={cosmetics(p).playmat!} />)}
            <div className="pointer-events-none absolute inset-x-[4%] top-1/2 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
            {view.zones.map((z) => (
              <ZoneOutline key={z.key} zone={z} placing={!!selected} lit={litPiles.has(`${z.ref.player}:${z.ref.zone}`) || !!zoneChoice(z.ref)} picked={zoneChoice(z.ref)?.picked} onClick={() => onZoneClick?.(z.ref)} />
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
              {view.cards.filter((c) => !inFan(c)).map((c) => (
                <BoardCard key={c.iid} card={c} selected={selected === c.iid} lit={lit.has(c.iid)} onClick={() => onCardClick?.(c.iid)} canDrag={canDrag.has(c.iid)} gathered={group.length > 1 && group.some((g) => g.iid === c.iid)} />
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
            </FullArt.Provider>
          </motion.div>
          {pinnedHand && (
            <HandFan
              cards={view.cards.filter(inFan)}
              board={size}
              left={coveredLeft(size, insetLeft)}
              bottom={insetBottom}
              lit={lit}
              canDrag={canDrag}
              dragging={!!dragging}
              onCardClick={onCardClick}
            />
          )}
          {focus === 'free' && (
            <button
              type="button"
              className="panel absolute right-3 top-[4.25rem] z-10 flex h-11 items-center px-3.5 text-sm text-muted hover:text-ink sm:top-[6.25rem] sm:h-9 sm:px-2.5 sm:text-xs"
              onClick={cam.reset}
              onPointerDown={(e) => e.stopPropagation()}
            >
              Reset view
            </button>
          )}
          {inPiles.length > 0 && <HeldPile cards={inPiles.flatMap((iid) => faceOf(iid) ?? [])} hidden={dragging && group.length > 0 && inPiles.includes(dragging.iid)} />}
        </div>
        {/* Screen-sized, outside the zoomed world; no drop animation, since a
          card that moved slides to its new zone by itself. */}
        <DragOverlay dropAnimation={null}>
          {dragging && <Stack cards={group.length ? group : [dragging]} className="rotate-3 opacity-90" />}
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
function ZoneOutline({ zone, placing, lit, picked, onClick }: { zone: ZoneView; placing: boolean; lit: boolean; picked?: boolean; onClick: () => void }) {
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
      } ${pile ? 'z-[25] hover:border-gold hover:shadow-[0_0_1.2cqw_var(--color-gold)]' : ''} ${pile && zone.count > 0 ? 'bg-transparent hover:bg-bg/40' : ''} ${picked ? 'border-gold bg-gold/25 text-gold shadow-[0_0_1.4cqw_var(--color-gold)]' : lit ? 'border-accent shadow-[0_0_1.2cqw_var(--color-accent)]' : ''} ${
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

const HELD = 'held-pile'

// Cards as one pile, the first on top, with how many there are.
function Stack({ cards, className = '' }: { cards: CardFace[]; className?: string }) {
  const shown = cards.slice(0, 5).reverse()
  return (
    <div className={`relative h-full w-full ${className}`} data-testid="stack">
      {shown.map((c, i) => {
        const depth = shown.length - 1 - i
        return (
          <div key={c.iid} className="absolute inset-0 rounded-[5%] shadow-lg shadow-black/70" style={{ transform: `translate(${depth * 7}%, ${depth * 5}%) rotate(${depth * 2.5}deg)` }}>
            <CardView card={c} showFace />
          </div>
        )
      })}
      {cards.length > 1 && <span className="absolute -right-2 -top-2 z-10 rounded-full bg-gold px-2 py-0.5 font-display text-sm font-bold text-bg">{cards.length}</span>}
    </div>
  )
}

// The cards selected out of a list, waiting at the side of the table to be
// dragged onto it (or placed with a click on a zone).
function HeldPile({ cards, hidden }: { cards: CardFace[]; hidden?: boolean }) {
  const { setNodeRef, listeners } = useDraggable({ id: HELD })
  return (
    <div className={`panel absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-2 p-3 pr-5 ${hidden ? 'opacity-30' : ''}`} data-testid="held-pile">
      <div
        ref={setNodeRef}
        className="aspect-[1/1.46] w-20 cursor-grab touch-none text-xs"
        onPointerDown={(e) => {
          e.stopPropagation()
          listeners?.onPointerDown?.(e)
        }}
      >
        <Stack cards={cards} />
      </div>
      <p className="text-xs text-muted">Drag onto the table</p>
    </div>
  )
}

function BoardCard({ card, selected, lit, onClick, canDrag, gathered }: { card: PlacedCard; selected: boolean; lit: boolean; onClick: () => void; canDrag: boolean; gathered?: boolean }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: card.iid,
    disabled: !canDrag,
  })
  // No hover lift up close: its brightness filter makes the browser redraw the card from a small, soft copy.
  const close = useContext(FullArt)
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
      className={`absolute text-[1.6cqw] transition-[left,top,translate] duration-300 ease-out motion-reduce:transition-none ${close ? '' : 'hover:-translate-y-[0.4cqw] hover:brightness-110'} ${inPile ? 'pointer-events-none' : ''} ${
        canDrag ? 'cursor-grab touch-none' : 'cursor-pointer'
      } ${isDragging || gathered ? 'opacity-30' : ''}`}
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
        <Tooltip.Content side="top" sideOffset={6} className="panel z-50 pointer-coarse:hidden px-2 py-1 font-display text-xs font-semibold text-ink">
          {card.name}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
