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
  const lp = (p: Player) => (
    <span className={`flex items-baseline gap-1.5 ${view.activePlayer === p ? 'text-sky-200' : 'text-slate-300'}`}>
      <span className="text-xs">{view.players[p].name}</span>
      <span className="font-mono text-base font-bold" data-testid={`lp-${p}`}>
        {view.players[p].lp}
      </span>
      {!!lpChanges[p] && (
        <span className={`font-mono text-xs ${lpChanges[p] < 0 ? 'text-rose-400' : 'text-emerald-400'}`} data-testid={`lp-change-${p}`}>
          {lpChanges[p] > 0 && '+'}
          {lpChanges[p]}
        </span>
      )}
    </span>
  )
  return (
    <div className="flex items-center gap-4 text-sm">
      {lp('p2')}
      <span className="flex items-center gap-2">
        <span className="text-xs text-slate-400">
          Turn {view.turn} · {view.players[view.activePlayer].name}
        </span>
        <span className="flex gap-0.5">
          {PHASES.map(([phase, short]) => (
            <button
              type="button"
              key={phase}
              disabled={!onPhase || view.phase === phase}
              onClick={() => onPhase?.(phase)}
              className={`rounded px-1.5 py-0.5 font-mono text-xs ${view.phase === phase ? 'bg-sky-500 text-white' : 'text-slate-500'} ${onPhase ? 'enabled:hover:bg-slate-700 enabled:hover:text-slate-200' : ''}`}
            >
              {short}
            </button>
          ))}
        </span>
      </span>
      {lp('p1')}
    </div>
  )
}

// The current chain, newest link first.
export function ChainList({ view }: { view: BoardView }) {
  if (view.chain.length === 0) return null
  return (
    <div className="rounded-lg border border-fuchsia-400/40 bg-fuchsia-950/60 px-3 py-2" data-testid="chain">
      <p className="text-xs font-semibold text-fuchsia-300">Chain</p>
      <ol className="mt-1 space-y-0.5 text-xs">
        {[...view.chain].reverse().map((l) => (
          <li key={l.number}>
            <span className="font-mono text-fuchsia-300">CL{l.number}</span> {l.label ?? l.card.name}{' '}
            <span className="text-slate-400">({view.players[l.player].name})</span>
          </li>
        ))}
      </ol>
      <p className="mt-1 text-[10px] text-slate-400">Resolves top to bottom (last in, first out)</p>
    </div>
  )
}
