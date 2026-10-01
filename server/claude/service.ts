// Claude playing one side of a game. When the rules engine asks Claude's
// player something, or you send a chat message, Claude gets a message with
// what happened since it last looked, the table as it sees it, and the open
// question; it answers with its tools. One run at a time per game: chat sent
// meanwhile waits for the next run.
//
// Or Claude running a lesson: it sees the whole table, answers for the
// players it holds (both, to begin with), sets up positions, and hands you a
// player to try something. It pauses whenever it stops to talk, and carries
// on when you reply or when the duel comes back to a player it holds. It
// shows one move at a time: after each, you press Next when you've taken it
// in. It can also ask you a question to check you've followed.
//
// Each game's record (settings, chat, cost, the SDK session to resume) is
// saved by a ClaudeStore, so a game carries on after a restart.
import { mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatEntry, ClaudeSettings, ClaudeView, GamePrompt, ModelChoice } from '../../src/api/game'
import type { CardDb } from '../../src/data/cardDb'
import type { Character } from '../../src/scenarios/schema'
import type { BoardState, Player } from '../../src/engine'
import type { GameService } from '../games'
import { SessionError, type SessionService } from '../sessions'
import type { Agent, AgentRun, DuelTools } from './agent'
import { cardText, describeQuestion, describeTable, knownCards, optionLabel, publicLabel } from './view'

export type ClaudeRecord = {
  player: Player
  model: ModelChoice
  coach: boolean
  share: boolean // the person shows Claude their side
  sessionId?: string
  chat: ChatEntry[]
  costUsd: number
  seen: number // steps Claude has been told about
  texts?: string[] // cards whose text Claude has been given
  character?: Character // who Claude plays as, from its deck
  lesson?: LessonSeats
}

// A player Claude has handed to the person, until they've answered one
// question, until the turn ends (at is the turn it was handed over on), or
// until Claude takes it back.
export type Handover = { player: Player; until: 'answer' | 'turn' | 'takeBack'; at: number }
// waitingOn: the question Claude left open when it last stopped, so it isn't
// woken again for it. asking: the lesson prompt open for the person, Next or
// a question from Claude.
export type LessonSeats = { holds: Player[]; handed: Handover[]; waitingOn?: number; asking?: { id: string; question?: string } }

const HANDOVER_NOTE: Record<Handover['until'], string> = {
  answer: 'for one question',
  turn: 'until the end of this turn',
  takeBack: 'until Claude takes over again',
}

// Where a chat's record is kept between restarts: a game's, or a lesson's.
export type RecordStore<R> = { load(id: string): R | undefined; save(id: string, r: R): void; remove(id: string): void }
export type ClaudeStore = RecordStore<ClaudeRecord>

export const memoryClaudeStore = <R = ClaudeRecord>(): RecordStore<R> => {
  const m = new Map<string, R>()
  return { load: (id) => m.get(id), save: (id, r) => void m.set(id, r), remove: (id) => void m.delete(id) }
}

export const diskClaudeStore = <R = ClaudeRecord>(dir: string): RecordStore<R> => ({
  load: (id) => (existsSync(join(dir, `${id}.json`)) ? (JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as R) : undefined),
  save: (id, r) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(r, null, 2)}\n`)
  },
  remove: (id) => rmSync(join(dir, `${id}.json`), { force: true }),
})

const other = (p: Player): Player => (p === 'p1' ? 'p2' : 'p1')

// showOnce: the person asked for a hint, so the next message shows their side.
// notes: what else to tell Claude (in a lesson, Next pressed or an answer; a move taken back).
type Seat = ClaudeRecord & { status: ClaudeView['status']; queue: string[]; notes?: string[]; showOnce?: boolean; run?: AgentRun; busy: boolean }

// Moves Claude can play in a row in a lesson before it has to stop.
const MAX_BATCH = 20
const PLAY_ON = 'The person has nothing to decide yet, so play on and sum up when they do, unless this move needs explaining on its own.'

// Times Claude is reminded of a question it left open before a default pick.
const NUDGES = 2

export type ClaudeDeps = {
  games: GameService
  sessions: SessionService
  db: () => CardDb
  agent: Agent
  system: (seat: Pick<ClaudeRecord, 'coach' | 'character' | 'lesson'>) => string // the system prompt
  store?: ClaudeStore
}

export class ClaudeService {
  private seats = new Map<string, Seat>()
  private games: GameService
  private sessions: SessionService
  private db: () => CardDb
  private agent: Agent
  private system: ClaudeDeps['system']
  private store: ClaudeStore

  constructor({ games, sessions, db, agent, system, store = memoryClaudeStore() }: ClaudeDeps) {
    this.games = games
    this.sessions = sessions
    this.db = db
    this.agent = agent
    this.system = system
    this.store = store
    games.onCreate = (id, opts) => (opts.lesson ? this.join(id, 'p1', opts) : opts.claude && this.join(id, opts.claude, opts))
    games.onChange = (id) => void this.poke(id)
    games.onPersonAnswer = (id, player) => {
      const seat = this.seat(id)
      if (!seat?.lesson) return
      if (seat.lesson.holds.includes(player)) {
        this.withdraw(id, seat)
        seat.notes = [...(seat.notes ?? []), `The person made ${player}'s move themselves instead of pressing Next.`]
      }
      if (seat.lesson.handed.some((h) => h.player === player && h.until === 'answer')) this.takeBack(id, seat, player)
    }
    games.onUndo = (id) => {
      const seat = this.seat(id)
      if (!seat) return
      seat.seen = Math.min(seat.seen, this.sessions.export(id).steps.length)
      seat.notes = [...(seat.notes ?? []), 'Your opponent took back their last move, which the app allows a few times a game. The table below is the game now: what came after that move, your answers included, never happened.']
      seat.chat.push({ from: 'note', text: 'You took back your last move.' })
      this.changed(id, seat)
    }
    games.onForfeit = (id) => {
      const seat = this.seat(id)
      if (!seat) return
      seat.notes = [...(seat.notes ?? []), 'Your opponent forfeited the game, so you won. Nothing more can be played.']
      seat.chat.push({ from: 'note', text: 'You forfeited.' })
      this.changed(id, seat)
    }
    // While Claude waits in a lesson, the person can make p1's move themselves.
    games.claudeHolds = (id) => {
      const s = this.seat(id)
      return s && (s.lesson && !s.busy ? s.lesson.holds.filter((p) => p !== 'p1') : this.holds(s))
    }
    sessions.onAnswer.push((id, e) => {
      const seat = this.seat(id)
      const asking = seat?.lesson?.asking
      if (!seat || asking?.id !== e.prompt.id) return
      seat.lesson!.asking = undefined
      if (asking.question === undefined) seat.notes = [...(seat.notes ?? []), 'The person pressed Next: carry on.']
      else {
        const said = e.choice?.option ?? e.text ?? ''
        seat.chat.push({ from: 'you', text: said })
        seat.notes = [...(seat.notes ?? []), `The person answered your question "${asking.question}": ${said}`]
      }
      if (seat.status === 'stopped') seat.status = 'idle'
      this.changed(id, seat)
      void this.poke(id)
    })
    sessions.onRemove.push((id) => {
      void this.seats.get(id)?.run?.interrupt()
      this.seats.delete(id)
      this.store.remove(id)
    })
    games.claudeView = (id) => {
      const s = this.seat(id)
      return (
        s && {
          player: s.player,
          model: s.model,
          coach: s.coach,
          share: s.share,
          status: s.status,
          chat: s.chat,
          costUsd: s.costUsd,
          ...(s.lesson && { holds: s.lesson.holds }),
        }
      )
    }
  }

  // Seat Claude in a new game (before its first move). A lesson starts with
  // what you asked to learn.
  join(id: string, player: Player, opts: { model?: ModelChoice; coach?: boolean; lesson?: boolean; topic?: string } = {}) {
    const character = this.sessions.export(id).players?.[player].list?.character
    const seat: Seat = {
      player,
      ...(character && { character }),
      model: opts.model ?? 'opus',
      coach: opts.coach ?? true,
      share: false,
      chat: [],
      costUsd: 0,
      seen: 0,
      status: 'idle',
      queue: [],
      busy: false,
      ...(opts.lesson && { lesson: { holds: ['p1', 'p2'], handed: [] } }),
    }
    const topic = opts.topic?.trim()
    if (opts.lesson) {
      seat.chat.push({ from: 'you', text: topic || 'Teach me this deck.' })
      seat.queue.push(topic || 'Teach me this deck.')
    }
    this.seats.set(id, seat)
    this.save(id, seat)
  }

  // show: send your hidden cards with this message only (a hint).
  chat(id: string, text: string, show = false) {
    const seat = this.need(id)
    seat.chat.push({ from: 'you', text })
    seat.queue.push(text)
    if (show) seat.showOnce = true
    this.withdraw(id, seat)
    if (seat.status === 'stopped') seat.status = 'idle'
    this.changed(id, seat)
    void this.poke(id)
  }

  async stop(id: string) {
    const seat = this.need(id)
    seat.queue = []
    seat.status = 'stopped'
    this.changed(id, seat)
    await seat.run?.interrupt()
  }

  // Carry on after Stop without saying anything.
  resume(id: string) {
    const seat = this.need(id)
    if (seat.status === 'stopped') seat.status = 'idle'
    this.changed(id, seat)
    void this.poke(id)
  }

  settings(id: string, s: ClaudeSettings) {
    const seat = this.need(id)
    Object.assign(seat, s)
    if (s.share !== undefined)
      seat.chat.push({
        from: 'note',
        text: s.share ? 'Claude can now see your hidden cards: hand, face-down cards and Extra Deck.' : "Claude can't see your hidden cards any more.",
      })
    this.changed(id, seat)
  }

  // Wait for Claude to settle (tests).
  async idle(id: string) {
    while (this.seat(id)?.busy) await new Promise((r) => setTimeout(r, 5))
  }

  // Which side Claude played and what was said, for a review of the game.
  played(id: string): Pick<ClaudeRecord, 'player' | 'chat'> | undefined {
    const s = this.seat(id)
    return s && { player: s.player, chat: s.chat }
  }

  private seat(id: string): Seat | undefined {
    const found = this.seats.get(id)
    if (found) return found
    let duel: ReturnType<SessionService['export']>['duel']
    try {
      duel = this.sessions.export(id).duel
    } catch {
      return undefined
    }
    const player = duel?.claude ?? (duel?.lesson ? 'p1' : undefined)
    if (!player) return undefined
    const rec: ClaudeRecord = this.store.load(id) ?? {
      player,
      model: 'opus',
      coach: true,
      share: false,
      chat: [],
      costUsd: 0,
      seen: 0,
      ...(duel?.lesson && { lesson: { holds: ['p1', 'p2'], handed: [] } }),
    }
    const seat: Seat = { ...rec, share: rec.share ?? false, status: 'idle', queue: [], busy: false }
    this.seats.set(id, seat)
    return seat
  }

  private need(id: string): Seat {
    const s = this.seat(id)
    if (!s) throw new SessionError(409, `Claude isn't playing in session ${id}`)
    return s
  }

  // Run Claude while it has something to do: an open question, or chat.
  private async poke(id: string) {
    const seat = this.seat(id)
    if (!seat || seat.busy) return
    seat.busy = true
    try {
      let nudges = 0
      let lastAsked: number | undefined
      for (;;) {
        if (this.stopped(seat)) break
        if (seat.lesson) {
          await this.turnOver(id, seat)
          const prompt = await this.question(id, seat)
          if (!seat.queue.length && !seat.notes?.length && (!prompt || prompt.id === seat.lesson.waitingOn)) break
          await this.run(id, seat, await this.lessonMessage(id, seat, prompt))
          seat.lesson.waitingOn = (await this.question(id, seat))?.id
          const waiting = await this.question(id, seat)
          if (waiting && !seat.lesson.asking && !seat.queue.length && !this.stopped(seat)) this.askNext(id, seat, waiting.player)
          continue
        }
        const prompt = await this.games.asking(id, seat.player)
        if (!prompt && !seat.queue.length) break
        nudges = prompt && prompt.id === lastAsked ? nudges + 1 : 0
        if (prompt && nudges > NUDGES) {
          await this.defaultAnswer(id, seat, prompt)
          continue
        }
        lastAsked = prompt?.id
        await this.run(id, seat, await this.message(id, seat, prompt, nudges > 0))
      }
    } finally {
      seat.busy = false
      this.changed(id, seat)
    }
  }

  private async message(id: string, seat: Seat, prompt: GamePrompt | undefined, nudge: boolean): Promise<string> {
    const { state } = await this.games.get(id)
    const parts: string[] = []
    parts.push(...(seat.notes?.splice(0) ?? []))
    const said = seat.queue.splice(0)
    for (const text of said) parts.push(`Your opponent says: ${text}`)
    const events = this.catchUp(id, seat)
    if (events.length) parts.push(`Since you last looked:\n${events.map((e) => `- ${e}`).join('\n')}`)
    // Talking to Claude while they have a decision shows it their question
    // (and so the cards it names), as a hint does: it's what they're asking about.
    const theirs = await this.games.asking(id, other(seat.player))
    const shown = seat.share || !!seat.showOnce || (said.length > 0 && !!theirs)
    seat.showOnce = false
    parts.push(this.texts(state, seat, shown), describeTable(state, seat.player, this.db(), shown))
    if (shown) {
      parts.push('Your opponent is showing you their hidden cards (named above) so you can advise them: when they ask, explain the best play for them and why.')
      if (theirs) parts.push(describeQuestion(theirs, state, other(seat.player), this.db(), true))
    }
    if (prompt) {
      if (nudge) parts.push(`You haven't answered question ${prompt.id} yet. Answer it with the answer tool.`)
      parts.push(describeQuestion(prompt, state, seat.player, this.db()))
    } else parts.push("There's no question for you right now; just reply.")
    return parts.filter(Boolean).join('\n\n')
  }

  // The text of each card Claude knows of and hasn't been given yet, so it
  // plays from the real text rather than memory.
  private texts(state: BoardState, seat: Seat, shown: boolean): string {
    const given = new Set(seat.texts)
    const fresh = knownCards(state, seat.player, this.db(), shown).filter((n) => !given.has(n))
    if (!fresh.length) return ''
    seat.texts = [...given, ...fresh]
    return `Card texts (new to you):\n${fresh.map((n) => cardText(this.db(), n)).join('\n\n')}`
  }

  // Labels of the steps since Claude last looked, as its player sees them.
  private catchUp(id: string, seat: Seat): string[] {
    const { steps } = this.sessions.export(id)
    const state = this.sessions.get(id).state
    // A lesson shows Claude everything.
    const label = (l: string) => (seat.lesson ? l : publicLabel(l, state, seat.player, this.db()))
    const fresh = steps.slice(seat.seen).flatMap((s) => (s.label ? [label(s.label)] : []))
    seat.seen = steps.length
    return fresh
  }

  private async run(id: string, seat: Seat, message: string) {
    seat.status = 'thinking'
    this.changed(id, seat)
    const tools = seat.lesson ? this.lessonTools(id, seat) : this.tools(id, seat)
    const run = this.agent({ message, system: this.system(seat), model: seat.model, sessionId: seat.sessionId, tools })
    seat.run = run
    try {
      for await (const e of run.events) {
        if (e.type === 'text') seat.chat.push({ from: 'claude', text: e.text })
        if (e.type === 'done') {
          seat.sessionId = e.sessionId ?? seat.sessionId
          seat.costUsd += e.costUsd
          if (e.error && !this.stopped(seat)) seat.chat.push({ from: 'note', text: `Claude stopped with an error: ${e.error}` })
        }
        this.changed(id, seat)
      }
    } finally {
      seat.run = undefined
      if (seat.status === 'thinking') seat.status = 'idle'
    }
  }

  private tools(id: string, seat: Seat): DuelTools {
    return {
      table: () => describeTable(this.sessions.get(id).state, seat.player, this.db(), seat.share),
      card: (name) => cardText(this.db(), name),
      answer: async (question, choices) => {
        const prompt = await this.games.asking(id, seat.player)
        if (!prompt || prompt.id !== question) return prompt ? `Question ${question} isn't open; question ${prompt.id} is.` : "There's no open question for you."
        const state = (await this.games.get(id)).state
        const picked = choices.map((c) => (c < prompt.options.length ? optionLabel(prompt, c, state, seat.player, this.db()) : `#${c}`))
        try {
          await this.games.answer(id, seat.player, { id: question, choices })
        } catch (e) {
          return `Not accepted: ${(e as Error).message}`
        }
        seat.chat.push({ from: 'move', text: picked.join(', ') })
        this.changed(id, seat)
        return this.afterAnswer(id, seat)
      },
    }
  }

  // What an answer led to, and the next question if it's Claude's.
  private async afterAnswer(id: string, seat: Seat): Promise<string> {
    const events = this.catchUp(id, seat)
    const game = await this.games.get(id)
    const parts = [events.length ? `Done. Then:\n${events.map((e) => `- ${e}`).join('\n')}` : 'Done.', this.texts(game.state, seat, seat.share)].filter(Boolean)
    const winner = game.duel.result
    const next = await this.games.asking(id, seat.player)
    if (winner) parts.push(`The duel is over: ${winner.player === seat.player ? 'you won' : 'your opponent won'}.`)
    else if (next) parts.push(describeQuestion(next, game.state, seat.player, this.db()))
    else parts.push('Your opponent is deciding now. Stop here; you will get a message when you are asked something.')
    return parts.join('\n\n')
  }

  // Lessons ---------------------------------------------------------------------

  private holds(seat: Seat): Player[] {
    return seat.lesson ? seat.lesson.holds : [seat.player]
  }

  // The open question, if it's for a player Claude holds.
  private async question(id: string, seat: Seat) {
    for (const p of this.holds(seat)) {
      const q = await this.games.asking(id, p)
      if (q) return q
    }
  }

  // Take back the players handed over until the end of a turn that's over.
  private async turnOver(id: string, seat: Seat) {
    const { turn } = (await this.games.get(id)).state
    for (const h of seat.lesson!.handed) if (h.until === 'turn' && turn > h.at) this.takeBack(id, seat, h.player)
  }

  private takeBack(id: string, seat: Seat, player: Player) {
    const lesson = seat.lesson!
    if (!lesson.handed.some((h) => h.player === player)) return
    lesson.handed = lesson.handed.filter((h) => h.player !== player)
    lesson.holds = [...lesson.holds, player]
    const name = this.sessions.get(id).state.players[player].name
    seat.chat.push({ from: 'note', text: `Claude is playing ${name} again.` })
    this.changed(id, seat)
    void this.poke(id)
  }

  private async lessonMessage(id: string, seat: Seat, prompt: GamePrompt | undefined): Promise<string> {
    const { state } = await this.games.get(id)
    const parts: string[] = []
    parts.push(...(seat.notes?.splice(0) ?? []))
    for (const text of seat.queue.splice(0)) parts.push(`The person says: ${text}`)
    const events = this.catchUp(id, seat)
    if (events.length) parts.push(`Since you last looked:\n${events.map((e) => `- ${e}`).join('\n')}`)
    parts.push(this.texts(state, seat, true), describeTable(state, 'p1', this.db(), true), this.seatsNote(id, seat))
    if (prompt) parts.push(this.lessonQuestion(prompt, state))
    else parts.push('Nothing is being asked of a player you hold right now.')
    // Handed p1, the person may be asking about their own decision.
    const theirs = seat.lesson!.holds.includes('p1') ? undefined : await this.games.asking(id, 'p1')
    if (theirs) parts.push(`The person is deciding. ${this.lessonQuestion(theirs, state)}`)
    return parts.filter(Boolean).join('\n\n')
  }

  private lessonQuestion(prompt: GamePrompt, state: BoardState) {
    return `For ${prompt.player} (${state.players[prompt.player].name}): ${describeQuestion(prompt, state, prompt.player, this.db())}`
  }

  private seatsNote(id: string, seat: Seat) {
    const { players } = this.sessions.get(id).state
    const who = (p: Player) => `${p} (${players[p].name})`
    const { holds, handed } = seat.lesson!
    return [
      holds.length ? `You're playing ${holds.map(who).join(' and ')}.` : "You aren't playing either side right now.",
      ...handed.map(
        (h) =>
          `The person is playing ${who(h.player)} ${h.until === 'answer' ? 'for one question' : h.until === 'turn' ? 'until the end of this turn' : 'until you take it back'}.`,
      ),
    ].join(' ')
  }

  // The person's Next, for when they've taken in Claude's last move. On p1's
  // turn to decide, they can pick the move themselves instead.
  private askNext(id: string, seat: Seat, player: Player) {
    const prompt =
      player === 'p1'
        ? { type: 'ack' as const, message: 'Your side to move: pick a move yourself, or let Claude play it.', button: 'Let Claude play it' }
        : { type: 'ack' as const, message: 'Take your time. Ready for the next move?', button: 'Next' }
    try {
      const open = this.sessions.ask(id, prompt)
      seat.lesson!.asking = { id: open.id }
    } catch {
      // Something else is open for the person.
    }
  }

  // Withdraw the lesson prompt Claude opened, when the person writes or moves instead.
  private withdraw(id: string, seat: Seat) {
    if (!seat.lesson?.asking) return
    seat.lesson.asking = undefined
    try {
      this.sessions.withdraw(id)
    } catch {
      // Already gone (the game was restarted).
    }
  }

  // One move a run, unless Claude batches routine moves (up to MAX_BATCH):
  // after a move, a new position or a question, Claude explains and stops,
  // and carries on when the person presses Next. The opponent's moves run
  // on by themselves while p1 has nothing to decide in between.
  private lessonTools(id: string, seat: Seat): DuelTools {
    const lesson = seat.lesson!
    let paused: 'moved' | 'asked' | undefined
    let batched = 0
    const wait = () =>
      paused === 'asked'
        ? "Wait: you've asked the person something. Stop here; their answer comes as a message."
        : "Wait: give the person a chance to take that in. Explain what just happened and why, then stop. They press Next when they're ready, and you get a message."
    return {
      table: () => [describeTable(this.sessions.get(id).state, 'p1', this.db(), true), this.seatsNote(id, seat)].join('\n\n'),
      card: (name) => cardText(this.db(), name),
      answer: async (question, choices, batch) => {
        if (paused) return wait()
        const prompt = await this.question(id, seat)
        if (!prompt || prompt.id !== question)
          return prompt ? `Question ${question} isn't open; question ${prompt.id} is.` : "There's no open question for a player you hold."
        const before = this.sessions.export(id).steps.length
        const state = (await this.games.get(id)).state
        const picked = choices.map((c) => (c < prompt.options.length ? optionLabel(prompt, c, state, prompt.player, this.db()) : `#${c}`))
        try {
          await this.games.answer(id, prompt.player, { id: question, choices })
        } catch (e) {
          return `Not accepted: ${(e as Error).message}`
        }
        seat.chat.push({ from: 'move', text: `${state.players[prompt.player].name}: ${picked.join(', ')}` })
        this.changed(id, seat)
        const { steps } = this.sessions.export(id)
        const next = await this.question(id, seat)
        const runOn = batch || (prompt.player === 'p2' && next?.player === 'p2')
        const moved = steps.slice(before).some((s) => s.label)
        if (moved && (!runOn || ++batched >= MAX_BATCH)) paused = 'moved'
        const result = await this.afterLessonAnswer(id, seat)
        if (paused) return `${result}\n\n${wait()}`
        return moved && !batch && runOn ? `${result}\n\n${PLAY_ON}` : result
      },
      setup: async (setup, lp) => {
        if (paused) return wait()
        try {
          seat.seen = 0
          lesson.handed = []
          lesson.holds = ['p1', 'p2']
          lesson.waitingOn = undefined
          lesson.asking = undefined
          await this.games.restart(id, setup, lp)
        } catch (e) {
          const err = e as SessionError
          return `That setup didn't work: ${err.message}${err.details?.length ? `\n${err.details.join('\n')}` : ''}`
        }
        seat.chat.push({ from: 'note', text: 'Claude set up a new position.' })
        this.changed(id, seat)
        paused = 'moved'
        return [
          "Set up. The duel starts over from here, on p1's turn in Main Phase 1.",
          await this.afterLessonAnswer(id, seat),
          "Wait: before playing from here, tell the person what they're looking at and stop. They press Next when they're ready.",
        ].join('\n\n')
      },
      ask: (question, options) => {
        if (paused === 'asked') return wait()
        const prompt = options?.length ? { type: 'choice' as const, message: question, options } : { type: 'text' as const, message: question }
        this.withdraw(id, seat)
        try {
          lesson.asking = { id: this.sessions.ask(id, prompt).id, question }
        } catch (e) {
          return `Couldn't ask: ${(e as Error).message}`
        }
        paused = 'asked'
        return 'Asked. Stop here; their answer comes as a message.'
      },
      handOver: async (player, until) => {
        if (!lesson.holds.includes(player)) return `You aren't playing ${player} right now.`
        const { state } = await this.games.get(id)
        lesson.holds = lesson.holds.filter((p) => p !== player)
        lesson.handed = [...lesson.handed, { player, until, at: state.turn }]
        seat.chat.push({ from: 'note', text: `Your go: you're playing ${state.players[player].name} ${HANDOVER_NOTE[until]}.` })
        this.changed(id, seat)
        const next = await this.question(id, seat)
        return next
          ? `Handed over. You're still asked this:\n\n${this.lessonQuestion(next, state)}`
          : 'Handed over. Stop here: you will get a message when the duel comes back to a player you hold, or when the person writes.'
      },
      takeBack: (player) => {
        if (!lesson.handed.some((h) => h.player === player)) return `The person isn't playing ${player}.`
        this.takeBack(id, seat, player)
        return `You're playing ${player} again.`
      },
    }
  }

  // What an answer led to, and the next question for a player Claude holds.
  private async afterLessonAnswer(id: string, seat: Seat): Promise<string> {
    const events = this.catchUp(id, seat)
    const game = await this.games.get(id)
    const parts = [events.length ? `Then:\n${events.map((e) => `- ${e}`).join('\n')}` : '', this.texts(game.state, seat, true)].filter(Boolean)
    const winner = game.duel.result
    const next = await this.question(id, seat)
    if (winner) parts.push(`The duel is over: ${winner.player} (${game.state.players[winner.player].name}) won.`)
    else if (next) parts.push(this.lessonQuestion(next, game.state))
    else if (game.waitingFor) parts.push('The person is deciding now. Stop here; you will get a message when the duel comes back to a player you hold.')
    return parts.join('\n\n') || 'Done.'
  }

  // Claude left a question open too long: take the first legal pick.
  private async defaultAnswer(id: string, seat: Seat, prompt: GamePrompt) {
    const choices = Array.from({ length: Math.max(1, prompt.min) }, (_, i) => i)
    seat.chat.push({ from: 'note', text: `Claude didn't answer question ${prompt.id}, so the first option was taken.` })
    await this.games.answer(id, seat.player, { id: prompt.id, choices })
  }

  // A function, so TypeScript doesn't narrow status across awaits.
  private stopped(seat: Seat) {
    return seat.status === 'stopped'
  }

  private changed(id: string, seat: Seat) {
    this.save(id, seat)
    this.sessions.touch(id)
  }

  private save(id: string, seat: Seat) {
    if (this.seats.get(id) !== seat) return // deleted while a run was finishing
    const { player, model, coach, share, sessionId, chat, costUsd, seen, texts, character, lesson } = seat
    this.store.save(id, {
      player,
      model,
      coach,
      share,
      ...(sessionId && { sessionId }),
      chat,
      costUsd,
      seen,
      ...(texts && { texts }),
      ...(character && { character }),
      ...(lesson && { lesson }),
    })
  }
}
