import { useEffect, useState } from 'react'
import { api, type SessionSummary } from './api/client'
import { BranchActions, ImportBranch } from './components/Branches/Branches'
import { LiveTable } from './components/Live/LiveTable'
import { ScenarioErrors, EmptyState } from './components/ScenarioErrors/ScenarioErrors'
import { ScenarioPicker } from './components/ScenarioPicker/ScenarioPicker'
import { Table } from './components/Table/Table'
import { branchFrom } from './branches/branches'
import { resultId, useScenarios } from './scenarios/useScenarios'
import { useBranchStore } from './store/branchStore'
import { usePlayerStore } from './store/playerStore'

export default function App() {
  const { scenarioId, sessionId, open, openSession } = usePlayerStore()
  const [liveSessions, setLiveSessions] = useState<SessionSummary[]>()
  const { scenarios, branches, branchIds } = useScenarios()
  const { add, appendStep, undo } = useBranchStore()
  const all = [...scenarios, ...branches]
  const result = all.find((r) => resultId(r) === scenarioId) ?? all.find((r) => r.ok) ?? all[0]
  const currentId = result && resultId(result)
  const isBranch = !!currentId && branchIds.has(currentId)

  useEffect(() => {
    if (currentId && currentId !== scenarioId) open(currentId)
  }, [currentId, scenarioId, open])

  // The API is optional; undefined sessions means it isn't running.
  useEffect(() => {
    void api.listSessions().then(setLiveSessions)
  }, [sessionId])

  const goLive = async (position: number) => {
    const s = await api.createSession({ scenario: currentId!, atStep: position })
    openSession(s.id, position)
  }

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
        {liveSessions && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Live</span>
            <select
              aria-label="Live session"
              className="max-w-[16rem] rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5"
              value={sessionId ?? ''}
              onChange={(e) => openSession(e.target.value || undefined, Infinity)}
            >
              <option value="">{liveSessions.length ? 'Not live' : 'No sessions yet'}</option>
              {liveSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}: {s.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <ImportBranch takenIds={all.map(resultId)} />
      </header>
      {sessionId ? (
        <LiveTable key={sessionId} id={sessionId} />
      ) : !result ? (
        <EmptyState />
      ) : result.ok ? (
        <Table
          key={result.scenario.id}
          scenario={result.scenario}
          onBranch={startBranch}
          {...(liveSessions && !isBranch && { onGoLive: (position: number) => void goLive(position) })}
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
