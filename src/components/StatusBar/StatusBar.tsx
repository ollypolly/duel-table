import type { Phase, Player } from '../../engine'
import type { BoardView } from '../../view/boardView'

const PHASES = [
  ['draw', 'DP'],
  ['standby', 'SP'],
  ['main1', 'M1'],
  ['battle', 'BP'],
  ['main2', 'M2'],
  ['end', 'EP'],
] as const

// LP, turn and phase for the header. With onPhase (free-play), the phase
// chips are buttons.
export function StatusBar({
  view,
  lpChanges = {},
  onPhase,
}: {
  view: BoardView
  lpChanges?: Partial<Record<Player, number>> // LP change in the current step
  onPhase?: (phase: Phase) => void
}) {
  const lp = (p: Player) => {
    const active = view.activePlayer === p
    return (
      <div className={`flex items-center gap-2 ${p === 'p1' ? 'flex-row-reverse text-right' : ''}`}>
        <span className={`h-7 w-1 rounded-full ${p === 'p1' ? 'bg-p1' : 'bg-p2'} ${active ? 'shadow-[0_0_10px_currentColor]' : 'opacity-40'}`} />
        <div className="leading-none">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">{view.players[p].name}</div>
          <div className="flex items-baseline gap-1.5">
            <span className={`font-display text-xl font-bold tabular-nums ${active ? 'text-ink' : 'text-ink/70'}`} data-testid={`lp-${p}`}>
              {view.players[p].lp}
            </span>
            {!!lpChanges[p] && (
              <span className={`font-display text-xs font-semibold ${lpChanges[p] < 0 ? 'text-danger' : 'text-ok'}`} data-testid={`lp-change-${p}`}>
                {lpChanges[p] > 0 && '+'}
                {lpChanges[p]}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:gap-5">
      {lp('p2')}
      <div className="flex flex-col items-center gap-1">
        <span className="font-display text-[11px] font-semibold uppercase tracking-widest text-muted">
          Turn {view.turn} · <span className={view.activePlayer === 'p1' ? 'text-p1' : 'text-p2'}>{view.players[view.activePlayer].name}</span>
        </span>
        <span className="flex gap-0.5 rounded-md border border-line bg-surface p-0.5">
          {PHASES.map(([phase, short]) => (
            <button
              type="button"
              key={phase}
              disabled={!onPhase || view.phase === phase}
              onClick={() => onPhase?.(phase)}
              className={`rounded px-1.5 py-0.5 font-display text-[11px] font-bold ${view.phase === phase ? 'bg-gold text-bg' : 'text-faint'} ${onPhase ? 'enabled:hover:bg-raised enabled:hover:text-ink' : ''}`}
            >
              {short}
            </button>
          ))}
        </span>
      </div>
      {lp('p1')}
    </div>
  )
}

// The current chain, newest link first.
export function ChainList({ view }: { view: BoardView }) {
  if (view.chain.length === 0) return null
  return (
    <div className="panel px-3 py-2" data-testid="chain">
      <p className="font-display text-xs font-bold uppercase tracking-widest text-chain">Chain</p>
      <ol className="mt-1 space-y-0.5 text-xs">
        {[...view.chain].reverse().map((l) => (
          <li key={l.number}>
            <span className="font-display font-bold text-chain">CL{l.number}</span> {l.label ?? l.card.name} <span className="text-muted">({view.players[l.player].name})</span>
          </li>
        ))}
      </ol>
      <p className="mt-1 text-[10px] text-faint">Resolves top to bottom (last in, first out)</p>
    </div>
  )
}
