import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Iid } from '../../engine'
import type { ZoneView } from '../../view/boardView'
import { CardInspector } from '../CardInspector/CardInspector'
import { CardView } from '../CardView/CardView'

// Lists a pile's contents, top first. This is a learning tool, so even your
// Deck and Extra Deck are shown face-up. Clicking a card opens the same
// inspector as the board (inside the dialog, because a modal dialog sits
// above everything outside it), with what you can do with it from cardActions,
// unless onCardClick takes the click (free play picks the card up, a game
// picks it for a prompt).
export function PileViewer({
  zone,
  playerName,
  onClose,
  onCardClick,
  cardActions,
  onToHand,
  onPickAll,
  picked,
  onPick,
}: {
  zone: ZoneView
  playerName: string
  onClose: () => void
  onCardClick?: (iid: Iid) => boolean // whether it took the click
  cardActions?: (iid: Iid, close: () => void) => ReactNode
  onPickAll?: (iids: Iid[]) => void // free play: a grouped tile picks up all its copies to place together
  onToHand?: (iid: Iid) => void // free play: a quick way to pull a card, with the pile left open
  picked?: Iid[] // free play with Select on: a click adds a tile to the selection, or takes it back out
  onPick?: (iids: Iid[]) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [pinned, setPinned] = useState<Iid>()
  const [grouped, setGrouped] = useState(!!onToHand)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const hidden = zone.ref.player === 'p2' && (zone.ref.zone === 'deck' || zone.ref.zone === 'extraDeck')
  const face = (iid?: Iid) => {
    const c = zone.cards.find((c) => c.iid === iid)
    return c && { ...c, visible: !hidden || c.visible }
  }
  // Grouped: one tile per card name, in name order, with how many copies.
  const tiles =
    grouped && !hidden
      ? Object.values(zone.cards.reduce<Record<string, typeof zone.cards>>((by, c) => ({ ...by, [c.name]: [...(by[c.name] ?? []), c] }), {}))
          .sort((a, b) => a[0].name.localeCompare(b[0].name))
          .map((copies) => ({ c: copies[0], copies: copies.length, iids: copies.map((x) => x.iid), i: -1 }))
      : zone.cards.map((c, i) => ({ c, copies: 1, iids: [c.iid], i }))
  const isPicked = (iids: Iid[]) => iids.every((iid) => picked?.includes(iid))
  const held = zone.cards.filter((c) => picked?.includes(c.iid)).length
  // With Select on, a drag across the list boxes tiles into the selection,
  // the same as on the table. It becomes a box once it has moved a few px.
  const press = useRef<{ x: number; y: number }>(undefined)
  const swallow = useRef(false)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number }>()
  const boxing = onPick && {
    onPointerDown: (e: React.PointerEvent) => {
      press.current = e.button === 0 && e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY } : undefined
    },
    onPointerMove: (e: React.PointerEvent) => {
      const from = press.current
      if (box) return setBox({ ...box, x1: e.clientX, y1: e.clientY })
      if (!from || Math.hypot(e.clientX - from.x, e.clientY - from.y) < 6) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setBox({ x0: from.x, y0: from.y, x1: e.clientX, y1: e.clientY })
    },
    onPointerUp: (e: React.PointerEvent) => {
      press.current = undefined
      if (!box) return
      setBox(undefined)
      const [l, t, r, b] = [Math.min(box.x0, box.x1), Math.min(box.y0, box.y1), Math.max(box.x0, box.x1), Math.max(box.y0, box.y1)]
      const hit = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-tile]')].filter((el) => {
        const c = el.getBoundingClientRect()
        return c.left < r && c.right > l && c.top < b && c.bottom > t
      })
      const add = hit.flatMap((el) => tiles[Number(el.dataset.tile)].iids).filter((iid) => !picked?.includes(iid))
      if (add.length) onPick(add)
      swallow.current = true
      setTimeout(() => (swallow.current = false))
    },
    onPointerCancel: () => {
      press.current = undefined
      setBox(undefined)
    },
    // The click that ends a box isn't a click on the tile under it.
    onClickCapture: (e: React.MouseEvent) => {
      if (!swallow.current) return
      swallow.current = false
      e.stopPropagation()
    },
  }
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Esc unpins the inspector first, then closes the viewer.
      onCancel={(e) => {
        if (!pinned) return
        e.preventDefault()
        setPinned(undefined)
      }}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="m-0 h-auto max-h-none w-auto max-w-none place-items-center bg-transparent p-0 text-ink open:grid backdrop:bg-bg/70 backdrop:backdrop-blur-md"
    >
      <div className="panel flex h-[min(80vh,calc(var(--safe-h)-2rem))] w-[min(64rem,94vw)] flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display font-semibold">
            {playerName === 'You' ? 'Your' : `${playerName}'s`} {zone.label} <span className="text-muted">({zone.count})</span>
          </h2>
          <span className="flex items-center gap-2">
            {!hidden && (
              <label className="flex items-center gap-1.5 text-xs text-muted" title="One tile per card, with how many copies, in name order">
                <input type="checkbox" className="accent-gold" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
                Group copies
              </label>
            )}
            <button type="button" className="btn" onClick={() => ref.current?.close()}>
              {held ? `Take ${held}` : 'Close'}
            </button>
          </span>
        </div>
        <div className={`grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3 overflow-y-auto p-4 ${onPick ? 'cursor-crosshair select-none' : ''}`} {...boxing}>
          {zone.count === 0 && <p className="col-span-full text-sm text-muted">Empty.</p>}
          {tiles.map(({ c, copies, iids, i }, n) => (
            <div key={c.iid} data-tile={n} className="group relative text-left">
              <button type="button" className="block w-full text-left" aria-pressed={onPick && isPicked(iids)} onClick={() => (onPick ? onPick(iids) : onPickAll && copies > 1 ? onPickAll(iids) : onCardClick?.(c.iid) || setPinned(c.iid))}>
                <div className={`relative aspect-[1/1.46] text-base transition group-hover:scale-105 ${copies > 1 ? 'rounded-md shadow-[4px_4px_0_var(--color-line),8px_8px_0_var(--color-line)]' : ''} ${isPicked(iids) ? 'rounded-md outline outline-2 outline-offset-2 outline-accent' : ''}`}>
                  <CardView card={c} showFace={!hidden || c.visible} />
                  {copies > 1 && <span className="absolute right-1 top-1 rounded-full bg-gold px-1.5 py-0.5 font-display text-xs font-bold text-bg">×{copies}</span>}
                </div>
                <p className="mt-1 truncate text-xs text-ink/80">
                  {zone.ref.zone === 'deck' && i === 0 ? 'Top: ' : ''}
                  {!hidden || c.visible ? c.name : 'Face-down'}
                </p>
              </button>
              {onToHand && (
                <span className="mt-1 flex gap-1">
                  <button type="button" className="btn min-w-0 flex-1 justify-center text-xs" onClick={() => onToHand(c.iid)}>
                    To hand
                  </button>
                  {copies > 1 && (
                    <button type="button" className="btn justify-center text-xs" title={`All ${copies} copies to hand`} onClick={() => iids.forEach(onToHand)}>
                      All {copies}
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      {/* Outside the panel, whose blur would otherwise anchor a fixed box to itself. */}
      {box && (
        <div
          className="pointer-events-none fixed z-10 rounded-sm border border-accent bg-accent/15"
          data-testid="list-marquee"
          style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }}
        />
      )}
      <CardInspector card={face(pinned)} materialsOf={() => []} onClose={() => setPinned(undefined)} actions={pinned && cardActions?.(pinned, onClose)} />
    </dialog>
  )
}
