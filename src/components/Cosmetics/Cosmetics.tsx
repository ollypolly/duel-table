// Pick each seat's sleeves, deck box and playmat from image files.
import { useRef, useState } from 'react'
import { PLAYERS, type Player } from '../../engine'
import { useCosmeticsStore, type Cosmetic } from '../../store/cosmeticsStore'

const SLOTS: { kind: Cosmetic; label: string; aspect: string }[] = [
  { kind: 'sleeve', label: 'Sleeves', aspect: 'aspect-[1/1.46]' },
  { kind: 'deckBox', label: 'Deck box', aspect: 'aspect-[1/1.3]' },
  { kind: 'playmat', label: 'Playmat', aspect: 'aspect-[16/9]' },
]
const SEATS: Record<Player, string> = { p1: 'Bottom seat (you)', p2: 'Top seat (opponent)' }

export function CosmeticsButton() {
  const ref = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => {
          setOpen(true)
          ref.current?.showModal()
        }}
      >
        Sleeves & mats
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && ref.current.close()}
        className="panel m-auto w-[min(44rem,94vw)] p-0 text-ink backdrop:bg-bg/70 backdrop:backdrop-blur-md"
      >
        {open && (
          <div className="space-y-5 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Sleeves, deck boxes & playmats</h2>
              <button type="button" className="btn" onClick={() => ref.current?.close()}>
                Close
              </button>
            </div>
            {PLAYERS.map((p) => (
              <section key={p} className="space-y-2">
                <h3 className={`font-display text-xs font-semibold uppercase tracking-widest ${p === 'p1' ? 'text-p1' : 'text-p2'}`}>{SEATS[p]}</h3>
                <div className="grid grid-cols-[1fr_1fr_2fr] gap-3">
                  {SLOTS.map((s) => (
                    <Slot key={s.kind} player={p} {...s} />
                  ))}
                </div>
              </section>
            ))}
            <p className="text-xs text-faint">Images stay in this browser. JPEG, PNG or WebP.</p>
          </div>
        )}
      </dialog>
    </>
  )
}

function Slot({ player, kind, label, aspect }: { player: Player; kind: Cosmetic; label: string; aspect: string }) {
  const url = useCosmeticsStore((s) => s.cosmetics[player][kind])
  const setCosmetic = useCosmeticsStore((s) => s.set)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={`${aspect} grid w-full place-items-center overflow-hidden rounded-md border border-dashed border-line bg-raised/40 text-xs text-muted hover:border-gold hover:text-ink`}
        aria-label={`${label}: choose image`}
      >
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : `Choose ${label.toLowerCase()}`}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={`${SEATS[player]} ${label}`}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void setCosmetic(player, kind, file)
          e.target.value = ''
        }}
      />
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        {url && (
          <button type="button" className="text-faint hover:text-danger" onClick={() => void setCosmetic(player, kind, undefined)}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}
