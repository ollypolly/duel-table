import { useEffect, useRef, useState } from 'react'
import type { Iid } from '../../engine'
import type { ZoneView } from '../../view/boardView'
import { CardInspector } from '../CardInspector/CardInspector'
import { CardView } from '../CardView/CardView'

// Lists a pile's contents, top first. This is a learning tool, so even your
// Deck and Extra Deck are shown face-up. Clicking a card opens the same
// inspector as the board (inside the dialog, because a modal dialog sits
// above everything outside it), unless onCardClick takes the click (free
// play picks the card up).
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
  const [pinned, setPinned] = useState<Iid>()
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const hidden = zone.ref.player === 'p2' && (zone.ref.zone === 'deck' || zone.ref.zone === 'extraDeck')
  const face = (iid?: Iid) => {
    const c = zone.cards.find((c) => c.iid === iid)
    return c && { ...c, visible: !hidden || c.visible }
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
      className="m-0 h-full max-h-none w-full max-w-none place-items-center bg-transparent p-0 text-ink open:grid backdrop:bg-bg/70 backdrop:backdrop-blur-md"
    >
      <div className="panel flex h-[80vh] w-[min(64rem,94vw)] flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display font-semibold">
            {playerName === 'You' ? 'Your' : `${playerName}'s`} {zone.label} <span className="text-muted">({zone.count})</span>
          </h2>
          <button type="button" className="btn" onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3 overflow-y-auto p-4">
          {zone.count === 0 && <p className="col-span-full text-sm text-muted">Empty.</p>}
          {zone.cards.map((c, i) => (
            <button
              key={c.iid}
              type="button"
              className="group text-left"
              onClick={() => (onCardClick ? onCardClick(c.iid) : setPinned(c.iid))}
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
      </div>
      <CardInspector card={face(pinned)} materialsOf={() => []} onClose={() => setPinned(undefined)} />
    </dialog>
  )
}
