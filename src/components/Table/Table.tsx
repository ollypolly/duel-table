// The playback screen for one scenario: a header with the game status, the
// board filling everything else, and a floating scene panel with the
// narration and playback controls. Clicking a card opens it with what you can
// do with it; free play adds a header menu and drag-to-move.
import { ChevronDown, ChevronUp, Crosshair, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { cardDb } from '../../data/cards'
import type { Iid, Player, Step, ZoneRef } from '../../engine'
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
import { CardActions, FreePlayMenu, FreePlayStatus } from '../FreePlay/FreePlay'
import { DamagePopups } from './DamagePopups'
import { Menu, MenuItem } from '../Menu/Menu'
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

// The scene panel's width plus its margins, for the camera to frame around.
const SCENE_PANEL_PX = 24 * 16 + 24

type TableProps = {
  scenario: ResolvedScenario
  nav: ReactNode // the app's header content (scenario picker etc.)
  Renderer?: BoardRenderer
  // Free-play: when onStep is set, moves made at the last step are appended
  // through it (a branch, or a live session).
  onStep?: (step: Step) => void
  onUndo?: () => void
  menuItems?: ReactNode // extra entries for the scene panel's More menu
  // Start a branch at a position, from anywhere free-play isn't available.
  onBranch?: (position: number) => void
  branchLabel?: string
  // Start a live API session at a position (when the server is running).
  onGoLive?: (position: number) => void
  // The scene panel's dock, pinned to its bottom: what you're being asked
  // (lesson controls, a game's question). It scrolls rather than grow past
  // a cap, so it never pushes the rest off.
  dock?: ReactNode
  // A chat takes the middle of the panel in place of the narration, with
  // its input under the dock.
  chat?: { log: ReactNode; input: ReactNode }
  // A game on the rules engine: cards you can pick now, lit up. onChoose
  // returns whether a click on one answered; otherwise it opens with
  // cardActions. Dropping a draggable card on a zone goes to onCardDrop.
  choosable?: Iid[]
  onChoose?: (iid: Iid) => boolean
  cardActions?: (iid: Iid, close: () => void) => ReactNode
  draggable?: Iid[]
  onCardDrop?: (iid: Iid, to: ZoneRef) => void
}

export function Table({
  scenario,
  nav,
  Renderer = Board2D,
  onStep,
  onUndo,
  menuItems,
  onBranch,
  branchLabel = 'Branch',
  onGoLive,
  dock,
  chat,
  choosable,
  onChoose,
  cardActions,
  draggable,
  onCardDrop,
}: TableProps) {
  const { position: rawPosition, playing, speed, followFocus, goTo, setPlaying, setSpeed, setFollowFocus } = usePlayerStore()
  const { inspected, selected, openPile, inspect, openPileViewer } = useUiStore()
  // The scene panel slides off to the left. Open by default unless the
  // screen is phone-sized, where it would cover the board.
  const [panelOpen, setPanelOpen] = useState(() => typeof matchMedia !== 'function' || matchMedia('(min-width: 640px)').matches)
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
  const closeInspector = useCallback(() => inspect(undefined), [inspect])

  return (
    <>
      <TopBar
        nav={
          <>
            {nav}
            {freePlay && <FreePlayMenu fp={fp} onUndo={onUndo && last > scenario.inheritedSteps ? onUndo : undefined} />}
          </>
        }
        status={<StatusBar view={view} lpChanges={lpChanges} onPhase={freePlay ? (phase) => fp.act({ type: 'phase', phase }) : undefined} />}
      />

      <main className="relative min-h-0 flex-1">
        <Renderer
          view={view}
          events={entry.events}
          selected={freePlay ? selected : undefined}
          choosable={choosable}
          focus={focus}
          insetLeft={panelOpen ? SCENE_PANEL_PX : 0}
          onCameraMove={() => setFollowFocus(false)}
          onCardClick={(iid) => {
            if (freePlay && fp.attachTo(iid)) return
            if (freePlay) fp.cancel()
            if (!freePlay && choosable?.includes(iid) && onChoose?.(iid)) return
            inspect(iid)
          }}
          draggable={freePlay ? view.cards.map((c) => c.iid) : draggable}
          onCardDrop={freePlay ? (iid, to) => fp.place(to, iid) : onCardDrop}
          onZoneClick={(ref) => {
            if (freePlay && selected) fp.place(ref)
            else if (view.zones.some((z) => z.kind === 'pile' && z.ref.zone === ref.zone)) openPileViewer(ref)
          }}
        />

        {/* The scene panel: a slim playback bar on top, the narration (or a
            chat) in the middle taking what room there is, and the dock at the
            bottom. It floats top-left and slides off to the left; on a phone
            it's a sheet that slides down off the bottom. Either way its
            handle stays on screen. With a chat it's full height. */}
        <div
          className={`pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-col transition-transform duration-300 ease-out *:pointer-events-auto sm:inset-x-auto sm:bottom-auto sm:left-3 sm:top-3 sm:w-96 ${
            chat ? 'h-[55%] sm:h-[calc(100%-1.5rem)]' : 'max-h-[55%] sm:max-h-[calc(100%-1.5rem)]'
          } ${panelOpen ? '' : 'translate-y-[calc(100%+0.75rem)] sm:translate-y-0 sm:-translate-x-[calc(100%+0.75rem)]'}`}
          data-testid="scene-panel"
          data-open={panelOpen}
        >
          <button
            type="button"
            className="panel absolute bottom-full left-1/2 mb-1.5 grid h-9 w-14 -translate-x-1/2 place-items-center text-muted hover:text-ink sm:bottom-auto sm:left-full sm:top-0 sm:mb-0 sm:ml-1.5 sm:w-9 sm:translate-x-0"
            onClick={() => setPanelOpen(!panelOpen)}
            aria-expanded={panelOpen}
            title={panelOpen ? 'Hide panel' : 'Show panel'}
          >
            <span className="sm:hidden">{panelOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</span>
            <span className="hidden sm:block">{panelOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</span>
          </button>
          <div className={`panel flex min-h-0 flex-col ${chat ? 'flex-1' : ''}`}>
            <div className="shrink-0 border-b border-line px-2 py-2">
              <StepControls
                position={position}
                labels={scenario.game.steps.map((s, i) => s.label ?? `Step ${i + 1}`)}
                playing={playing}
                speed={speed}
                onGoTo={(p) => goTo(Math.min(Math.max(0, p), last))}
                onPlaying={setPlaying}
                onSpeed={setSpeed}
              >
                {!freePlay && onBranch && (
                  <button type="button" className="btn btn-primary" onClick={() => onBranch(position)}>
                    {branchLabel} from {position === 0 ? 'setup' : `step ${position}`}
                  </button>
                )}
                {((!freePlay && (onStep || onGoLive)) || menuItems) && (
                  <Menu label="More">
                    {!freePlay && onStep && <MenuItem onClick={() => goTo(last)}>Free play at the end</MenuItem>}
                    {!freePlay && onGoLive && (
                      <MenuItem title="Start a session on the local API that Claude can drive with curl" onClick={() => onGoLive(position)}>
                        Go live from here
                      </MenuItem>
                    )}
                    {menuItems}
                  </Menu>
                )}
              </StepControls>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {chat ? (
                chat.log
              ) : (
                <NarrationPanel step={step} position={position} description={scenario.description} intentCard={face(intentIid)} warnings={stepWarnings} />
              )}
            </div>
            {dock && <div className="max-h-[35vh] shrink-0 space-y-2.5 overflow-y-auto border-t border-line px-3 py-2.5 sm:max-h-[45vh]">{dock}</div>}
            {chat && <div className="shrink-0 border-t border-line px-3 py-2">{chat.input}</div>}
          </div>
        </div>

        <DamagePopups changes={lpChanges} position={position} names={{ p1: view.players.p1.name, p2: view.players.p2.name }} />

        {freePlay && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex justify-center *:pointer-events-auto sm:left-[27rem] sm:right-32">
            <FreePlayStatus fp={fp} />
          </div>
        )}

        <label
          className="panel absolute right-3 top-3 z-10 flex h-9 cursor-pointer items-center gap-1.5 px-2.5 text-xs text-muted hover:text-ink"
          title="Focus. On: the camera follows each step. Dragging or zooming the board turns it off"
        >
          <input type="checkbox" className="accent-gold" checked={followFocus} onChange={(e) => setFollowFocus(e.target.checked)} aria-label="Focus" />
          <span className="hidden sm:inline">Focus</span>
          <Crosshair size={14} className="sm:hidden" aria-hidden />
        </label>

        <div className="absolute right-3 top-14 z-10 max-h-[40%] w-56 overflow-y-auto sm:w-64">
          <ChainList view={view} />
        </div>
      </main>

      <CardInspector
        card={face(inspected)}
        materialsOf={materialsOf}
        onClose={closeInspector}
        actions={inspected && (freePlay ? <CardActions fp={fp} iid={inspected} onDone={closeInspector} /> : cardActions?.(inspected, closeInspector))}
      />
      {pile && (
        <PileViewer
          zone={pile}
          playerName={view.players[pile.ref.player!].name}
          onClose={() => openPileViewer(undefined)}
          onCardClick={
            freePlay || onChoose
              ? (iid) => {
                  openPileViewer(undefined)
                  if (!freePlay && choosable?.includes(iid) && onChoose?.(iid)) return
                  inspect(iid)
                }
              : undefined
          }
        />
      )}
    </>
  )
}
