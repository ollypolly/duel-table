import type { ReactNode } from 'react'
import { SPEEDS } from '../../store/playerStore'

const btn = 'rounded-md px-2 py-1 text-sm hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent'

// One row pinned to the bottom: transport, scrubber, step jump, speed, and a
// slot for the screen's own actions (branch, go live…).
export function StepControls({
  position,
  labels,
  playing,
  speed,
  onGoTo,
  onPlaying,
  onSpeed,
  children,
}: {
  position: number
  labels: string[] // one per step
  playing: boolean
  speed: number
  onGoTo: (position: number) => void
  onPlaying: (playing: boolean) => void
  onSpeed: (speed: number) => void
  children?: ReactNode
}) {
  const last = labels.length
  return (
    <div className="flex items-center gap-2" data-testid="step-controls">
      <span className="flex">
        <button type="button" className={btn} onClick={() => onGoTo(0)} disabled={position === 0} title="First (Home)">
          ⏮
        </button>
        <button type="button" className={btn} onClick={() => onGoTo(position - 1)} disabled={position === 0} title="Previous (←)">
          ◁
        </button>
        <button type="button" className="mx-1 w-8 rounded-full bg-sky-600 py-1 text-sm text-white hover:bg-sky-500 disabled:opacity-30" onClick={() => onPlaying(!playing)} disabled={last === 0} title="Play/pause (space)">
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className={btn} onClick={() => onGoTo(position + 1)} disabled={position === last} title="Next (→)">
          ▷
        </button>
        <button type="button" className={btn} onClick={() => onGoTo(last)} disabled={position === last} title="Last (End)">
          ⏭
        </button>
      </span>
      <input
        type="range"
        min={0}
        max={last}
        value={position}
        onChange={(e) => onGoTo(Number(e.target.value))}
        className="min-w-24 flex-1 accent-sky-500"
        aria-label="Step"
      />
      <select
        aria-label="Jump to step"
        className="max-w-[18rem] rounded bg-slate-800 px-1 py-1 text-xs"
        value={position}
        onChange={(e) => onGoTo(Number(e.target.value))}
      >
        {['Setup', ...labels].map((label, i) => (
          <option key={i} value={i}>
            {i === 0 ? label : `${i}/${last} · ${label}`}
          </option>
        ))}
      </select>
      <select aria-label="Speed" title="Speed" className="rounded bg-slate-800 px-1 py-1 text-xs" value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      {children}
    </div>
  )
}
