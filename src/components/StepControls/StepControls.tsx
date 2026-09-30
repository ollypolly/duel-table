import { ChevronDown, Pause, Play, SkipBack, SkipForward, StepBack, StepForward, Volume2, VolumeX } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { SPEEDS } from '../../store/playerStore'

const btn = 'grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent'

// The scene controls: a slim bar (back, play, forward, the current step), and
// a drawer with the rest (first/last, speed, the scrubber, the step list, and
// the screen's own actions: branch, go live…). Clicking the step opens it.
export function StepControls({
  position,
  labels,
  playing,
  speed,
  onGoTo,
  onPlaying,
  onSpeed,
  muted,
  onMuted,
  children,
}: {
  position: number
  labels: string[] // one per step
  playing: boolean
  speed: number
  onGoTo: (position: number) => void
  onPlaying: (playing: boolean) => void
  onSpeed: (speed: number) => void
  muted?: boolean
  onMuted?: (muted: boolean) => void
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const last = labels.length
  return (
    <div className="space-y-2" data-testid="step-controls">
      <div className="flex items-center gap-0.5">
        <button type="button" className={btn} onClick={() => onGoTo(position - 1)} disabled={position === 0} title="Previous (←)">
          <StepBack size={16} />
        </button>
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-b from-gold-soft to-gold text-bg transition-[filter] hover:brightness-110 disabled:opacity-30"
          onClick={() => onPlaying(!playing)}
          disabled={last === 0}
          title="Play/pause (space)"
        >
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
        </button>
        <button type="button" className={btn} onClick={() => onGoTo(position + 1)} disabled={position === last} title="Next (→)">
          <StepForward size={16} />
        </button>
        <button
          type="button"
          className="ml-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted hover:bg-raised hover:text-ink"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title="Playback: scrub, speed, jump to a step"
        >
          <span className="shrink-0 font-mono tabular-nums text-faint">
            {position}/{last}
          </span>
          <span className="min-w-0 flex-1 truncate">{position === 0 ? 'Setup' : labels[position - 1]}</span>
          <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {onMuted && (
          <button type="button" className={btn} onClick={() => onMuted(!muted)} aria-pressed={!muted} title={muted ? 'Sound off' : 'Sound on'}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2">
          <div className="flex items-center gap-0.5">
            <button type="button" className={btn} onClick={() => onGoTo(0)} disabled={position === 0} title="First (Home)">
              <SkipBack size={16} />
            </button>
            <input
              type="range"
              min={0}
              max={last}
              value={position}
              onChange={(e) => onGoTo(Number(e.target.value))}
              className="mx-1 min-w-0 flex-1 accent-gold"
              aria-label="Step"
            />
            <button type="button" className={btn} onClick={() => onGoTo(last)} disabled={position === last} title="Last (End)">
              <SkipForward size={16} />
            </button>
            <span className="ml-1 flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="Speed">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={speed === s}
                  onClick={() => onSpeed(s)}
                  className={`rounded px-1.5 py-0.5 font-display text-[11px] font-bold tabular-nums ${speed === s ? 'bg-gold text-bg' : 'text-faint hover:text-ink'}`}
                >
                  {s}×
                </button>
              ))}
            </span>
          </div>
          <select aria-label="Jump to step" className="w-full px-1.5 py-1 text-xs" value={position} onChange={(e) => onGoTo(Number(e.target.value))}>
            {['Setup', ...labels].map((label, i) => (
              <option key={i} value={i}>
                {i === 0 ? label : `${i}/${last} · ${label}`}
              </option>
            ))}
          </select>
          {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
        </div>
      )}
    </div>
  )
}
