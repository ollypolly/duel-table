import { useEffect } from 'react'
import { ScenarioErrors, EmptyState } from './components/ScenarioErrors/ScenarioErrors'
import { ScenarioPicker } from './components/ScenarioPicker/ScenarioPicker'
import { Table } from './components/Table/Table'
import { scenarioResults } from './scenarios/load'
import { usePlayerStore } from './store/playerStore'

const idOf = (r: (typeof scenarioResults)[number]) => (r.ok ? r.scenario.id : r.id)

export default function App() {
  const { scenarioId, open } = usePlayerStore()
  const result =
    scenarioResults.find((r) => idOf(r) === scenarioId) ?? scenarioResults.find((r) => r.ok) ?? scenarioResults[0]
  const currentId = result && idOf(result)

  useEffect(() => {
    if (currentId && currentId !== scenarioId) open(currentId)
  }, [currentId, scenarioId, open])

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center gap-6 border-b border-slate-800 px-4 py-2">
        <h1 className="font-bold tracking-tight">Duel Table</h1>
        {scenarioResults.length > 0 && <ScenarioPicker results={scenarioResults} value={currentId} onChange={(id) => open(id)} />}
      </header>
      {!result ? (
        <EmptyState />
      ) : result.ok ? (
        <Table key={result.scenario.id} scenario={result.scenario} />
      ) : (
        <ScenarioErrors id={result.id} errors={result.errors} />
      )}
    </div>
  )
}
