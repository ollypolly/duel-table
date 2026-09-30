// The playback screen for one scenario: a header with the game status, the
// board filling everything else, and a floating scene panel with the
// narration and playback controls. Clicking a card opens it with what you can
// do with it; free play adds a header menu and drag-to-move.
import { Crosshair, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cardDb } from '../../data/cards'
import type { Iid, Player, Step, ZoneRef } from '../../engine'
import { useFreePlay } from '../../hooks/useFreePlay'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { panelFromUrl, writePanel } from '../../hooks/urlSync'
import { usePlayback, usePlaybackKeys } from '../../hooks/usePlayback'
import type { ResolvedScenario } from '../../scenarios/resolve'
import { usePlayerStore } from '../../store/playerStore'
import { SeatDecks } from '../../store/cosmeticsStore'
import { useUiStore } from '../../store/uiStore'
import { buildBoardView, cardFace, type CardFace } from '../../view/boardView'
import { stepFocus } from '../../view/focus'
import { play, stepSounds } from '../../view/sounds'
import { Board2D } from '../Board/Board2D'
import type { BoardRenderer } from '../Board/BoardRenderer'
import { CardInspector } from '../CardInspector/CardInspector'
import { CardActions, FreePlayMenu, FreePlayStatus } from '../FreePlay/FreePlay'
import { DamagePopups } from './DamagePopups'
import { LiveFeed } from './LiveFeed'
import { useSheet } from './useSheet'
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
  // a cap, so it never pushes the rest off. A live table with a chat puts
  // it at the end of the chat instead.
  dock?: ReactNode
  // A chat takes the middle of the panel in place of the narration, with
  // its input under the dock. withNarration: it shares the middle with the
  // narration instead (a lesson's tutor).
  chat?: { log: ReactNode; input: ReactNode; withNarration?: boolean }
  // A live game. New steps show as toasts on the board. While the panel is
  // hidden, its handle shows Claude typing and a dot for a message from it
  // you haven't seen or a question waiting for you, and those toast too.
  // who: who's talking, if not the other player (Claude, in a review).
  activity?: { typing: boolean; messages: number; latest?: string; action: boolean; who?: string }
  // The button you're most likely to want next, on the phone sheet's header
  // so it doesn't need opening: pass on a chain, the next phase, Next.
  quick?: { label: string; run: () => void }
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
  activity,
  quick,
  choosable,
  onChoose,
  cardActions,
  draggable,
  onCardDrop,
}: TableProps) {
  const { position: rawPosition, playing, speed, followFocus, muted, goTo, setPlaying, setSpeed, setFollowFocus, setMuted } = usePlayerStore()
  const { inspected, selected, openPile, inspect, openPileViewer } = useUiStore()
  // The scene panel slides off to the left. Open by default unless the
  // screen is phone-sized, where it would cover the board; the URL keeps it
  // as you left it over a reload.
  const [panelOpen, setPanelOpen] = useState(() => panelFromUrl() ?? (typeof matchMedia !== 'function' || matchMedia('(min-width: 640px)').matches))
  useEffect(() => writePanel(panelOpen), [panelOpen])
  const phone = useMediaQuery('(max-width: 639px)')
  const { ref: sheetRef, peekRef: sheetPeekRef, motionProps: sheetProps, startDrag, toggle: togglePanel } = useSheet(panelOpen, setPanelOpen, phone)
  // Messages count as seen while the panel is open.
  const messages = activity?.messages ?? 0
  const talker = activity?.who ?? scenario.timeline.at(-1)!.state.players.p2.name
  const [seen, setSeen] = useState(messages)
  if (panelOpen && seen !== messages) setSeen(messages)
  // Your move counts as seen once you've opened the panel on it, until the next one.
  const action = !!activity?.action
  const [actionSeen, setActionSeen] = useState(false)
  if (action && panelOpen && !actionSeen) setActionSeen(true)
  if (!action && actionSeen) setActionSeen(false)
  const typing = !panelOpen && !!activity?.typing
  const alert = !panelOpen && (messages > seen || (action && !actionSeen))
  const openPanel = useCallback(() => setPanelOpen(true), [])
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
  // The step you just moved onto makes its sounds; jumps and stepping back are quiet.
  const heard = useRef(position)
  useEffect(() => {
    const forward = position === heard.current + 1
    heard.current = position
    if (forward && !muted) stepSounds(entry.events, step?.actions).forEach((s, i) => setTimeout(() => play(s), i * 150))
  }, [position, entry, step, muted])
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
  const { p1, p2 } = scenario.game.setup.players
  const seatDecks = useMemo(() => ({ p1: p1.deck, p2: p2.deck }), [p1.deck, p2.deck])

  return (
    <SeatDecks.Provider value={seatDecks}>
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
            it's a sheet you drag up and down by its handle (useSheet). Either
            way the handle stays on screen. With a chat it's full height (on a phone, all
            but a strip at the top for the handle and Focus). */}
        {activity && (
          <LiveFeed
            steps={scenario.game.steps}
            opponent={talker}
            messages={messages}
            latest={activity.latest}
            action={activity.action}
            panelOpen={panelOpen}
            muted={muted}
            onOpen={openPanel}
          />
        )}

        <motion.div
          ref={sheetRef}
          {...sheetProps}
          className={`pointer-events-none absolute inset-x-0 bottom-(--safe-bottom) z-10 flex flex-col *:pointer-events-auto sm:bottom-auto sm:left-3 sm:right-auto sm:top-3 sm:w-96 sm:transition-transform sm:duration-300 sm:ease-out ${
            chat ? 'h-[calc(100%-6rem)] sm:h-[calc(100%-1.5rem)]' : 'max-h-[55%] sm:max-h-[calc(100%-1.5rem)]'
          } ${panelOpen ? '' : 'sm:-translate-x-[calc(100%+0.75rem)]'}`}
          data-testid="scene-panel"
          data-open={panelOpen}
        >
          {!phone && (
            <button
              type="button"
              className="panel absolute left-full top-0 ml-1.5 grid size-9 place-items-center text-muted hover:text-ink"
              onClick={togglePanel}
              aria-expanded={panelOpen}
              title={panelOpen ? 'Hide panel' : `Show panel${typing ? ' (Claude is typing)' : ''}${alert ? ' (something new)' : ''}`}
            >
              {panelOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
              {typing && (
                <span className="panel absolute -top-3 left-full -ml-3 rounded-full px-1.5 py-1">
                  <TypingDots />
                </span>
              )}
              {alert && !typing && <AlertDot className="absolute -right-1 -top-1" />}
            </button>
          )}
          <div
            className={`panel flex min-h-0 flex-col max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 ${chat ? 'flex-1' : ''}`}
          >
            {/* On a phone, the sheet's header: the handle, the one thing most
                worth knowing, and the quick button over its right end. Closed,
                it and the playback bar under it show. */}
            {phone && (
              <div className="relative shrink-0 border-b border-line">
                <button
                  type="button"
                  className="flex w-full touch-none flex-col items-center gap-1.5 px-3 pb-2.5 pt-2"
                  onClick={togglePanel}
                  onPointerDown={startDrag}
                  data-sheet-handle
                  aria-expanded={panelOpen}
                  aria-label={panelOpen ? 'Hide panel' : 'Show panel'}
                >
                  <span className="h-1 w-10 rounded-full bg-muted" />
                  <span className={`flex w-full min-w-0 items-center gap-2 text-left text-sm ${quick ? 'pr-36' : ''}`}>
                    {activity?.action ? (
                      <span className="font-semibold text-gold">Your move</span>
                    ) : activity?.typing ? (
                      <>
                        <span className="text-muted">{talker} is typing</span>
                        <TypingDots />
                      </>
                    ) : messages > seen && activity?.latest ? (
                      <span className="truncate">
                        <span className="font-semibold">{talker}:</span> {activity.latest.replace(/[*_`#>]/g, '')}
                      </span>
                    ) : (
                      <span className="truncate text-muted">
                        <span className="font-display">
                          {position}/{last}
                        </span>{' '}
                        {step?.label ?? 'Setup'}
                      </span>
                    )}
                    {alert && <AlertDot className="relative ml-auto shrink-0" />}
                  </span>
                </button>
                {quick && (
                  <button type="button" className="btn btn-primary absolute bottom-1.5 right-3 h-8 px-3 text-sm" onClick={quick.run}>
                    {quick.label}
                  </button>
                )}
              </div>
            )}
            <div ref={sheetPeekRef} className="shrink-0 touch-none border-b border-line px-2 py-2 sm:touch-auto" onPointerDown={startDrag}>
              <StepControls
                position={position}
                labels={scenario.game.steps.map((s, i) => s.label ?? `Step ${i + 1}`)}
                playing={playing}
                speed={speed}
                onGoTo={(p) => goTo(Math.min(Math.max(0, p), last))}
                onPlaying={setPlaying}
                onSpeed={setSpeed}
                muted={muted}
                onMuted={setMuted}
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
                      <MenuItem title="Start a table from this step to play on (Claude can join it over the API)" onClick={() => onGoLive(position)}>
                        New table from here
                      </MenuItem>
                    )}
                    {menuItems}
                  </Menu>
                )}
              </StepControls>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {chat && !chat.withNarration ? (
                chat.log
              ) : (
                <NarrationPanel step={step} position={position} description={scenario.description} intentCard={face(intentIid)} warnings={stepWarnings} />
              )}
            </div>
            {chat?.withNarration && <div className="flex min-h-0 flex-1 flex-col border-t border-line">{chat.log}</div>}
            {phone && panelOpen && <ChainList view={view} className="shrink-0 border-t border-line px-3 py-2" />}
            {dock && <div className="max-h-[35vh] shrink-0 space-y-2.5 overflow-y-auto border-t border-line px-3 py-2.5 sm:max-h-[45vh]">{dock}</div>}
            {chat && <div className="shrink-0 border-t border-line px-3 py-2">{chat.input}</div>}
          </div>
        </motion.div>

        {/* Under the phone sheet: the home bar's safe area, in the sheet's colour. */}
        {phone && <div className="absolute inset-x-0 bottom-0 z-10 h-(--safe-bottom) bg-surface" />}

        <DamagePopups changes={lpChanges} position={position} names={{ p1: view.players.p1.name, p2: view.players.p2.name }} />

        {freePlay && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex justify-center *:pointer-events-auto sm:left-[27rem] sm:right-32">
            <FreePlayStatus fp={fp} />
          </div>
        )}

        <FocusToggle checked={followFocus} onChange={setFollowFocus} />

        {!(phone && panelOpen) && (
          <div className="absolute right-3 top-16 z-10 max-h-[40%] w-56 overflow-y-auto sm:top-14 sm:w-64">
            <ChainList view={view} />
          </div>
        )}
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
    </SeatDecks.Provider>
  )
}

function FocusToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label
      className="panel absolute right-3 top-3 z-10 flex h-11 cursor-pointer items-center gap-2 px-3.5 text-sm text-muted hover:text-ink sm:h-9 sm:gap-1.5 sm:px-2.5 sm:text-xs"
      title="Focus. On: the camera follows each step. Dragging or zooming the board turns it off"
    >
      <input type="checkbox" className="accent-gold" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label="Focus" />
      <span className="hidden sm:inline">Focus</span>
      <Crosshair size={18} className="sm:hidden" aria-hidden />
    </label>
  )
}

function TypingDots() {
  return (
    <span className="flex gap-0.5" data-testid="typing">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1 animate-bounce rounded-full bg-ink" style={{ animationDelay: `${i * 150}ms` }} />
      ))}
    </span>
  )
}

function AlertDot({ className }: { className: string }) {
  return (
    <span className={`flex size-2.5 ${className}`} data-testid="alert">
      <span className="absolute size-2.5 animate-ping rounded-full bg-gold opacity-75" />
      <span className="relative size-2.5 rounded-full bg-gold" />
    </span>
  )
}
