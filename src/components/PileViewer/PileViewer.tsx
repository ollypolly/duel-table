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
}: {
  zone: ZoneView
  playerName: string
  onClose: () => void
  onCardClick?: (iid: Iid) => boolean // whether it took the click
  cardActions?: (iid: Iid, close: () => void) => ReactNode
  onToHand?: (iid: Iid) => void // free play: a quick way to pull a card, with the pile left open
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
              Close
            </button>
          </span>
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3 overflow-y-auto p-4">
          {zone.count === 0 && <p className="col-span-full text-sm text-muted">Empty.</p>}
          {tiles.map(({ c, copies, iids, i }) => (
            <div key={c.iid} className="group relative text-left">
              <button type="button" className="block w-full text-left" onClick={() => onCardClick?.(c.iid) || setPinned(c.iid)}>
                <div className={`relative aspect-[1/1.46] text-base transition group-hover:scale-105 ${copies > 1 ? 'rounded-md shadow-[4px_4px_0_var(--color-line),8px_8px_0_var(--color-line)]' : ''}`}>
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
      <CardInspector card={face(pinned)} materialsOf={() => []} onClose={() => setPinned(undefined)} actions={pinned && cardActions?.(pinned, onClose)} />
    </dialog>
  )
}
