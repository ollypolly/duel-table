// The key moments Claude marked in a review, as a game review steps through
// them: Previous and Next either side of the moment you're on, in the
// playback bar. locked: ones that can't be gone to just now; busy: Claude is
// answering.
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { Moment } from '../../api/review'
import { atMoment, MOMENT } from './moment'

export function Moments({
  moments,
  names,
  position,
  onGo,
  locked = () => false,
  busy,
}: {
  moments: Moment[]
  names: Record<Moment['player'], string>
  position: number
  onGo: (step: number) => void
  locked?: (m: Moment) => boolean
  busy?: boolean
}) {
  if (!moments.length) return null
  const here = moments.find((m) => atMoment(m, position))
  // You're shown a moment from the step before it.
  const before = moments.findLast((m) => m !== here && m.step - 1 < position)
  const after = moments.find((m) => m !== here && m.step - 1 > position)
  return (
    <div className="space-y-1.5 px-1" data-testid="moments">
      <div className="flex items-center gap-2">
        <button type="button" className="btn h-8 shrink-0 pl-1.5" onClick={() => before && onGo(before.step)} disabled={!before || locked(before)}>
          <ChevronLeft size={15} /> Previous
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-xs" aria-live="polite" aria-busy={busy}>
          {busy && <Loader2 size={13} className="mr-1.5 inline animate-spin align-[-2px] text-gold" aria-label="Claude is answering" />}
          {here ? (
            <>
              <span className={`font-bold ${MOMENT[here.kind].text.split(' ')[0]}`}>
                {MOMENT[here.kind].mark} {MOMENT[here.kind].label}
              </span>{' '}
              <span className="text-faint tabular-nums">
                {moments.indexOf(here) + 1} of {moments.length}
              </span>
            </>
          ) : (
            <span className="text-muted">
              {moments.length} key moment{moments.length === 1 ? '' : 's'}
            </span>
          )}
        </p>
        <button type="button" className="btn btn-primary h-8 shrink-0 pr-1.5" onClick={() => after && onGo(after.step)} disabled={!after || locked(after)}>
          Next <ChevronRight size={15} />
        </button>
      </div>
      {here && (
        <p className="line-clamp-2 px-1 text-xs text-muted">
          {names[here.player]}, step {here.step}: {here.title}
        </p>
      )}
    </div>
  )
}
