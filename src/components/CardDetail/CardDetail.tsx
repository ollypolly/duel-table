// A card's art and rules text, in two sizes: compact (the pile viewer's side
// pane) and large (the inspector).
import { useState } from 'react'
import type { CardFace } from '../../view/boardView'
import { CardView } from '../CardView/CardView'

const describeModifier = (m: CardFace['modifiers'][number]) => {
  if (m.label) return m.label
  if (m.kind === 'name') return `Treated as "${m.value}"`
  if (m.kind === 'atk' || m.kind === 'def') {
    const stat = m.kind.toUpperCase()
    if (m.op === 'set') return `${stat} becomes ${m.value}`
    if (m.op === 'multiply') return `${stat} ×${m.value}`
    return `${stat} ${Number(m.value) >= 0 ? '+' : ''}${m.value}`
  }
  return m.kind.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

const UNTIL: Record<string, string> = {
  endOfTurn: 'until end of turn',
  endOfNextTurn: 'until end of next turn',
  leavesField: 'while on the field',
  permanent: '',
}

// The full-size art (or a drawn face for custom and face-down cards). Fills
// its parent, which sets the size.
export function CardArt({ card }: { card: CardFace }) {
  if (card.visible && card.imageFull) {
    return <img src={card.imageFull} alt={card.name} draggable={false} className="h-full w-full rounded-[4%] object-cover shadow-2xl shadow-black/70" />
  }
  return <CardView card={card} showFace={card.visible} />
}

export function CardInfo({ card, materials = [], large = false }: { card: CardFace; materials?: CardFace[]; large?: boolean }) {
  if (!card.visible) return <p className="text-sm text-muted">Face-down card</p>
  const d = card.data
  const stars = d?.level ?? d?.rank
  return (
    <div className={large ? 'space-y-4' : 'space-y-3'} data-testid="card-detail">
      <div className="space-y-1">
        <h2 className={`font-display font-bold leading-tight ${large ? 'text-3xl' : 'text-base'}`}>{card.name}</h2>
        {card.name !== card.baseName && <p className="text-xs text-warn">(really {card.baseName})</p>}
        <p className={`text-muted ${large ? 'text-sm' : 'text-xs'}`}>
          {[d?.attribute, d?.race, d?.type ?? card.custom?.kind, stars && `${d?.rank ? 'Rank' : 'Level'} ${stars}`, d?.linkval && `Link ${d.linkval}`]
            .filter(Boolean)
            .join(' · ')}
          {card.set && ' · set face-down'}
        </p>
      </div>
      {card.baseAtk !== undefined && (
        <p className={`font-display font-semibold tracking-wide ${large ? 'text-xl' : 'text-sm'}`}>
          <span className="text-muted">ATK</span> <Stat value={card.atk} base={card.baseAtk} />
          {card.baseDef !== undefined && (
            <>
              <span className="mx-2 text-faint">/</span>
              <span className="text-muted">DEF</span> <Stat value={card.def} base={card.baseDef} />
            </>
          )}
        </p>
      )}
      {card.modifiers.length > 0 && (
        <ul className="space-y-1 rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
          {card.modifiers.map((m) => (
            <li key={m.id}>
              {describeModifier(m)} <span className="opacity-60">{UNTIL[m.until]}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={`whitespace-pre-line text-ink/90 ${large ? 'text-base leading-relaxed' : 'text-[13px] leading-snug'}`}>{d?.desc ?? card.custom?.text}</p>
      {materials.length > 0 && (
        <div className="text-xs text-ink/80">
          <p className="font-semibold">Materials ({materials.length})</p>
          <ul className="list-inside list-disc">
            {materials.map((m) => (
              <li key={m.iid}>{m.name}</li>
            ))}
          </ul>
        </div>
      )}
      {card.custom && <p className="text-xs text-faint">Custom card (not in the card database)</p>}
      {import.meta.env.DEV && <CopyIid iid={card.iid} />}
    </div>
  )
}

function Stat({ value, base }: { value?: number; base?: number }) {
  if (value === base) return <span>{value ?? '?'}</span>
  return (
    <span className="text-warn" title={`Base ${base}`}>
      {value} <span className="text-faint line-through">{base}</span>
    </span>
  )
}

// Dev-only authoring aid: scenario steps refer to cards by iid.
function CopyIid({ iid }: { iid: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="rounded bg-raised px-2 py-1 font-mono text-xs text-muted hover:text-ink"
      onClick={() => {
        void navigator.clipboard?.writeText(iid)
        setCopied(true)
        setTimeout(() => setCopied(false), 1000)
      }}
      title="Copy iid (for scenario authoring)"
    >
      {copied ? 'copied' : iid}
    </button>
  )
}
