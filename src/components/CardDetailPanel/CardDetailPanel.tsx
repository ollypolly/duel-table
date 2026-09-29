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

export function CardDetailPanel({ card, materials = [] }: { card: CardFace; materials?: CardFace[] }) {
  if (!card.visible) {
    return (
      <aside className="space-y-3 p-4">
        <div className="mx-auto aspect-[1/1.46] w-28 text-xl">
          <CardView card={card} />
        </div>
        <p className="text-center text-sm text-slate-400">Face-down card</p>
      </aside>
    )
  }
  const d = card.data
  const stars = d?.level ?? d?.rank
  return (
    <aside className="space-y-3 p-4" data-testid="card-detail">
      <div className="flex gap-3 pr-5">
        <div className="aspect-[1/1.46] w-24 shrink-0 text-base">
          {card.imageFull ? (
            <img src={card.imageFull} alt={card.name} className="h-full w-full rounded object-cover shadow-lg" />
          ) : (
            <CardView card={card} showFace />
          )}
        </div>
        <div className="min-w-0 space-y-1.5">
          <h2 className="font-bold leading-tight">{card.name}</h2>
          {card.name !== card.baseName && <p className="text-xs text-amber-300">(really {card.baseName})</p>}
          <p className="text-xs text-slate-400">
            {[d?.attribute, d?.race, d?.type ?? card.custom?.kind, stars && `${d?.rank ? 'Rank' : 'Level'} ${stars}`, d?.linkval && `Link ${d.linkval}`]
              .filter(Boolean)
              .join(' · ')}
            {card.set && ' · set face-down'}
          </p>
          {card.baseAtk !== undefined && (
            <p className="font-mono text-xs">
              ATK <Stat value={card.atk} base={card.baseAtk} />
              {card.baseDef !== undefined && (
                <>
                  {' '}
                  / DEF <Stat value={card.def} base={card.baseDef} />
                </>
              )}
            </p>
          )}
        </div>
      </div>
      {card.modifiers.length > 0 && (
        <ul className="space-y-1 rounded border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-200">
          {card.modifiers.map((m) => (
            <li key={m.id}>
              {describeModifier(m)} <span className="text-amber-200/60">{UNTIL[m.until]}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="whitespace-pre-line text-[13px] leading-snug text-slate-200">{d?.desc ?? card.custom?.text}</p>
      {materials.length > 0 && (
        <div className="text-xs text-slate-300">
          <p className="font-semibold">Materials ({materials.length})</p>
          <ul className="list-inside list-disc">
            {materials.map((m) => (
              <li key={m.iid}>{m.name}</li>
            ))}
          </ul>
        </div>
      )}
      {card.custom && <p className="text-xs text-slate-500">Custom card (not in the card database)</p>}
      {import.meta.env.DEV && <CopyIid iid={card.iid} />}
    </aside>
  )
}

function Stat({ value, base }: { value?: number; base?: number }) {
  if (value === base) return <span>{value ?? '?'}</span>
  return (
    <span className="text-amber-300" title={`Base ${base}`}>
      {value} <span className="text-slate-500 line-through">{base}</span>
    </span>
  )
}

// Dev-only authoring aid: scenario steps refer to cards by iid.
function CopyIid({ iid }: { iid: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="rounded bg-slate-800 px-2 py-1 font-mono text-xs text-slate-400 hover:text-slate-200"
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
