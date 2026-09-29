// Live mode: follow a server session over SSE. The session arrives as a
// scenario file, so it resolves and plays back exactly like any scenario;
// free-play moves are POSTed as steps instead of saved to a branch.
//
// In a lesson, steps still queued are left out, and the presenter cursor
// moves viewers who are following along. Anyone who has scrubbed away stays
// put and gets a Back to live button.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, subscribeSession, type SessionUpdate } from '../../api/client'
import type { Cursor } from '../../api/lesson'
import { cardDb } from '../../data/cards'
import { rawDecks, rawScenarios } from '../../scenarios/load'
import { resolveScenario } from '../../scenarios/resolve'
import { usePlayerStore } from '../../store/playerStore'
import { ScenarioErrors } from '../ScenarioErrors/ScenarioErrors'
import { Table } from '../Table/Table'
import { TopBar } from '../TopBar/TopBar'
import { LessonPanel } from './LessonPanel'

export function LiveTable({ id, nav }: { id: string; nav: ReactNode }) {
  const [session, setSession] = useState<SessionUpdate>()
  const [connection, setConnection] = useState('')
  const [rejected, setRejected] = useState('')
  const { openSession, goTo } = usePlayerStore()
  const position = usePlayerStore((s) => s.position)
  const followed = useRef<Cursor>(undefined) // the last cursor acted on
  const replay = useRef<ReturnType<typeof setInterval>>(undefined)

  // Keyed by id in App, so a new session starts from fresh state.
  useEffect(() => subscribeSession(id, setSession, setConnection), [id])

  const result = useMemo(() => {
    if (!session) return
    const { file, lesson } = session
    const shown = { ...file, steps: file.steps.slice(0, file.steps.length - lesson.queued) }
    return resolveScenario(shown, { db: cardDb, decks: rawDecks, scenarios: rawScenarios })
  }, [session])

  const stopReplay = () => {
    clearInterval(replay.current)
    replay.current = undefined
  }
  useEffect(() => () => clearInterval(replay.current), [])

  // Follow the presenter cursor if you were where it last pointed.
  useEffect(() => {
    if (!result?.ok || !session) return
    const cursor = session.lesson.cursor
    const prev = followed.current
    if (prev?.seq === cursor.seq) return
    followed.current = cursor
    const { position, speed } = usePlayerStore.getState()
    if (prev && position !== prev.position && !replay.current) return
    stopReplay()
    if (cursor.from === undefined) return goTo(cursor.position)
    let p = cursor.from
    goTo(p)
    replay.current = setInterval(() => {
      if (usePlayerStore.getState().position !== p) return stopReplay() // the viewer took over
      goTo(++p)
      if (p >= cursor.position) stopReplay()
    }, 1500 / speed)
  }, [result, session, goTo])

  const report = (p: Promise<unknown>) => {
    setRejected('')
    p.catch((e: Error) => setRejected(e.message))
  }

  const liveNav = (
    <>
      {nav}
      <span className="flex items-center gap-2 text-sm">
        <span className="relative flex h-2 w-2">
          <span className={`absolute inline-flex h-full w-full rounded-full ${connection ? 'bg-warn' : 'animate-ping bg-ok/70'}`} />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${connection ? 'bg-warn' : 'bg-ok'}`} />
        </span>
        <span className="text-ok">Live</span>
        {connection && <span className="text-warn">{connection}</span>}
        {rejected && (
          <span role="alert" className="text-danger">
            {rejected}
          </span>
        )}
      </span>
    </>
  )

  const lesson = session?.lesson
  // Inside a replay's range counts as following it.
  const away = !!lesson && position !== lesson.cursor.position && !(lesson.cursor.from !== undefined && position >= lesson.cursor.from && position < lesson.cursor.position)
  const backToLive = () => lesson && goTo(lesson.cursor.position)

  if (result?.ok)
    return (
      <Table
        scenario={result.scenario}
        nav={liveNav}
        lesson={
          lesson &&
          (away || lesson.queued > 0 || !!lesson.prompt) && (
            <LessonPanel
              lesson={lesson}
              away={away}
              onBackToLive={backToLive}
              onNext={() => {
                backToLive()
                report(api.next(id))
              }}
              onAnswer={(a) => report(api.answer(id, a))}
            />
          )
        }
        // Your moves wait until the queued steps have shown.
        onStep={lesson?.queued ? undefined : (step) => report(api.applyStep(id, step))}
        onUndo={() => report(api.undo(id))}
        onBranch={(position) => report(api.fork(id, position).then((s) => openSession(s.id, position)))}
        branchLabel="Fork"
      />
    )
  return (
    <>
      <TopBar nav={liveNav} />
      {!result ? (
        <p className="mt-12 text-center text-muted">{connection || 'Connecting…'}</p>
      ) : (
        <ScenarioErrors id={result.id} errors={result.errors}>
          <span className="text-muted">The session's file doesn't resolve in the browser. Check that scenarios/ matches the server.</span>
        </ScenarioErrors>
      )}
    </>
  )
}
