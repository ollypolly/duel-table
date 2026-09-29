import { useEffect } from 'react'
import { BranchActions, ImportBranch } from './components/Branches/Branches'
import { ScenarioErrors, EmptyState } from './components/ScenarioErrors/ScenarioErrors'
import { ScenarioPicker } from './components/ScenarioPicker/ScenarioPicker'
import { Table } from './components/Table/Table'
import { branchFrom } from './branches/branches'
import { resultId, useScenarios } from './scenarios/useScenarios'
import { useBranchStore } from './store/branchStore'
import { usePlayerStore } from './store/playerStore'

export default function App() {
  const { scenarioId, open } = usePlayerStore()
  const { scenarios, branches, branchIds } = useScenarios()
  const { add, appendStep, undo } = useBranchStore()
  const all = [...scenarios, ...branches]
  const result = all.find((r) => resultId(r) === scenarioId) ?? all.find((r) => r.ok) ?? all[0]
  const currentId = result && resultId(result)
  const isBranch = !!currentId && branchIds.has(currentId)

  useEffect(() => {
    if (currentId && currentId !== scenarioId) open(currentId)
  }, [currentId, scenarioId, open])

  const startBranch = (position: number) => {
    if (!result?.ok) return
    const branch = branchFrom(result.scenario, position, all.map(resultId))
    add(branch)
    open(branch.id, position)
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center gap-6 border-b border-slate-800 px-4 py-2">
        <h1 className="shrink-0 font-bold tracking-tight">Duel Table</h1>
        {all.length > 0 && <ScenarioPicker scenarios={scenarios} branches={branches} value={currentId} onChange={(id) => open(id)} />}
        <ImportBranch takenIds={all.map(resultId)} />
      </header>
      {!result ? (
        <EmptyState />
      ) : result.ok ? (
        <Table
          key={result.scenario.id}
          scenario={result.scenario}
          onBranch={startBranch}
          {...(isBranch && {
            onStep: (step) => appendStep(result.scenario.id, step),
            onUndo: () => undo(result.scenario.id),
            freePlayControls: <BranchActions id={result.scenario.id} />,
          })}
        />
      ) : (
        <ScenarioErrors id={result.id} errors={result.errors}>
          {isBranch && <BranchActions id={result.id} />}
        </ScenarioErrors>
      )}
    </div>
  )
}
