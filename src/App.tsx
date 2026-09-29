import { useMemo } from 'react'
import { Board2D } from './components/Board/Board2D'
import { CardDetailPanel } from './components/CardDetailPanel/CardDetailPanel'
import { PileViewer } from './components/PileViewer/PileViewer'
import { PlayersPanel } from './components/PlayersPanel/PlayersPanel'
import { cardDb } from './data/cards'
import { scenarioResults } from './scenarios/load'
import { useUiStore } from './store/uiStore'
import { buildBoardView, cardFace } from './view/boardView'

export default function App() {
  const first = scenarioResults.find((r) => r.ok)
  const entry = first?.ok ? first.scenario.timeline.at(-1)! : undefined
  const view = useMemo(() => entry && buildBoardView(entry.state, cardDb), [entry])
  const { hovered, selected, openPile, hover, select, openPileViewer } = useUiStore()
  if (!entry || !view) return <p className="p-6 text-white">No scenarios</p>

  const shown = hovered ?? selected
  const shownFace = shown && entry.state.cards[shown] ? cardFace(entry.state, shown, cardDb) : undefined
  const materials = shown ? (entry.state.cards[shown]?.materials ?? []).map((m) => cardFace(entry.state, m, cardDb)) : []
  const pile = openPile && view.zones.find((z) => z.kind === 'pile' && z.ref.player === openPile.player && z.ref.zone === openPile.zone)

  return (
    <div className="grid min-h-screen grid-cols-[14rem_1fr_20rem] gap-4 bg-slate-950 p-4 text-slate-100">
      <PlayersPanel view={view} />
      <main>
        <Board2D
          view={view}
          events={entry.events}
          selected={selected}
          onCardClick={(iid) => select(selected === iid ? undefined : iid)}
          onCardHover={hover}
          onZoneClick={(ref) => view.zones.some((z) => z.kind === 'pile' && z.ref.zone === ref.zone) && openPileViewer(ref)}
        />
      </main>
      <div className="rounded-xl bg-slate-900">
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
