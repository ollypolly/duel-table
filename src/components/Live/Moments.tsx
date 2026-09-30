// The key moments Claude marked in a review, like the ?? and ! on a chess
// review: a row to step through, with the one you're on spelled out.
import type { Moment } from '../../api/review'
import { atMoment, MOMENT } from './moment'

export function Moments({ moments, names, position, onGo }: { moments: Moment[]; names: Record<Moment['player'], string>; position: number; onGo: (step: number) => void }) {
  if (!moments.length) return null
  const here = moments.find((m) => atMoment(m, position))
  return (
    <div className="shrink-0 space-y-1.5 border-b border-line px-3 py-2" data-testid="moments">
      <div className="flex gap-1.5 overflow-x-auto" role="list" aria-label="Key moments">
        {moments.map((m) => (
          <button
            key={m.step}
            type="button"
            role="listitem"
            onClick={() => onGo(m.step)}
            title={`Step ${m.step} · ${MOMENT[m.kind].label} by ${names[m.player]}: ${m.title}`}
            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs tabular-nums ${MOMENT[m.kind].text} ${m === here ? 'bg-raised ring-1 ring-gold' : 'hover:bg-raised'}`}
          >
            <span className="font-bold">{MOMENT[m.kind].mark}</span> {m.step}
          </button>
        ))}
      </div>
      {here && (
        <p className="text-xs text-muted">
          <span className={MOMENT[here.kind].text.split(' ')[0]}>{MOMENT[here.kind].label}</span> by {names[here.player]}, step {here.step}: {here.title}
        </p>
      )}
    </div>
  )
}
