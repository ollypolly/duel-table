// Live mode: follow a server session over SSE. The session arrives as a
// scenario file, so it resolves and plays back exactly like any scenario;
// free-play moves are POSTed as steps instead of saved to a branch.
//
// In a lesson, steps still queued are left out, and the presenter cursor
// moves viewers who are following along. Anyone who has scrubbed away stays
// put and gets a Back to live button.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { api, subscribeSession, type SessionUpdate } from '../../api/client'
import type { Cursor } from '../../api/lesson'
import type { Iid, ZoneRef } from '../../engine'
import { cardDb } from '../../data/cards'
import { isMonster } from '../../data/cardDb'
import { useUiStore } from '../../store/uiStore'
import { VIEWER, cardFace } from '../../view/boardView'
import { turnSoFar } from '../../view/plays'
import { rawDecks, rawScenarios } from '../../scenarios/load'
import { resolveScenario } from '../../scenarios/resolve'
import { usePlayerStore } from '../../store/playerStore'
import { ScenarioErrors } from '../ScenarioErrors/ScenarioErrors'
import { Table } from '../Table/Table'
import { scrollLogTo } from '../Game/chatScroll'
import { ClaudeChat, ClaudeInput } from '../Game/ClaudePanel'
import { TableChatInput, TableChatLog } from '../Friends/TableChat'
import { TableFun } from '../Friends/TableFun'
import { GameOver } from '../Friends/GameOver'
import { useAccountStore } from '../../store/accountStore'
import { TopBar } from '../TopBar/TopBar'
import { PICK_KINDS } from '../../api/game'
import { GamePanel, type GameChoice } from '../Game/GamePanel'
import { Spotlight } from '../Spotlight/Spotlight'
import { LessonPanel, LessonPlan } from './LessonPanel'
import { MOMENT } from './moment'
import { Moments } from './Moments'

// The scenario with the cards Claude is pointing at highlighted on the latest table.
// at: the step it's showing them, which is the latest unless it moved their view back.
type Marks = { point?: string[]; arrows?: { from: string; to: string }[] }
function pointed<S extends { timeline: { state: { highlights: string[]; arrows: { from: string; to: string }[] } }[] }>(scenario: S, { point = [], arrows = [] }: Marks, at: number): S {
  const entry = scenario.timeline[at]
  if (!entry || !(point.length || arrows.length)) return scenario
  const state = { ...entry.state, highlights: [...new Set([...entry.state.highlights, ...point])], arrows: [...entry.state.arrows, ...arrows] }
  return { ...scenario, timeline: scenario.timeline.with(at, { ...entry, state }) }
}

export function LiveTable({ id, nav }: { id: string; nav: ReactNode }) {
  const [session, setSession] = useState<SessionUpdate>()
  const [connection, setConnection] = useState('')
  const [rejected, setRejected] = useState('')
  const [picking, setPicking] = useState<GameChoice & { for?: number }>({ picked: [] })
  const [busy, setBusy] = useState(false)
  const me = useAccountStore((s) => s.me?.id)
  // An emoji picked to stick on a card, waiting for the card to be tapped.
  const [sticking, setSticking] = useState<string>()
  const { openSession, goTo } = usePlayerStore()
  const inspect = useUiStore((s) => s.inspect)
  const position = usePlayerStore((s) => s.position)
  const followed = useRef<Cursor>(undefined) // the last cursor acted on
  const replay = useRef<ReturnType<typeof setInterval>>(undefined)

  // Keyed by id in App, so a new session starts from fresh state.
  useEffect(() => subscribeSession(id, setSession, setConnection), [id])
  // A rematch that starts while you're here opens on both screens.
  const rematchSession = session?.file.duel?.rematch?.session
  const hadRematch = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!session) return
    if (rematchSession && hadRematch.current === '') openSession(rematchSession, Infinity)
    hadRematch.current = rematchSession ?? ''
  }, [session, rematchSession, openSession])

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
  // review, where you move about the game yourself. Before the paint, so a
  // move that just landed never shows for a frame as one you're behind on
  // (Back to live would flash).
  useLayoutEffect(() => {
    if (!result?.ok || !session) return
    const cursor = session.lesson.cursor
    const prev = followed.current
    if (prev?.seq === cursor.seq) return
    followed.current = cursor
    if (session.review) return
    // On a (re)load, straight to where it's got to, without replaying the last move.
    if (!prev) return goTo(cursor.position)
    const { position, speed } = usePlayerStore.getState()
    // You've gone elsewhere: stay there, unless Claude moved the view to show you a step.
    if (prev && position !== prev.position && !replay.current && !session.game?.claude?.back) return
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
  const answerRematch = (accept: boolean) => {
    setBusy(true)
    report(api.rematch(id, accept).finally(() => setBusy(false)))
  }

  // Games: what you've picked so far only counts for the question it was for.
  const game = session?.game
  const prompt = game && session.lesson.queued === 0 ? game.prompt : undefined
  const choice: GameChoice = picking.for === prompt?.id ? picking : { picked: [] }
  const setChoice = (c: GameChoice) => setPicking({ ...c, for: prompt?.id })
  const turn = useMemo(() => (game && result?.ok ? turnSoFar(result.scenario.game.steps, VIEWER) : undefined), [game, result])
  const answerGame = (choices: number[], sure = false) => {
    if (!prompt) return
    // Ending a turn you've played nothing in, with something to play, is asked first.
    const ending = prompt.kind === 'idle' && prompt.options[choices[0]]?.label === 'End turn'
    if (ending && !sure && turn?.plays === 0 && prompt.options.some((o) => o.card)) {
      toast("You haven't played a card this turn", { id: 'end', description: 'End it anyway?', action: { label: 'End turn', onClick: () => answerGame(choices, true) }, duration: 8000 })
      return
    }
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
  const [hot, setHot] = useState<{ for?: number; i?: number }>({}) // the zone option the pointer is on
  // Zones lit when zones are the question; a click picks one (or unpicks it).
  const zoneOptions = prompt ? prompt.options.flatMap((o, i) => (o.zone ? [{ ref: o.zone, picked: choice.picked.includes(i) || (hot.for === prompt.id && hot.i === i), i }] : [])) : []
  const chooseZone = (ref: ZoneRef) => {
    const z = zoneOptions.find((o) => o.ref.zone === ref.zone && o.ref.player === ref.player && o.ref.slot === ref.slot)
    if (!z || !prompt) return
    if (prompt.max === 1) answerGame([z.i])
    else setChoice({ ...choice, picked: choice.picked.includes(z.i) ? choice.picked.filter((p) => p !== z.i) : [...choice.picked, z.i] })
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
  // Whether there's a Claude login, for the response levels that ask it.
  const [claudeOn, setClaudeOn] = useState(false)
  useEffect(() => void api.claude().then((c) => setClaudeOn(c.available)), [])
  // A lesson Claude runs: no rematch, hints, coaching or sharing (it sees everything).
  const claudeLesson = !!claude?.holds
  const rematch =
    players?.p1.deck && players.p2.deck && !claudeLesson && !claude?.attempt && !game?.seats
      ? () =>
          report(
            api
              .createGame({ deck: players.p1.deck!, opponentDeck: players.p2.deck!, ...(claude && (claude.watch ? { model: claude.model, knowsDeck: claude.knowsDeck } : { claude: 'p2' as const, model: claude.model, coach: claude.coach })), ...(game?.bot === 'agent' && { bot: 'agent' as const }) })
              .then((s) => openSession(s.id, Infinity)),
          )
      : undefined

  const liveNav = (
    <>
      {nav}
      {/* Only when something's wrong: the connection, or a move the server turned down. */}
      {(connection || rejected) && (
        <span className="flex min-w-0 items-center gap-2 text-sm">
          {connection && (
            <>
              <span className="h-2 w-2 shrink-0 rounded-full bg-warn" />
              <span className="truncate text-warn">{connection}</span>
            </>
          )}
          {rejected && (
            <span role="alert" className="truncate text-danger">
              {rejected}
            </span>
          )}
        </span>
      )}
    </>
  )

  const lesson = session?.lesson
  // Inside a replay's range counts as following it.
  const strayed =
    !!lesson && position !== lesson.cursor.position && !(lesson.cursor.from !== undefined && position >= lesson.cursor.from && position < lesson.cursor.position)
  // Claude can move your view back to an earlier step: that's not where the game is either.
  const live = result?.ok ? result.scenario.timeline.length - 1 : 0
  const away = strayed || (!!lesson && !session?.review && position < live && lesson.cursor.position < live && lesson.cursor.from === undefined)
  const backToLive = () => goTo(live)

  // A review of a finished game takes the chat over, with the game's chat above it.
  const review = session?.review
  // In a review Claude moves you to a step itself, and marks up the table there.
  // Not a move made before the page loaded: you open a review where you left the game.
  const went = review?.go
  const lastGo = useRef<number>(undefined)
  const loaded = !!session
  useEffect(() => {
    if (!loaded) return
    const first = lastGo.current === undefined
    const n = went?.n ?? 0
    if (n === lastGo.current) return
    lastGo.current = n
    if (went && !first) goTo(went.step)
  }, [loaded, went, goTo])
  const marked = review ? review.marks : game?.claude
  const markedAt = review ? (review.marks?.step ?? -1) : Math.min(lesson?.cursor.position ?? live, live)

  // Cards Claude lifted off the table to show, until closed. Not while you've gone off to look at another step.
  const spot = review ? review.spotlight : game?.claude?.spotlight
  const [closedSpot, setClosedSpot] = useState<number>()
  const closeSpot = useCallback(() => setClosedSpot(spot?.n), [spot?.n])
  const spotlight = (() => {
    const off = review?.spotlight ? position !== review.spotlight.step : strayed
    if (!spot || spot.n === closedSpot || off || !result?.ok) return null
    const { state } = (review?.spotlight && result.scenario.timeline[review.spotlight.step]) || result.scenario.timeline.at(-1)!
    const cards = spot.cards.flatMap((iid) => (state.cards[iid] ? [{ ...cardFace(state, iid, cardDb, true), visible: true }] : []))
    return cards.length ? <Spotlight key={spot.n} cards={cards} say={spot.say} phrases={spot.phrases} keep={'keep' in spot && spot.keep} onClose={closeSpot} /> : null
  })()
  const steps = result?.ok ? result.scenario.game.steps.length : 0
  // Going to a moment Claude marked shows the table just before the move,
  // and has Claude take you through it, or goes back to where it already did.
  // While Claude is busy, the ones it hasn't been through are locked, so a run
  // of clicks doesn't queue them all.
  const answered = new Set(review?.chat.filter((e) => e.from === 'claude').map((e) => e.moment))
  const momentLocked = (step: number) => review?.status === 'thinking' && !answered.has(step)
  const goMoment = (step: number) => {
    if (momentLocked(step)) return
    goTo(step - 1)
    if (!answered.has(step)) return report(api.reviewMoment(id, step))
    // After the table has moved, which can change the chat's height under a scroll.
    requestAnimationFrame(() => {
      const entry = document.querySelector(`[role=log] [data-moment="${step}"]`)
      if (entry) scrollLogTo(entry, true)
    })
  }
  // A review started from the end of the game goes back to the start, where
  // Claude's opening message and the first moment's Next are.
  const startReview = () => {
    goTo(0)
    report(api.startReview(id))
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
  // A review has its own Next, in the playback bar.
  const quick = review
    ? undefined
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

  // What you're being asked (lesson controls, the game's question). With a
  // chat it's the end of the chat, so it scrolls away with it; without one
  // it's pinned under the narration.
  const dock =
    result?.ok &&
    lesson &&
    (game || away || lesson.queued > 0 || !!lesson.prompt) && (
      <>
        {game?.claude?.goal && (
          <p className="rounded-md border border-gold/40 bg-gold/10 px-2.5 py-1.5 text-xs" data-testid="lesson-goal">
            <span className="font-semibold text-gold">Your goal</span> {game.claude.goal}
          </p>
        )}
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
            normalUsed={turn?.normalUsed}
            onHover={(i) => setHot({ for: prompt?.id, i })}
            onRematch={rematch}
            onAttempt={
              claudeOn && game.winner?.player === 'p2' && game.bots.includes('p2') && (claude?.attempt ? claude.attempt.over && claude.status !== 'thinking' : rematch && !(claude && !claude.watch))
                ? (tries) => report(api.attempt(id, tries, claude?.model).then((s) => openSession(s.id, Infinity)))
                : undefined
            }
            onReview={review || claudeLesson ? undefined : startReview}
            onHint={game.claude && !claudeLesson && !game.claude.attempt ? () => report(api.chat(id, 'What should I do here, and why?', true)) : undefined}
            lesson={claudeLesson}
            onUndo={() => {
              setBusy(true)
              report(api.undoGame(id).finally(() => setBusy(false)))
            }}
            rematch={session.file.duel?.rematch}
            onRematchAnswer={game.seats ? answerRematch : undefined}
            onOpen={(s) => openSession(s, Infinity)}
            onTakeback={(accept) => {
              setBusy(true)
              report(api.takeback(id, accept).finally(() => setBusy(false)))
            }}
            onForfeit={claudeLesson ? undefined : () => report(api.forfeitGame(id))}
            onFreePlay={claudeLesson || session?.fromTable || game.seats ? undefined : () => report(api.rules(id, false).then((s) => openSession(s.id, Infinity)))}
            onRespond={(respond) => report(api.gameSettings(id, { respond }))}
            onReopen={(at) => {
              setBusy(true)
              report(api.reopenGame(id, at).finally(() => setBusy(false)))
            }}
            claudeOn={claudeOn}
            busy={busy}
          />
        )}
      </>
    )
  const friendTable = !!game?.seats && session?.table
  const chatting = !!(review || game?.claude || friendTable)
  // The chat follows the question as it changes, as it does a new message.
  const dockKey = [lesson?.queued, lesson?.prompt?.id, game?.prompt?.id, game?.winner, away].join()

  const reviewChat = review && {
    log: (
      <>
        <ClaudeChat
          claude={review}
          empty={
            review.scanned
              ? "Ask Claude about the game. It sees the table at the step you're on, and knows how it went."
              : 'Claude is going through the game for its key moments. Ask it anything meanwhile.'
          }
          earlier={game?.claude && { chat: game.claude.chat, divider: 'Reviewing with Claude' }}
          outlines={Object.fromEntries(review.moments.map((m) => [m.step, MOMENT[m.kind].ring]))}
          footer={dock}
          footerKey={dockKey}
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
  if (result?.ok)
    return (
      <>
      {spotlight}
      {friendTable && game.winner && (
        <GameOver
          game={game}
          them={session.players.p2.name}
          rematch={session.file.duel?.rematch}
          busy={busy}
          onRematch={answerRematch}
          onOpen={(s) => openSession(s, Infinity)}
          onReview={review ? undefined : startReview}
        />
      )}
      {friendTable && (
        <TableFun
          table={friendTable}
          state={result.scenario.timeline.at(-1)!.state}
          sticking={sticking}
          onStick={(card) => {
            report(api.tableFun(id, { emoji: sticking, card }))
            setSticking(undefined)
          }}
          onCancel={() => setSticking(undefined)}
        />
      )}
      <Table
        scenario={pointed(result.scenario, marked ?? {}, markedAt)}
        circled={(review ? position !== markedAt : strayed) ? undefined : marked?.zones}
        nav={liveNav}
        chat={
          reviewChat ||
          (friendTable && {
            log: <TableChatLog table={friendTable} me={me} footer={dock} footerKey={dockKey} />,
            input: <TableChatInput id={id} onSticker={setSticking} report={report} />,
          }) ||
          (game?.claude && {
            log: (
              <ClaudeChat
                claude={game.claude}
                {...(game.claude.watch && { empty: 'Claude is beside you for this game. Ask it what to play, or why something happened.' })}
                {...(game.claude.attempt && { empty: 'Claude is playing your side of the game you lost, from the same opening hand. It carries on whether or not you watch.' })}
                footer={dock}
                footerKey={dockKey}
              />
            ),
            input: (
              <ClaudeInput
                claude={claudeLesson || game.claude.watch || game.claude.attempt ? { ...game.claude, coach: undefined, share: undefined } : game.claude}
                {...((game.claude.watch || game.claude.attempt) && { placeholder: 'Ask Claude…' })}
                onChat={(text) => report(api.chat(id, text))}
                onStop={() => report(api.stopClaude(id))}
                onResume={() => report(api.resumeClaude(id))}
                onSettings={(s) => report(api.claudeSettings(id, s))}
              />
            ),
          })
        }
        quick={quick}
        clock={game?.startedAt ? { startedAt: game.startedAt, endedAt: game.endedAt } : undefined}
        marks={review?.moments.map((m) => ({ step: m.step, className: MOMENT[m.kind].dot, mark: MOMENT[m.kind].mark, title: `${MOMENT[m.kind].label}, step ${m.step}: ${m.title}`, disabled: momentLocked(m.step) }))}
        onMark={review ? goMoment : undefined}
        stepNav={
          !review && game?.claude?.plan ? (
            <LessonPlan plan={game.claude.plan} />
          ) : review && (
            <Moments
              moments={review.moments}
              names={{ p1: session.players.p1.name, p2: session.players.p2.name }}
              position={position}
              onGo={goMoment}
              locked={(m) => momentLocked(m.step)}
              busy={review.status === 'thinking'}
            />
          )
        }
        activity={
          game && {
            typing: talking?.status === 'thinking',
            messages: talking?.chat.filter((e) => e.from === 'claude').length ?? 0,
            latest: talking?.chat.findLast((e) => e.from === 'claude')?.text,
            action: !!game.prompt,
            asking: game.prompt?.message,
            ...(review && { who: 'Claude' }),
          }
        }
        dock={chatting ? undefined : dock}
        // Your moves wait until the queued steps have shown.
        onStep={game || lesson?.queued ? undefined : (step) => report(api.applyStep(id, step))}
        onUndo={game ? undefined : () => report(api.undo(id))}
        onRulesOn={game ? undefined : () => report(api.rules(id, true).then((s) => openSession(s.id, Infinity)))}
        onRulesOff={game && session?.fromTable ? () => report(api.rules(id, false).then((s) => openSession(s.id, Infinity))) : undefined}
        choosable={prompt && !away ? prompt.options.flatMap((o) => (o.card ? [o.card] : [])) : undefined}
        onChoose={prompt && !away ? chooseCard : undefined}
        choosableZones={zoneOptions.length && !away ? zoneOptions : undefined}
        onChooseZone={chooseZone}
        cardActions={prompt && !away ? cardActions : undefined}
        cardOptions={prompt && !away && !busy ? (iid) => optionsFor(iid).map((o) => ({ label: o.label, run: () => answerGame([o.i]) })) : undefined}
        draggable={away ? undefined : draggable}
        onCardDrop={prompt && !away ? dropCard : undefined}
        // Forking a game doesn't cut its saved answers yet, so it's off for games.
        onBranch={game ? undefined : (position) => report(api.fork(id, position).then((s) => openSession(s.id, position)))}
        branchLabel="Fork"
      />
      </>
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
