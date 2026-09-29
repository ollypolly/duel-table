import type { CardFace } from '../../view/boardView'

const FRAME_COLOURS: Record<string, string> = {
  normal: 'bg-amber-200',
  effect: 'bg-orange-300',
  fusion: 'bg-violet-400',
  synchro: 'bg-slate-100',
  xyz: 'bg-neutral-800 text-white',
  link: 'bg-sky-700 text-white',
  ritual: 'bg-blue-300',
  spell: 'bg-teal-500 text-white',
  trap: 'bg-pink-700 text-white',
}

// One card, face or back. Sized by its parent (fills it).
export function CardView({ card, showFace }: { card: CardFace; showFace?: boolean }) {
  const face = showFace ?? card.visible
  if (!face) return <CardBack />
  if (card.image) {
    return (
      <img
        src={card.image}
        alt={card.name}
        draggable={false}
        className={`h-full w-full rounded-[4%] object-cover ${card.set ? 'opacity-60 saturate-50' : ''}`}
      />
    )
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

export function CardBack() {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-[4%] border border-black/40 bg-gradient-to-br from-amber-900 to-stone-900">
      <div className="h-[55%] w-[60%] rounded-[50%] border-2 border-amber-600/60 bg-gradient-to-br from-stone-800 to-amber-950" />
    </div>
  )
}
