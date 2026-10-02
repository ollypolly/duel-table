// Cards Claude has lifted off the table to show: big, side by side, their
// text readable with the words it's about marked, and its line under them.
// Closes on ✕, Esc or a click outside.
import { X } from 'lucide-react'
import { useEffect } from 'react'
import type { CardFace } from '../../view/boardView'
import { CardArt } from '../CardDetail/CardDetail'

// The text with the phrase marked, whatever its case or spacing.
function Marked({ text, phrase }: { text: string; phrase?: string }) {
  const words = phrase?.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const at = words?.length ? new RegExp(words.join('\\s+'), 'i').exec(text) : null
  if (!at) return text
  return (
    <>
      {text.slice(0, at.index)}
      <mark className="rounded-sm bg-gold/30 px-0.5 text-ink">{at[0]}</mark>
      {text.slice(at.index + at[0].length)}
    </>
  )
}

export function Spotlight({ cards, say, phrase, onClose }: { cards: CardFace[]; say?: string; phrase?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div role="dialog" aria-label="Claude is showing you cards" className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-bg/70 pad-safe backdrop-blur-md sm:[--pad:2rem]" onClick={onClose} data-testid="spotlight">
      <div className="flex max-h-full min-h-0 w-full snap-x snap-mandatory gap-4 overflow-x-auto sm:w-auto sm:max-w-full" onClick={(e) => e.stopPropagation()}>
        {cards.map((card) => {
          const text = card.data?.desc ?? card.custom?.text ?? ''
          const stats = card.baseAtk !== undefined ? `ATK ${card.atk ?? card.baseAtk}${card.baseDef !== undefined ? ` / DEF ${card.def ?? card.baseDef}` : ''}` : ''
          return (
            <article key={card.iid} className="flex w-[min(17rem,78vw)] shrink-0 snap-center flex-col gap-2 first:ml-auto last:mr-auto">
              <div className="aspect-[59/86] w-full">
                <CardArt card={card} />
              </div>
              <div className="panel min-h-0 space-y-1 overflow-y-auto p-3">
                <h3 className="font-display text-sm font-bold leading-tight">{card.name}</h3>
                {stats && <p className="text-[11px] text-muted">{stats}</p>}
                <p className="whitespace-pre-line text-xs leading-snug text-ink/90">
                  <Marked text={text} phrase={phrase} />
                </p>
              </div>
            </article>
          )
        })}
      </div>
      <div className="panel flex w-full max-w-2xl shrink-0 items-start gap-3 p-3" onClick={(e) => e.stopPropagation()}>
        <p className="min-w-0 flex-1 text-sm">{say ?? 'Claude is showing you these.'}</p>
        <button type="button" className="rounded p-1 text-muted hover:bg-raised hover:text-ink" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
