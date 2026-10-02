// An example play Claude shows in a chat: a small read-only board you step
// through, with what happened at each step under it, and a button to open it
// full screen. The camera follows each step to the side it's about (Focus
// off shows the whole table), and a card you can see opens big on a click. Its steps are a hidden session's; while Claude is still
// playing it out (live), it's fetched again and follows the latest step.
import { ChevronLeft, ChevronRight, Focus, Maximize2, Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api/client'
import type { ChatEntry } from '../../api/game'
import { cardDb } from '../../data/cards'
import { rawDecks, rawScenarios } from '../../scenarios/load'
import { resolveScenario } from '../../scenarios/resolve'
import type { ScenarioFile } from '../../scenarios/schema'
import type { Iid } from '../../engine'
import { useUiStore } from '../../store/uiStore'
import { buildBoardView, cardFace, type CardFace } from '../../view/boardView'
import { stepFocus } from '../../view/focus'
import { Board2D } from '../Board/Board2D'
import { CardInspector } from '../CardInspector/CardInspector'
import { CardText } from '../CardLink/CardLink'

const POLL_MS = 1500
const PLAY_MS = 1400

type DemoRef = NonNullable<ChatEntry['demo']>

export function Demo({ demo, live = false }: { demo: DemoRef; live?: boolean }) {
  const [file, setFile] = useState<ScenarioFile>()
  const [gone, setGone] = useState(false)
  const [at, setAt] = useState<number>() // undefined: follow the latest step
  const [playing, setPlaying] = useState(false)
  const [full, setFull] = useState(false)
  // follow: the camera goes to the side each step is about. free: you moved it (full screen).
  const [cam, setCam] = useState<'follow' | 'all' | 'free'>('follow')
  const [inspected, setInspected] = useState<Iid>()
  const linked = useUiStore((s) => s.inspectedCard)

  useEffect(() => {
    const load = () =>
      void api.session(demo.session).then(
        (s) => setFile(s.file),
        () => setGone(true),
      )
    load()
    if (!live) return
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [demo.session, live])

  const scenario = useMemo(() => {
    if (!file) return
    const r = resolveScenario(file, { db: cardDb, decks: rawDecks, scenarios: rawScenarios })
    return r.ok ? r.scenario : undefined
  }, [file])

  const from = demo.from ?? 0
  const last = scenario ? scenario.timeline.length - 1 : from
  // A finished example opens on its first step; one still being played follows along.
  const position = Math.min(Math.max(at ?? (live ? last : from), from), last)

  useEffect(() => {
    if (!playing) return
    const timer = setTimeout(() => {
      setAt(position + 1)
      if (position + 1 >= last) setPlaying(false)
    }, PLAY_MS)
    return () => clearTimeout(timer)
  }, [playing, position, last])

  // Esc closes the full screen, once any card opened over it is closed.
  const covered = inspected !== undefined || linked !== undefined
  useEffect(() => {
    if (!full || covered) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full, covered])

  if (gone) return <p className="text-xs text-faint">{demo.title} (this example is no longer kept)</p>
  if (!scenario) return <p className="text-xs text-muted">{file ? `${demo.title} doesn't load here.` : 'Setting up the example…'}</p>

  const entry = scenario.timeline[position]
  const step = position > 0 ? scenario.game.steps[position - 1] : undefined
  const said = Object.entries(demo.captions ?? {})
    .map(([k, v]) => [Number(k), v] as const)
    .filter(([k]) => k <= position && k > from)
    .sort((a, b) => b[0] - a[0])[0]
  const open = !demo.closed
  const face = (iid: Iid): CardFace | undefined => (entry.state.cards[iid] ? cardFace(entry.state, iid, cardDb, open) : undefined)
  // The starting position shows the whole table; after that, the side in play.
  const focus = cam === 'free' ? 'free' : cam === 'follow' && position > from ? stepFocus(entry.state, step, entry.events) : 'all'
  const board = (big: boolean) => (
    <Board2D
      view={buildBoardView(entry.state, cardDb, open)}
      events={entry.events}
      focus={focus}
      still={!big}
      onCameraMove={() => big && setCam('free')}
      onCardClick={(iid) => face(iid)?.visible && setInspected(iid)}
    />
  )
  const go = (to: number) => {
    setPlaying(false)
    setAt(to)
  }
  const controls = (
    <div className="@container flex items-center gap-1.5 text-xs">
      <button type="button" className="btn px-1.5" disabled={position <= from} onClick={() => go(position - 1)} aria-label="Step back">
        <ChevronLeft size={14} />
      </button>
      <button
        type="button"
        className="btn px-1.5"
        disabled={last <= from}
        onClick={() => {
          if (!playing && position >= last) setAt(from)
          setPlaying(!playing)
        }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <button type="button" className="btn px-1.5" disabled={position >= last} onClick={() => go(position + 1)} aria-label="Step forward">
        <ChevronRight size={14} />
      </button>
      <button
        type="button"
        className={`btn px-1.5 ${cam === 'follow' ? 'border-gold text-gold' : ''}`}
        aria-pressed={cam === 'follow'}
        onClick={() => setCam(cam === 'follow' ? 'all' : 'follow')}
        title={cam === 'follow' ? 'Following the play: show the whole table' : 'Follow the play'}
        aria-label="Focus"
      >
        <Focus size={14} />
      </button>
      <span className="shrink-0 whitespace-nowrap tabular-nums text-muted">
        {position - from} / {last - from}
      </span>
      <input
        type="range"
        aria-label="Step"
        className="min-w-0 flex-1 basis-24 accent-gold"
        min={from}
        max={Math.max(last, from + 1)}
        value={position}
        onChange={(e) => go(Number(e.target.value))}
      />
      <span className="shrink-0 tabular-nums text-faint @max-md:hidden">
        Turn {entry.state.turn} · {entry.state.players.p1.name} {entry.state.players.p1.lp} · {entry.state.players.p2.name} {entry.state.players.p2.lp}
      </span>
    </div>
  )
  const caption = (
    <div className="min-h-9 space-y-0.5 text-xs">
      <p className="text-muted">{position === from ? (from ? 'Where the game is now.' : 'The starting position.') : step?.label ? <CardText>{step.label}</CardText> : ' '}</p>
      {position > from && (step?.narration ?? said?.[1]) && <p className="text-ink">{step?.narration ?? said![1]}</p>}
    </div>
  )

  return (
    <div className="my-1 w-full max-w-2xl shrink-0 overflow-hidden rounded-lg border border-line bg-surface" data-testid="demo">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <p className="min-w-0 flex-1 truncate font-display text-xs font-semibold">{demo.title}</p>
        <button type="button" className="btn flex items-center gap-1 px-1.5 text-xs" onClick={() => setFull(true)} title="Full screen">
          <Maximize2 size={12} aria-hidden />
          Expand
        </button>
      </div>
      {!full && <div className="aspect-[16/11] w-full">{board(false)}</div>}
      <div className="space-y-1.5 p-2.5">
        {caption}
        {controls}
      </div>
      {/* Over the page, not inside the chat's panel: a panel's backdrop filter would hold a fixed element in. */}
      {full &&
        createPortal(
          <div role="dialog" aria-modal aria-label={demo.title} className="fixed inset-0 z-40 flex flex-col bg-bg text-ink" data-testid="demo-full">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2">
              <h2 className="min-w-0 flex-1 truncate font-display font-semibold">{demo.title}</h2>
              <button type="button" className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Close" onClick={() => setFull(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1">{board(true)}</div>
            <div className="space-y-2 border-t border-line px-4 pb-[max(0.75rem,var(--safe-bottom))] pt-3">
              {caption}
              {controls}
            </div>
          </div>,
          document.body,
        )}
      {createPortal(
        <CardInspector card={inspected === undefined ? undefined : face(inspected)} materialsOf={(c) => (entry.state.cards[c.iid]?.materials ?? []).flatMap((m) => face(m) ?? [])} onClose={() => setInspected(undefined)} />,
        document.body,
      )}
    </div>
  )
}
