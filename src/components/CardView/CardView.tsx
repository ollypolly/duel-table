import { useContext } from 'react'
import { isExtraFrame } from '../../data/cardDb'
import { useSleeve } from '../../store/cosmeticsStore'
import type { CardFace } from '../../view/boardView'
import { FullArt } from './fullArt'

const FRAME_COLOURS: Record<string, string> = {
  normal: 'bg-amber-200',
  effect: 'bg-orange-300',
  fusion: 'bg-violet-400',
  synchro: 'bg-slate-100',
  xyz: 'bg-neutral-800 text-white',
  link: 'bg-sky-700 text-white',
  ritual: 'bg-blue-300',
  spell: 'bg-spell text-white',
  trap: 'bg-trap text-white',
}

// One card, face or back. Sized by its parent (fills it).
export function CardView({ card, showFace }: { card: CardFace; showFace?: boolean }) {
  const face = showFace ?? card.visible
  const full = useContext(FullArt)
  const sleeve = useSleeve(card.owner, isExtraFrame(card.frame))
  if (!face) return <CardBack sleeve={sleeve} />
  if (card.image) {
    return <img src={(full && card.imageFull) || card.image} alt={card.name} draggable={false} className={`h-full w-full rounded-[4%] object-cover ${card.set ? 'opacity-60 saturate-50' : ''}`} />
  }
  return (
    <div
      className={`flex h-full w-full flex-col rounded-[4%] border border-black/30 p-[6%] text-[0.55em] leading-tight ${FRAME_COLOURS[card.frame] ?? 'bg-orange-300'} ${card.set ? 'opacity-60' : ''}`}
    >
      <div className="truncate font-bold">{card.name}</div>
      <div className="mt-[6%] flex-1 overflow-hidden text-[0.8em] opacity-80">{card.custom?.text}</div>
      {card.baseAtk !== undefined && (
        <div className="text-right font-mono text-[0.8em]">
          {card.baseAtk}/{card.baseDef ?? '?'}
        </div>
      )}
    </div>
  )
}

// The owner's sleeve (an image or a matte colour), or the classic brown back
// with its dark swirl, drawn rather than scanned.
function CardBack({ sleeve }: { sleeve?: string }) {
  if (sleeve?.startsWith('#')) {
    return <div className="h-full w-full rounded-[4%] border border-black/50 bg-linear-to-br from-white/15 to-black/20" style={{ backgroundColor: sleeve }} />
  }
  if (sleeve) return <img src={sleeve} alt="" draggable={false} className="h-full w-full rounded-[4%] border border-black/50 object-cover" />
  return (
    <div className="flex h-full w-full items-center justify-center rounded-[4%] border border-black/50 bg-[radial-gradient(ellipse_at_30%_20%,#9a5a22,#4a2410_55%,#1d0d06)]">
      <div className="h-[58%] w-[62%] rounded-[50%] border-[0.12em] border-gold/60 bg-[radial-gradient(circle_at_40%_35%,#3a2a24,#0c0806_70%)] shadow-[0_0_0.4em_rgb(0_0_0/0.8)_inset]" />
    </div>
  )
}
