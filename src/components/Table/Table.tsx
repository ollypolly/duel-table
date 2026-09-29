// The playback screen for one scenario: board, panels and controls.
import { useEffect, useMemo, type ReactNode } from 'react'
import { cardDb } from '../../data/cards'
import type { Iid, Step } from '../../engine'
import { useFreePlay } from '../../hooks/useFreePlay'
import { usePlayback, usePlaybackKeys } from '../../hooks/usePlayback'
import type { ResolvedScenario } from '../../scenarios/resolve'
import { usePlayerStore } from '../../store/playerStore'
import { useUiStore } from '../../store/uiStore'
import { buildBoardView, cardFace } from '../../view/boardView'
import { BOUNDS } from '../../view/layout'
import { Board2D } from '../Board/Board2D'
import type { BoardRenderer } from '../Board/BoardRenderer'
import { CardDetailPanel } from '../CardDetailPanel/CardDetailPanel'
import { FreePlayBar } from '../FreePlay/FreePlayBar'
import { NarrationPanel } from '../NarrationPanel/NarrationPanel'
import { PileViewer } from '../PileViewer/PileViewer'
import { PlayersPanel } from '../PlayersPanel/PlayersPanel'
import { StepControls } from '../StepControls/StepControls'

const intentCardOf = (step?: Step): Iid | undefined => {
  const i = step?.intent
  if (!i) return undefined
  return 'card' in i ? i.card : 'attacker' in i ? i.attacker : undefined
}

type TableProps = {
  scenario: ResolvedScenario
  Renderer?: BoardRenderer
  // Free-play: when onStep is set, moves made at the last step are appended
  // through it (a branch today, a live session later).
  onStep?: (step: Step) => void
  onUndo?: () => void
  freePlayControls?: ReactNode
  // Start a branch at a position, from anywhere free-play isn't available.
  onBranch?: (position: number) => void
}

export function Table({ scenario, Renderer = Board2D, onStep, onUndo, freePlayControls, onBranch }: TableProps) {
  const { position: rawPosition, playing, speed, goTo, setPlaying, setSpeed } = usePlayerStore()
  const { hovered, selected, openPile, hover, select, openPileViewer } = useUiStore()
  const last = scenario.game.steps.length
  const position = Math.min(Math.max(0, rawPosition), last)
  const entry = scenario.timeline[position]
  const step = position > 0 ? scenario.game.steps[position - 1] : undefined
  const view = useMemo(() => buildBoardView(entry.state, cardDb), [entry])
  const freePlay = !!onStep && position === last
  const fp = useFreePlay(entry.state, (s) => {
    onStep?.(s)
    goTo(last + 1)
  })

  usePlayback(last)
  usePlaybackKeys(last, !openPile)
  useEffect(() => {
    if (rawPosition !== position) goTo(position)
  }, [rawPosition, position, goTo])

  const shown = hovered ?? selected
  const face = (iid: Iid) => (entry.state.cards[iid] ? cardFace(entry.state, iid, cardDb) : undefined)
  const shownFace = shown ? face(shown) : undefined
  const materials = shown ? (entry.state.cards[shown]?.materials ?? []).map((m) => cardFace(entry.state, m, cardDb)) : []
  const pile = openPile && view.zones.find((z) => z.kind === 'pile' && z.ref.player === openPile.player && z.ref.zone === openPile.zone)
  const intentIid = intentCardOf(step)
  const stepWarnings = scenario.warnings.filter((w) => w.startsWith(`Step ${position},`))

  return (
    <div className="grid flex-1 grid-cols-[18rem_minmax(0,1fr)_20rem] gap-4 p-4">
      <div className="space-y-4">
        <PlayersPanel view={view} onPhase={freePlay ? (phase) => fp.act({ type: 'phase', phase }) : undefined} />
        <NarrationPanel
          step={step}
          position={position}
          total={last}
          description={scenario.description}
          intentCard={intentIid ? face(intentIid) : undefined}
          warnings={stepWarnings}
        />
      </div>
      <main className="flex flex-col items-center gap-3">
        <div className="w-full" style={{ maxWidth: `calc((100vh - ${freePlay ? 26 : onBranch ? 19 : 15}rem) * ${BOUNDS.width / BOUNDS.height})` }}>
          <Renderer
            view={view}
            events={entry.events}
            selected={selected}
            onCardClick={(iid) => (freePlay ? fp.clickCard(iid) : select(selected === iid ? undefined : iid))}
            onCardHover={hover}
            onZoneClick={(ref) => {
              if (freePlay && selected) fp.place(ref)
              else if (view.zones.some((z) => z.kind === 'pile' && z.ref.zone === ref.zone)) openPileViewer(ref)
            }}
          />
        </div>
        {freePlay ? (
          <div className="w-full">
            <FreePlayBar fp={fp} onUndo={onUndo && last > scenario.inheritedSteps ? onUndo : undefined}>
              {freePlayControls}
            </FreePlayBar>
          </div>
        ) : (
          onBranch && (
            <div className="flex w-full items-center gap-3 rounded-xl bg-slate-900 px-3 py-2 text-sm text-slate-300">
              {onStep ? (
                <>
                  <span>Free play happens at the end of a branch.</span>
                  <button type="button" className="rounded-md bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700" onClick={() => goTo(last)}>
                    Go to the end
                  </button>
                  <span>or</span>
                </>
              ) : (
                <span>Want to try a different line?</span>
              )}
              <button
                type="button"
                className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-600"
                onClick={() => onBranch(position)}
              >
                Branch from {position === 0 ? 'the setup' : `step ${position}`}
              </button>
              {freePlayControls}
            </div>
          )
        )}
        <div className="w-full">
          <StepControls
            position={position}
            labels={scenario.game.steps.map((s, i) => s.label ?? `Step ${i + 1}`)}
            playing={playing}
            speed={speed}
            onGoTo={(p) => goTo(Math.min(Math.max(0, p), last))}
            onPlaying={setPlaying}
            onSpeed={setSpeed}
          />
        </div>
      </main>
      <div className="max-h-[calc(100vh-5rem)] overflow-y-auto rounded-xl bg-slate-900">
        <CardDetailPanel card={shownFace} materials={materials} />
      </div>
      {pile && (
        <PileViewer
          zone={pile}
          playerName={view.players[pile.ref.player!].name}
          onClose={() => openPileViewer(undefined)}
          onCardClick={(iid) => {
            select(iid)
            if (freePlay) openPileViewer(undefined)
          }}
          onCardHover={hover}
        />
      )}
    </div>
  )
}
