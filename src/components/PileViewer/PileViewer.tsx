import { useEffect, useRef, useState } from 'react'
import type { Iid } from '../../engine'
import type { ZoneView } from '../../view/boardView'
import { CardArt, CardInfo } from '../CardDetail/CardDetail'
import { CardView } from '../CardView/CardView'

// Lists a pile's contents, top first. This is a learning tool, so even your
// Deck and Extra Deck are shown face-up. The modal dialog sits above the
// inspector, so it shows the hovered card's details itself.
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
      className="panel m-auto h-[80vh] w-[min(72rem,94vw)] flex-col p-0 text-ink open:flex backdrop:bg-bg/70 backdrop:backdrop-blur-md"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-display font-semibold">
          {playerName === 'You' ? 'Your' : `${playerName}'s`} {zone.label} <span className="text-muted">({zone.count})</span>
        </h2>
        <button type="button" className="btn" onClick={() => ref.current?.close()}>
          Close
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
      <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3 overflow-y-auto p-4">
        {zone.count === 0 && <p className="col-span-full text-sm text-muted">Empty.</p>}
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
            <p className="mt-1 truncate text-xs text-ink/80">
              {zone.ref.zone === 'deck' && i === 0 ? 'Top: ' : ''}
              {!hidden || c.visible ? c.name : 'Face-down'}
            </p>
          </button>
        ))}
      </div>
      <aside className="hidden w-80 shrink-0 sm:block overflow-y-auto border-l border-line">
        {shown ? (
          <div className="space-y-3 p-4">
            <div className="mx-auto aspect-[1/1.46] w-40 text-xl">
              <CardArt card={{ ...shown, visible: !hidden || shown.visible }} />
            </div>
            <CardInfo card={{ ...shown, visible: !hidden || shown.visible }} />
          </div>
        ) : (
          <p className="p-4 text-sm text-muted">Hover a card to read it.</p>
        )}
      </aside>
      </div>
    </dialog>
  )
}
