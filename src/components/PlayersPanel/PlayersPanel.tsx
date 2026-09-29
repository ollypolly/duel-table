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

// LP, turn, phase and the current chain. DOM around the board, so it's shared
// by any renderer. With onPhase (free-play), the phase chips are buttons.
export function PlayersPanel({ view, onPhase }: { view: BoardView; onPhase?: (phase: Phase) => void }) {
  const row = (p: Player) => (
    <div
      className={`flex items-baseline justify-between rounded-lg px-3 py-2 ${view.activePlayer === p ? 'bg-sky-900/60 ring-1 ring-sky-400/50' : 'bg-slate-800/60'}`}
    >
      <span className="text-sm">{view.players[p].name}</span>
      <span className="font-mono text-xl font-bold" data-testid={`lp-${p}`}>
        {view.players[p].lp}
      </span>
    </div>
  )
  return (
    <div className="space-y-2 text-slate-100">
      {row('p2')}
      <div className="rounded-lg bg-slate-800/60 px-3 py-2 text-center">
        <p className="text-xs text-slate-400">
          Turn {view.turn} · {view.players[view.activePlayer].name}
        </p>
        <div className="mt-1 flex justify-center gap-1">
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
        </div>
      </div>
      {view.chain.length > 0 && (
        <div className="rounded-lg border border-fuchsia-400/40 bg-fuchsia-950/40 px-3 py-2" data-testid="chain">
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
      )}
      {row('p1')}
    </div>
  )
}
