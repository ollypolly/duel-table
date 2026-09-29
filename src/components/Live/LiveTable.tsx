// Live mode: follow a server session over SSE. The session arrives as a
// scenario file, so it resolves and plays back exactly like any scenario;
// free-play moves are POSTed as steps instead of saved to a branch.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, subscribeSession, type SessionUpdate } from '../../api/client'
import { cardDb } from '../../data/cards'
import { rawDecks, rawScenarios } from '../../scenarios/load'
import { resolveScenario } from '../../scenarios/resolve'
import { usePlayerStore } from '../../store/playerStore'
import { ScenarioErrors } from '../ScenarioErrors/ScenarioErrors'
import { Table } from '../Table/Table'
import { TopBar } from '../TopBar/TopBar'

export function LiveTable({ id, nav }: { id: string; nav: ReactNode }) {
  const [session, setSession] = useState<SessionUpdate>()
  const [connection, setConnection] = useState('')
  const [rejected, setRejected] = useState('')
  const { openSession, goTo } = usePlayerStore()
  const lastSeen = useRef<number>(undefined)

  // Keyed by id in App, so a new session starts from fresh state.
  useEffect(() => subscribeSession(id, setSession, setConnection), [id])

  const result = useMemo(
    () => session && resolveScenario(session.file, { db: cardDb, decks: rawDecks, scenarios: rawScenarios }),
    [session],
  )

  // Follow new steps if you were watching the latest one.
  useEffect(() => {
    if (!result?.ok) return
    const last = result.scenario.game.steps.length
    const { position } = usePlayerStore.getState()
    if (lastSeen.current === undefined || position >= lastSeen.current) goTo(last)
    lastSeen.current = last
  }, [result, goTo])

  const report = (p: Promise<unknown>) => {
    setRejected('')
    p.catch((e: Error) => setRejected(e.message))
  }

  const liveNav = (
    <>
      {nav}
      <span className="flex items-center gap-2 text-sm">
        <span className="relative flex h-2 w-2">
          <span className={`absolute inline-flex h-full w-full rounded-full ${connection ? 'bg-amber-400' : 'animate-ping bg-emerald-400/70'}`} />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${connection ? 'bg-amber-400' : 'bg-emerald-400'}`} />
        </span>
        <span className="text-emerald-300">Live</span>
        {connection && <span className="text-amber-300">{connection}</span>}
        {rejected && (
          <span role="alert" className="text-rose-300">
            {rejected}
          </span>
        )}
        <button type="button" className="rounded-md bg-slate-800 px-2 py-0.5 text-xs hover:bg-slate-700" onClick={() => openSession(undefined)}>
          Leave
        </button>
      </span>
    </>
  )

  if (result?.ok)
    return (
      <Table
        scenario={result.scenario}
        nav={liveNav}
        onStep={(step) => report(api.applyStep(id, step))}
        onUndo={() => report(api.undo(id))}
        onBranch={(position) => report(api.fork(id, position).then((s) => openSession(s.id, position)))}
        branchLabel="Fork"
      />
    )
  return (
    <>
      <TopBar nav={liveNav} />
      {!result ? (
        <p className="mt-12 text-center text-slate-400">{connection || 'Connecting…'}</p>
      ) : (
        <ScenarioErrors id={result.id} errors={result.errors}>
          <span className="text-slate-400">The session's file doesn't resolve in the browser. Check that scenarios/ matches the server.</span>
        </ScenarioErrors>
      )}
    </>
  )
}
