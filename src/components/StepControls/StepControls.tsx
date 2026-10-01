import { ChevronDown, Pause, Play, SkipBack, SkipForward, StepBack, StepForward, Volume2, VolumeX } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { SPEEDS } from '../../store/playerStore'

const btn = 'grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent'

// A touch screen has no hover, so there the line is always grown.
const TOUCH_OPEN = '[@media(pointer:coarse)]:my-1 [@media(pointer:coarse)]:h-5'
const TOUCH_MARK = '[@media(pointer:coarse)]:h-4.5 [@media(pointer:coarse)]:w-4.5 [@media(pointer:coarse)]:text-[9px]'

// The scene controls: a slim bar (back, play, forward, the current step), and
// a drawer with the rest (first/last, speed, the scrubber, the step list, and
// the screen's own actions: branch, go live…). Clicking the step opens it.
// nav is a line of the screen's own under the bar (a review's key moments).
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
  marks,
  onMark,
  nav,
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
  // Dots along the game at steps worth a look (a review's key moments).
  // On the line they're buttons: mark is a symbol shown when the line grows,
  // title says what it is, and onMark is where a click goes (default: the step).
  marks?: { step: number; className: string; mark?: string; title?: string; disabled?: boolean }[]
  onMark?: (step: number) => void
  nav?: ReactNode
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [hint, setHint] = useState<string>()
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
      {!!marks?.length && last > 0 && (
        // The game as a line with its marks. Under the pointer (and always on
        // a touch screen) it grows: a mark is a button that goes to it, and
        // anywhere else on the line goes to that step.
        <div className="group/line mx-2" onMouseLeave={() => setHint(undefined)} data-testid="timeline">
          <div
            className={`relative h-1.5 cursor-pointer rounded-full bg-line/60 transition-[height,margin] group-hover/line:my-1 group-hover/line:h-5 group-focus-within/line:my-1 group-focus-within/line:h-5 ${TOUCH_OPEN}`}
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect()
              onGoTo(Math.round(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * last))
            }}
          >
            <span className="absolute inset-y-0 left-0 rounded-full bg-gold/30" style={{ width: `${(position / last) * 100}%` }} />
            {marks.map((m) => (
              <button
                key={m.step}
                type="button"
                disabled={m.disabled}
                aria-label={m.title ?? `Step ${m.step}`}
                aria-current={position === m.step || position === m.step - 1}
                className={`absolute top-1/2 grid h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[0px] font-bold leading-none text-bg transition-[height,width,font-size] hover:brightness-125 disabled:opacity-40 aria-[current=true]:ring-2 aria-[current=true]:ring-ink group-hover/line:h-4.5 group-hover/line:w-4.5 group-hover/line:text-[9px] group-focus-within/line:h-4.5 group-focus-within/line:w-4.5 group-focus-within/line:text-[9px] ${TOUCH_MARK} ${m.className}`}
                style={{ left: `${(m.step / last) * 100}%` }}
                onMouseEnter={() => setHint(m.title)}
                onFocus={() => setHint(m.title)}
                onBlur={() => setHint(undefined)}
                onClick={(e) => {
                  e.stopPropagation()
                  ;(onMark ?? onGoTo)(m.step)
                }}
              >
                {m.mark}
              </button>
            ))}
          </div>
          {hint && <p className="mt-1 truncate text-center text-[11px] text-muted">{hint}</p>}
        </div>
      )}
      {nav}
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
