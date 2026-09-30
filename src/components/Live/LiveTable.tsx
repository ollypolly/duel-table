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
import type { Iid, ZoneRef } from '../../engine'
import { cardDb } from '../../data/cards'
import { isMonster } from '../../data/cardDb'
import { useUiStore } from '../../store/uiStore'
import { rawDecks, rawScenarios } from '../../scenarios/load'
import { resolveScenario } from '../../scenarios/resolve'
import { usePlayerStore } from '../../store/playerStore'
import { ScenarioErrors } from '../ScenarioErrors/ScenarioErrors'
import { Table } from '../Table/Table'
import { ClaudeChat, ClaudeInput } from '../Game/ClaudePanel'
import { TopBar } from '../TopBar/TopBar'
import { PICK_KINDS } from '../../api/game'
import { GamePanel, type GameChoice } from '../Game/GamePanel'
import { LessonPanel } from './LessonPanel'
import { MOMENT } from './moment'
import { Moments } from './Moments'

export function LiveTable({ id, nav }: { id: string; nav: ReactNode }) {
  const [session, setSession] = useState<SessionUpdate>()
  const [connection, setConnection] = useState('')
  const [rejected, setRejected] = useState('')
  const [picking, setPicking] = useState<GameChoice & { for?: number }>({ picked: [] })
  const [busy, setBusy] = useState(false)
  const { openSession, goTo } = usePlayerStore()
  const inspect = useUiStore((s) => s.inspect)
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

  // Follow the presenter cursor if you were where it last pointed. Not in a
  // review, where you move about the game yourself.
  useEffect(() => {
    if (!result?.ok || !session) return
    const cursor = session.lesson.cursor
    const prev = followed.current
    if (prev?.seq === cursor.seq) return
    followed.current = cursor
    if (session.review) return
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

  // Games: what you've picked so far only counts for the question it was for.
  const game = session?.game
  const prompt = game && session.lesson.queued === 0 ? game.prompt : undefined
  const choice: GameChoice = picking.for === prompt?.id ? picking : { picked: [] }
  const setChoice = (c: GameChoice) => setPicking({ ...c, for: prompt?.id })
  const answerGame = (choices: number[]) => {
    if (!prompt) return
    setBusy(true)
    report(api.answerGame(id, { id: prompt.id, choices }).finally(() => setBusy(false)))
  }
  // Clicking a lit card picks it when picking cards is the question;
  // otherwise it opens with its options (cardActions).
  const chooseCard = (iid: Iid) => {
    if (!prompt) return false
    const matching = prompt.options.flatMap((o, i) => (o.card === iid ? [i] : []))
    if (prompt.max > 1) {
      const i = matching.find((m) => !choice.picked.includes(m))
      setChoice({ ...choice, picked: i === undefined ? choice.picked.filter((p) => !matching.includes(p)) : [...choice.picked, i] })
      return true
    }
    if (!PICK_KINDS.includes(prompt.kind)) return false
    answerGame([matching[0]])
    return true
  }
  const optionsFor = (iid: Iid) => (prompt && prompt.max === 1 ? prompt.options.flatMap((o, i) => (o.card === iid ? [{ ...o, i }] : [])) : [])
  const cardActions = (iid: Iid, close: () => void) => {
    const options = optionsFor(iid)
    if (!options.length) return undefined
    return (
      <div className="space-y-2" data-testid="card-actions">
        <p className="text-xs text-muted">{prompt!.message}</p>
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o.i}
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                answerGame([o.i])
                close()
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    )
  }
  // Dragging a card from hand onto the field: summon or set a monster on a
  // monster zone, set or activate a Spell/Trap on a Spell & Trap zone. One
  // fitting option is the answer; several open the card to pick from.
  const DROPS: Partial<Record<string, string[]>> = {
    monster: ['Summon', 'Set'],
    extraMonster: ['Summon'],
    spellTrap: ['Set', 'Activate'],
    fieldSpell: ['Set', 'Activate'],
  }
  const dropCard = (iid: Iid, to: ZoneRef) => {
    const data = result?.ok ? cardDb.byId(result.scenario.timeline.at(-1)!.state.cards[iid]?.cardId ?? -1) : undefined
    const monster = !!data && isMonster(data)
    if ((to.player && to.player !== 'p1') || monster !== (to.zone === 'monster' || to.zone === 'extraMonster')) return
    const fits = optionsFor(iid).filter((o) => DROPS[to.zone]?.includes(o.group ?? ''))
    if (fits.length === 1) answerGame([fits[0].i])
    else if (fits.length > 1) inspect(iid)
  }
  const draggable =
    prompt?.kind === 'idle' ? [...new Set(prompt.options.filter((o) => o.card && ['Summon', 'Set', 'Activate'].includes(o.group ?? '')).map((o) => o.card!))] : undefined

  // The same decks and opponent again, with a fresh shuffle.
  const players = session?.file.players
  const claude = game?.claude
  // A lesson Claude runs: no rematch, hints, coaching or sharing (it sees everything).
  const claudeLesson = !!claude?.holds
  const rematch =
    players?.p1.deck && players.p2.deck && !claudeLesson
      ? () =>
          report(
            api
              .createGame({ deck: players.p1.deck!, opponentDeck: players.p2.deck!, ...(claude && { claude: 'p2' as const, model: claude.model, coach: claude.coach }) })
              .then((s) => openSession(s.id, Infinity)),
          )
      : undefined

  const liveNav = (
    <>
      {nav}
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <span className="relative flex h-2 w-2">
          <span className={`absolute inline-flex h-full w-full rounded-full ${connection ? 'bg-warn' : 'animate-ping bg-ok/70'}`} />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${connection ? 'bg-warn' : 'bg-ok'}`} />
        </span>
        <span className="hidden text-ok sm:inline">Live</span>
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
  const away =
    !!lesson && position !== lesson.cursor.position && !(lesson.cursor.from !== undefined && position >= lesson.cursor.from && position < lesson.cursor.position)
  const backToLive = () => lesson && goTo(lesson.cursor.position)

  // A review of a finished game takes the chat over, with the game's chat above it.
  const review = session?.review
  const steps = result?.ok ? result.scenario.game.steps.length : 0
  // Going to a moment Claude marked shows the table just before the move,
  // and has Claude take you through it.
  const goMoment = (step: number) => {
    goTo(step - 1)
    report(api.reviewMoment(id, step))
  }
  const reviewChat = review && {
    log: (
      <>
        <Moments
          moments={review.moments}
          names={{ p1: session.players.p1.name, p2: session.players.p2.name }}
          position={position}
          onGo={goMoment}
        />
        <ClaudeChat
          claude={review}
          empty={
            review.scanned
              ? "Ask Claude about the game. It sees the table at the step you're on, and knows how it went."
              : 'Claude is going through the game for its key moments. Ask it anything meanwhile.'
          }
          earlier={game?.claude && { chat: game.claude.chat, divider: 'Reviewing with Claude' }}
        />
      </>
    ),
    input: (
      <ClaudeInput
        claude={review}
        placeholder="Ask about this step…"
        onChat={(text) => report(api.askReview(id, text, Math.min(usePlayerStore.getState().position, steps)))}
        onStop={() => report(api.stopReview(id))}
        onSettings={(s) => report(api.reviewSettings(id, { model: s.model }))}
        onClear={() => report(api.clearReview(id))}
        onEnd={{ label: game?.claude ? "Back to the game's chat" : 'Close the review', run: () => report(api.closeReview(id)) }}
      />
    ),
  }
  const talking = review ?? game?.claude

  // The quick button: what you'd most likely press next when it's routine.
  // Not where it takes a real choice (which cards, yes or no).
  const next = () => {
    backToLive()
    report(api.next(id))
  }
  const option = (...labels: string[]) => {
    for (const label of labels) {
      const i = prompt?.options.findIndex((o) => !o.card && o.label === label) ?? -1
      if (i >= 0) return { label, run: () => answerGame([i]) }
    }
  }
  const ack = lesson?.queued === 0 && lesson.prompt?.type === 'ack' ? lesson.prompt : undefined
  // Past the last moment, it goes round to the first.
  const moments = review?.moments ?? []
  const nextMoment = moments.find((m) => m.step - 1 > position) ?? moments[0]
  const quick = review
    ? nextMoment && { label: nextMoment === moments[0] ? 'First moment ▸' : 'Next moment ▸', run: () => goMoment(nextMoment.step) }
    : lesson && lesson.queued > 0
      ? { label: 'Next ▸', run: next }
      : ack
        ? { label: ack.button ?? 'Got it', run: () => report(api.answer(id, { id: ack.id })) }
        : busy || away
          ? undefined
          : prompt?.kind === 'chain'
            ? option("Don't respond")
            : prompt?.kind === 'idle'
              ? option('Battle Phase', 'End turn')
              : prompt?.kind === 'battle'
                ? option('Main Phase 2', 'End turn')
                : undefined

  if (result?.ok)
    return (
      <Table
        scenario={result.scenario}
        nav={liveNav}
        chat={
          reviewChat ||
          (game?.claude && {
            log: <ClaudeChat claude={game.claude} />,
            input: (
              <ClaudeInput
                claude={claudeLesson ? { ...game.claude, coach: undefined, share: undefined } : game.claude}
                onChat={(text) => report(api.chat(id, text))}
                onStop={() => report(api.stopClaude(id))}
                onResume={() => report(api.resumeClaude(id))}
                onSettings={(s) => report(api.claudeSettings(id, s))}
              />
            ),
          })
        }
        quick={quick}
        marks={review?.moments.map((m) => ({ step: m.step, className: MOMENT[m.kind].dot }))}
        activity={
          game && {
            typing: talking?.status === 'thinking',
            messages: talking?.chat.filter((e) => e.from === 'claude').length ?? 0,
            latest: talking?.chat.findLast((e) => e.from === 'claude')?.text,
            action: !!game.prompt,
            ...(review && { who: 'Claude' }),
          }
        }
        dock={
          lesson &&
          (game || away || lesson.queued > 0 || !!lesson.prompt) && (
            <>
              <LessonPanel
                lesson={lesson}
                away={away && !review}
                onBackToLive={backToLive}
                onNext={next}
                onAnswer={(a) => report(api.answer(id, a))}
              />
              {game && lesson.queued === 0 && (!lesson.prompt || game.prompt) && (
                <GamePanel
                  game={game}
                  state={result.scenario.timeline.at(-1)!.state}
                  choice={choice}
                  onChoice={setChoice}
                  onAnswer={answerGame}
                  onRematch={rematch}
                  onHint={game.claude && !claudeLesson ? () => report(api.chat(id, 'What should I do here, and why?', true)) : undefined}
                  busy={busy}
                />
              )}
            </>
          )
        }
        // Your moves wait until the queued steps have shown.
        onStep={game || lesson?.queued ? undefined : (step) => report(api.applyStep(id, step))}
        onUndo={game ? undefined : () => report(api.undo(id))}
        choosable={prompt && !away ? prompt.options.flatMap((o) => (o.card ? [o.card] : [])) : undefined}
        onChoose={prompt && !away ? chooseCard : undefined}
        cardActions={prompt && !away ? cardActions : undefined}
        draggable={away ? undefined : draggable}
        onCardDrop={prompt && !away ? dropCard : undefined}
        // Forking a game doesn't cut its saved answers yet, so it's off for games.
        onBranch={game ? undefined : (position) => report(api.fork(id, position).then((s) => openSession(s.id, position)))}
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
