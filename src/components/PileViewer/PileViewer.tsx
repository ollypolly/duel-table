import { useEffect, useRef, useState } from 'react'
import type { Iid } from '../../engine'
import type { ZoneView } from '../../view/boardView'
import { CardDetailPanel } from '../CardDetailPanel/CardDetailPanel'
import { CardView } from '../CardView/CardView'

// Lists a pile's contents, top first. This is a learning tool, so even your
// Deck and Extra Deck are shown face-up. The dialog sits above the card
// popover, so it shows the hovered card's details itself.
export function PileViewer({
  zone,
  playerName,
  onClose,
  onCardClick,
}: {
  zone: ZoneView
  playerName: string
  onClose: () => void
  onCardClick?: (iid: Iid) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [hovered, setHovered] = useState<Iid>()
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const shown = zone.cards.find((c) => c.iid === hovered)
  const hidden = zone.ref.player === 'p2' && (zone.ref.zone === 'deck' || zone.ref.zone === 'extraDeck')
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className="m-auto h-[80vh] w-[min(72rem,94vw)] flex-col rounded-xl open:flex bg-slate-900 p-0 text-slate-100 shadow-2xl backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <h2 className="font-semibold">
          {playerName === 'You' ? 'Your' : `${playerName}'s`} {zone.label} <span className="text-slate-400">({zone.count})</span>
        </h2>
        <button type="button" className="rounded px-2 text-slate-400 hover:text-white" onClick={() => ref.current?.close()}>
          Close
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
      <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3 overflow-y-auto p-4">
        {zone.count === 0 && <p className="col-span-full text-sm text-slate-400">Empty.</p>}
        {zone.cards.map((c, i) => (
          <button
            key={c.iid}
            type="button"
            className="group text-left"
            onClick={() => onCardClick?.(c.iid)}
            onMouseEnter={() => setHovered(c.iid)}
          >
            <div className="aspect-[1/1.46] text-base transition group-hover:scale-105">
              <CardView card={c} showFace={!hidden || c.visible} />
            </div>
            <p className="mt-1 truncate text-xs text-slate-300">
              {zone.ref.zone === 'deck' && i === 0 ? 'Top: ' : ''}
              {!hidden || c.visible ? c.name : 'Face-down'}
            </p>
          </button>
        ))}
      </div>
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-700">
        {shown ? <CardDetailPanel card={{ ...shown, visible: !hidden || shown.visible }} /> : <p className="p-4 text-sm text-slate-400">Hover a card to read it.</p>}
      </aside>
      </div>
    </dialog>
  )
}
