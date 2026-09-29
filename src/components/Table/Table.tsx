// The playback screen for one scenario: a header with the game status, the
// board filling everything else, and the controls pinned to the bottom.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { cardDb } from '../../data/cards'
import type { Iid, Player, Step } from '../../engine'
import { useFreePlay } from '../../hooks/useFreePlay'
import { usePlayback, usePlaybackKeys } from '../../hooks/usePlayback'
import type { ResolvedScenario } from '../../scenarios/resolve'
import { usePlayerStore } from '../../store/playerStore'
import { useUiStore } from '../../store/uiStore'
import { buildBoardView, cardFace, type CardFace } from '../../view/boardView'
import { stepFocus } from '../../view/focus'
import { Board2D } from '../Board/Board2D'
import type { BoardRenderer } from '../Board/BoardRenderer'
import { CardInspector } from '../CardInspector/CardInspector'
import { FreePlayBar } from '../FreePlay/FreePlayBar'
import { NarrationPanel } from '../NarrationPanel/NarrationPanel'
import { PileViewer } from '../PileViewer/PileViewer'
import { ChainList, StatusBar } from '../StatusBar/StatusBar'
import { StepControls } from '../StepControls/StepControls'
import { TopBar } from '../TopBar/TopBar'

const intentCardOf = (step?: Step): Iid | undefined => {
  const i = step?.intent
  if (!i) return undefined
  return 'card' in i ? i.card : 'attacker' in i ? i.attacker : undefined
}

type TableProps = {
  scenario: ResolvedScenario
  nav: ReactNode // the app's header content (scenario picker etc.)
  Renderer?: BoardRenderer
  // Free-play: when onStep is set, moves made at the last step are appended
  // through it (a branch, or a live session).
  onStep?: (step: Step) => void
  onUndo?: () => void
  freePlayControls?: ReactNode
  // Start a branch at a position, from anywhere free-play isn't available.
  onBranch?: (position: number) => void
  branchLabel?: string
  // Start a live API session at a position (when the server is running).
  onGoLive?: (position: number) => void
}

export function Table({ scenario, nav, Renderer = Board2D, onStep, onUndo, freePlayControls, onBranch, branchLabel = 'Branch', onGoLive }: TableProps) {
  const { position: rawPosition, playing, speed, followFocus, goTo, setPlaying, setSpeed, setFollowFocus } = usePlayerStore()
  const { hovered, inspected, selected, openPile, hover, inspect, select, openPileViewer } = useUiStore()
  // Open by default unless the screen is phone-sized, where it would cover the board.
  const [narrationOpen, setNarrationOpen] = useState(() => typeof matchMedia !== 'function' || matchMedia('(min-width: 640px)').matches)
  const last = scenario.game.steps.length
  const position = Math.min(Math.max(0, rawPosition), last)
  const entry = scenario.timeline[position]
  const step = position > 0 ? scenario.game.steps[position - 1] : undefined
  const view = useMemo(() => buildBoardView(entry.state, cardDb), [entry])
  const lpChanges = useMemo(() => {
    const changes: Partial<Record<Player, number>> = {}
    for (const e of entry.events) if (e.type === 'lpChanged') changes[e.player] = (changes[e.player] ?? 0) + e.to - e.from
    return changes
  }, [entry])
  const freePlay = !!onStep && position === last
  const fp = useFreePlay(entry.state, (s) => {
    onStep?.(s)
    goTo(last + 1)
  })

  usePlayback(last)
  usePlaybackKeys(last, !openPile && !inspected)
  useEffect(() => {
    if (!freePlay || !selected) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !inspected && fp.cancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [freePlay, selected, inspected, fp])
  useEffect(() => {
    if (rawPosition !== position) goTo(position)
  }, [rawPosition, position, goTo])

  const face = (iid?: Iid) => (iid && entry.state.cards[iid] ? cardFace(entry.state, iid, cardDb) : undefined)
  const materialsOf = (c: CardFace) => (entry.state.cards[c.iid]?.materials ?? []).map((m) => cardFace(entry.state, m, cardDb))
  const pile = openPile && view.zones.find((z) => z.kind === 'pile' && z.ref.player === openPile.player && z.ref.zone === openPile.zone)
  const intentIid = intentCardOf(step)
  const focus = !followFocus ? 'free' : freePlay ? 'all' : stepFocus(entry.state, step, entry.events)
  const stepWarnings = scenario.warnings.filter((w) => w.startsWith(`Step ${position},`))

  return (
    <>
      <TopBar nav={nav} status={<StatusBar view={view} lpChanges={lpChanges} onPhase={freePlay ? (phase) => fp.act({ type: 'phase', phase }) : undefined} />} />

      <main className="relative min-h-0 flex-1">
        <Renderer
          view={view}
          events={entry.events}
          selected={freePlay ? selected : undefined}
          focus={focus}
          onCardClick={(iid) => (freePlay ? fp.clickCard(iid) : inspect(inspected === iid ? undefined : iid))}
          onCardHover={hover}
          onZoneClick={(ref) => {
            if (freePlay && selected) fp.place(ref)
            else if (view.zones.some((z) => z.kind === 'pile' && z.ref.zone === ref.zone)) openPileViewer(ref)
          }}
        />

        {/* Narration floats top-left over the table and folds away. */}
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-[min(22rem,calc(100%-1.5rem))] flex-col gap-2 *:pointer-events-auto">
          {narrationOpen ? (
            <div className="panel relative min-h-0 overflow-y-auto">
              <button
                type="button"
                className="absolute right-2 top-2 rounded px-1 text-xs text-faint hover:text-ink"
                onClick={() => setNarrationOpen(false)}
                title="Hide narration"
                aria-label="Hide narration"
              >
                ▴
              </button>
              <NarrationPanel
                step={step}
                position={position}
                total={last}
                description={scenario.description}
                intentCard={face(intentIid)}
                warnings={stepWarnings}
              />
            </div>
          ) : (
            <button type="button" className="panel self-start px-3 py-1.5 text-left text-sm hover:bg-raised" onClick={() => setNarrationOpen(true)}>
              ▾ {step ? (step.label ?? `Step ${position}`) : 'Setup'}
            </button>
          )}
          <ChainList view={view} />
        </div>
      </main>

      <footer className="space-y-1.5 border-t border-line bg-surface/70 px-4 py-2 backdrop-blur">
        {freePlay && (
          <FreePlayBar fp={fp} onUndo={onUndo && last > scenario.inheritedSteps ? onUndo : undefined} onInspect={() => inspect(selected)}>
            {freePlayControls}
          </FreePlayBar>
        )}
        <StepControls
          position={position}
          labels={scenario.game.steps.map((s, i) => s.label ?? `Step ${i + 1}`)}
          playing={playing}
          speed={speed}
          onGoTo={(p) => goTo(Math.min(Math.max(0, p), last))}
          onPlaying={setPlaying}
          onSpeed={setSpeed}
        >
          {!freePlay && onStep && (
            <button type="button" className="btn" title="Free play happens at the last step" onClick={() => goTo(last)}>
              Free play at the end
            </button>
          )}
          {!freePlay && onBranch && (
            <button type="button" className="btn btn-primary" onClick={() => onBranch(position)}>
              {branchLabel} from {position === 0 ? 'setup' : `step ${position}`}
            </button>
          )}
          {!freePlay && onGoLive && (
            <button
              type="button"
              className="btn"
              title="Start a session on the local API that Claude can drive with curl"
              onClick={() => onGoLive(position)}
            >
              Go live
            </button>
          )}
          {!freePlay && freePlayControls}
          <label
            className="flex items-center gap-1.5 text-xs text-muted"
            title="On: the camera follows each step. Off: drag to pan, scroll or pinch to zoom"
          >
            <input type="checkbox" className="accent-gold" checked={followFocus} onChange={(e) => setFollowFocus(e.target.checked)} />
            Focus
          </label>
        </StepControls>
      </footer>

      <CardInspector hovered={face(hovered)} pinned={face(inspected)} materialsOf={materialsOf} onClose={() => inspect(undefined)} />
      {pile && (
        <PileViewer
          zone={pile}
          playerName={view.players[pile.ref.player!].name}
          onClose={() => openPileViewer(undefined)}
          onCardClick={
            freePlay
              ? (iid) => {
                  select(iid)
                  openPileViewer(undefined)
                }
              : undefined
          }
        />
      )}
    </>
  )
}
