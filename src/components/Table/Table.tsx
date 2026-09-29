// The playback screen for one scenario: board, panels and controls.
import { useEffect, useMemo } from 'react'
import { cardDb } from '../../data/cards'
import type { Iid, Step } from '../../engine'
import { usePlayback, usePlaybackKeys } from '../../hooks/usePlayback'
import type { ResolvedScenario } from '../../scenarios/resolve'
import { usePlayerStore } from '../../store/playerStore'
import { useUiStore } from '../../store/uiStore'
import { buildBoardView, cardFace } from '../../view/boardView'
import { BOUNDS } from '../../view/layout'
import { Board2D } from '../Board/Board2D'
import type { BoardRenderer } from '../Board/BoardRenderer'
import { CardDetailPanel } from '../CardDetailPanel/CardDetailPanel'
import { NarrationPanel } from '../NarrationPanel/NarrationPanel'
import { PileViewer } from '../PileViewer/PileViewer'
import { PlayersPanel } from '../PlayersPanel/PlayersPanel'
import { StepControls } from '../StepControls/StepControls'

const intentCardOf = (step?: Step): Iid | undefined => {
  const i = step?.intent
  if (!i) return undefined
  return 'card' in i ? i.card : 'attacker' in i ? i.attacker : undefined
}

export function Table({ scenario, Renderer = Board2D }: { scenario: ResolvedScenario; Renderer?: BoardRenderer }) {
  const { position: rawPosition, playing, speed, goTo, setPlaying, setSpeed } = usePlayerStore()
  const { hovered, selected, openPile, hover, select, openPileViewer } = useUiStore()
  const last = scenario.game.steps.length
  const position = Math.min(Math.max(0, rawPosition), last)
  const entry = scenario.timeline[position]
  const step = position > 0 ? scenario.game.steps[position - 1] : undefined
  const view = useMemo(() => buildBoardView(entry.state, cardDb), [entry])

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
        <PlayersPanel view={view} />
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
        <div className="w-full" style={{ maxWidth: `calc((100vh - 15rem) * ${BOUNDS.width / BOUNDS.height})` }}>
          <Renderer
            view={view}
            events={entry.events}
            selected={selected}
            onCardClick={(iid) => select(selected === iid ? undefined : iid)}
            onCardHover={hover}
            onZoneClick={(ref) => view.zones.some((z) => z.kind === 'pile' && z.ref.zone === ref.zone) && openPileViewer(ref)}
          />
        </div>
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
          onCardClick={select}
          onCardHover={hover}
        />
      )}
    </div>
  )
}
