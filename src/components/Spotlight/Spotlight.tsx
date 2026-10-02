// Cards Claude has lifted off the table to show: in a panel down the right
// of the screen, their text readable with the words it's about marked, and
// its line with them. A bar drains and the panel goes; pointing at it holds
// the bar, and a click on it (or Keep) keeps it until you close it. The cards
// a question is about stay (keep) while it's open.
import { Pin, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CardFace } from '../../view/boardView'
import { CardArt } from '../CardDetail/CardDetail'

// Long enough to read it all, at an easy pace.
const readMs = (words: number) => Math.min(60_000, 8000 + words * 450)

// The text with each phrase it has marked, whatever its case or spacing.
function Marked({ text, phrases = [] }: { text: string; phrases?: string[] }) {
  const each = phrases.map((p) => p.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')).filter(Boolean)
  if (!each.length) return text
  // Split on a capture group: the odd pieces are the matches.
  return text.split(new RegExp(`(${each.join('|')})`, 'i')).map((piece, i) =>
    i % 2 ? (
      <mark key={i} className="rounded-sm bg-gold/30 px-0.5 text-ink">
        {piece}
      </mark>
    ) : (
      piece
    ),
  )
}

const textOf = (card: CardFace) => card.data?.desc ?? card.custom?.text ?? ''

export function Spotlight({ cards, say, phrases, keep = false, onClose }: { cards: CardFace[]; say?: string; phrases?: string[]; keep?: boolean; onClose: () => void }) {
  const [kept, setKept] = useState(keep)
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const one = cards.length === 1
  const words = [say ?? '', ...cards.map(textOf)].join(' ').split(/\s+/).length
  return (
    <aside
      aria-label="Claude is showing you cards"
      className="panel fixed right-3 top-16 z-30 flex max-h-[45dvh] w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden sm:max-h-[calc(100dvh-5rem)]"
      onClick={() => setKept(true)}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      data-testid="spotlight"
    >
      <div className="flex items-start gap-2 p-3 pb-2">
        <p className="min-w-0 flex-1 text-sm">{say ?? 'Claude is showing you this.'}</p>
        {!kept && (
          <button type="button" className="btn flex shrink-0 items-center gap-1 px-1.5 text-xs" title="Keep this open">
            <Pin size={12} aria-hidden />
            Keep
          </button>
        )}
        <button
          type="button"
          className="shrink-0 rounded p-1 text-muted hover:bg-raised hover:text-ink"
          aria-label="Close"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div className="h-0.5 shrink-0 bg-line">
        {!kept && <div className="h-full origin-left bg-gold" style={{ animation: `drain ${readMs(words)}ms linear forwards`, animationPlayState: held ? 'paused' : 'running' }} onAnimationEnd={onClose} data-testid="spotlight-timer" />}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {cards.map((card) => {
          const stats = card.baseAtk !== undefined ? `ATK ${card.atk ?? card.baseAtk}${card.baseDef !== undefined ? ` / DEF ${card.def ?? card.baseDef}` : ''}` : ''
          return (
            <article key={card.iid} className={`flex gap-3 ${one ? 'sm:flex-col' : ''}`}>
              <div className={`aspect-[59/86] w-24 shrink-0 self-start ${one ? 'sm:w-full' : ''}`}>
                <CardArt card={card} />
              </div>
              <div className="min-w-0 space-y-1">
                <h3 className="font-display text-sm font-bold leading-tight">{card.name}</h3>
                {stats && <p className="text-[11px] text-muted">{stats}</p>}
                <p className="whitespace-pre-line text-xs leading-snug text-ink/90">
                  <Marked text={textOf(card)} phrases={phrases} />
                </p>
              </div>
            </article>
          )
        })}
      </div>
    </aside>
  )
}
