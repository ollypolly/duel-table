import { SPEEDS } from '../../store/playerStore'

const btn = 'rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800'

export function StepControls({
  position,
  labels,
  playing,
  speed,
  onGoTo,
  onPlaying,
  onSpeed,
}: {
  position: number
  labels: string[] // one per step
  playing: boolean
  speed: number
  onGoTo: (position: number) => void
  onPlaying: (playing: boolean) => void
  onSpeed: (speed: number) => void
}) {
  const last = labels.length
  return (
    <div className="space-y-2 rounded-lg bg-slate-900 p-3" data-testid="step-controls">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => onGoTo(0)} disabled={position === 0} title="First (Home)">
          ⏮
        </button>
        <button type="button" className={btn} onClick={() => onGoTo(position - 1)} disabled={position === 0} title="Previous (←)">
          ◀
        </button>
        <button
          type="button"
          className={`${btn} w-20`}
          onClick={() => onPlaying(!playing)}
          disabled={last === 0}
          title="Play/pause (space)"
        >
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button type="button" className={btn} onClick={() => onGoTo(position + 1)} disabled={position === last} title="Next (→)">
          ▶
        </button>
        <button type="button" className={btn} onClick={() => onGoTo(last)} disabled={position === last} title="Last (End)">
          ⏭
        </button>
        <label className="ml-auto flex items-center gap-1 text-xs text-slate-400">
          Speed
          <select
            className="rounded bg-slate-800 px-1 py-1 text-slate-100"
            value={speed}
            onChange={(e) => onSpeed(Number(e.target.value))}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
      </div>
      <input
        type="range"
        min={0}
        max={last}
        value={position}
        onChange={(e) => onGoTo(Number(e.target.value))}
        className="w-full accent-sky-500"
        aria-label="Step"
      />
      <ol className="flex gap-1 overflow-x-auto pb-1 text-xs">
        {['Setup', ...labels].map((label, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onGoTo(i)}
              className={`whitespace-nowrap rounded px-2 py-0.5 ${i === position ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-100'}`}
              aria-current={i === position ? 'step' : undefined}
            >
              {i > 0 && <span className="mr-1 font-mono opacity-60">{i}</span>}
              {label}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
