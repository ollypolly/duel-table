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
import { mkdirSync, readdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stamp, type ChatEntry, type ClaudeSettings, type ClaudeView, type GamePrompt, type ModelChoice } from '../../src/api/game'
import type { CardData, CardDb } from '../../src/data/cardDb'
import type { Character } from '../../src/scenarios/schema'
import { PLAYERS, type BoardState, type Player } from '../../src/engine'
import type { GameService, Trial } from '../games'
import { SessionError, type SessionService } from '../sessions'
import type { Agent, AgentRun, DuelTools } from './agent'
import type { Moment } from '../../src/api/review'
import { cardFace } from '../../src/view/boardView'
import { isTurnStart, played, playedBy } from '../../src/view/plays'
import { cardText, describeDeck, describeLethal, describeQuestion, describeTable, drawOdds, knownCards, optionLabel, publicLabel, rulesTopic, searchCards, seenBy } from './view'

// watch: Claude isn't playing. It sits on player's side of a game against a
// bot as their coach: it sees what they see and answers nothing.
// knowsDeck: that coach has been given the bot's decklist.
export type ClaudeRecord = {
  player: Player
  watch?: boolean
  knowsDeck?: boolean
  point?: string[] // cards the coach is pointing at on the person's screen
  flags?: Moment[] // moments the coach flagged for the review
  model: ModelChoice
  coach: boolean
  share: boolean // the person shows Claude their side
  sessionId?: string
  chat: ChatEntry[]
  costUsd: number
  seen: number // steps Claude has been told about
  logged?: number // steps written to the chat as a log, when Claude coaches
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
// plan: what the lesson covers, and the point it's on.
export type LessonSeats = { holds: Player[]; handed: Handover[]; waitingOn?: number; asking?: { id: string; question?: string }; plan?: { points: string[]; now: number } }

const HANDOVER_NOTE: Record<Handover['until'], string> = {
  answer: 'for one question',
  turn: 'until the end of this turn',
  takeBack: 'until Claude takes over again',
}

// Where a chat's record is kept between restarts: a game's, or a lesson's.
export type RecordStore<R> = { load(id: string): R | undefined; save(id: string, r: R): void; remove(id: string): void; ids(): string[] }
export type ClaudeStore = RecordStore<ClaudeRecord>

export const memoryClaudeStore = <R = ClaudeRecord>(): RecordStore<R> => {
  const m = new Map<string, R>()
  return { load: (id) => m.get(id), save: (id, r) => void m.set(id, r), remove: (id) => void m.delete(id), ids: () => [...m.keys()] }
}

export const diskClaudeStore = <R = ClaudeRecord>(dir: string): RecordStore<R> => ({
  load: (id) => (existsSync(join(dir, `${id}.json`)) ? (JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as R) : undefined),
  save: (id, r) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(r, null, 2)}\n`)
  },
  remove: (id) => rmSync(join(dir, `${id}.json`), { force: true }),
  ids: () => (existsSync(dir) ? readdirSync(dir).flatMap((f) => (f.endsWith('.json') ? [f.slice(0, -5)] : [])) : []),
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
  system: (seat: Pick<ClaudeRecord, 'coach' | 'character' | 'lesson' | 'watch'>) => string // the system prompt
  store?: ClaudeStore
  // For the coach: the person's notes on a deck, the rules reference, saving
  // a deck it suggests (returns its id), and misplays past reviews marked.
  notes?: { read(deck: string): string; add(deck: string, text: string): void }
  rules?: () => string
  saveDeck?: (name: string, main: Entry[], extra: Entry[], from: string) => Promise<string>
  misplays?: (deck: string) => string[]
  findCards?: (query: string) => Promise<CardData[]> // by name, among every card printed
}
type Entry = { name: string; count: number }

export class ClaudeService {
  private seats = new Map<string, Seat>()
  private games: GameService
  private sessions: SessionService
  private db: () => CardDb
  private agent: Agent
  private system: ClaudeDeps['system']
  private store: ClaudeStore
  private extras: Pick<ClaudeDeps, 'notes' | 'rules' | 'saveDeck' | 'misplays' | 'findCards'>

  constructor({ games, sessions, db, agent, system, store = memoryClaudeStore(), ...extras }: ClaudeDeps) {
    this.extras = extras
    this.games = games
    this.sessions = sessions
    this.db = db
    this.agent = agent
    this.system = system
    this.store = store
    games.onCreate = (id, opts) => {
      if (opts.lesson) this.join(id, 'p1', opts)
      else if (opts.claude) this.join(id, opts.claude, opts)
      else if (opts.watch) {
        // Beside the one person in a game against a bot.
        const people = PLAYERS.filter((p) => !(opts.bots ?? ['p2']).includes(p))
        if (people.length === 1) this.join(id, people[0], opts)
      }
    }
    games.onChange = (id) => {
      this.log(id)
      void this.poke(id)
    }
    games.onPersonAnswer = (id, player) => {
      const seat = this.seat(id)
      if (!seat?.lesson) return
      if (seat.lesson.handed.some((h) => h.player === player && h.until === 'answer')) this.takeBack(id, seat, player)
    }
    games.onUndo = (id) => {
      const seat = this.seat(id)
      if (!seat) return
      seat.seen = Math.min(seat.seen, this.sessions.export(id).steps.length)
      if (seat.logged !== undefined) seat.logged = Math.min(seat.logged, seat.seen)
      if (seat.lesson) {
        this.withdraw(id, seat)
        seat.notes = [...(seat.notes ?? []), 'The person took back their last move, which a lesson always allows. The table below is the game now: that move and what followed never happened, and they are back at the decision before it. If they were misled or missed something, put it right in a line, then stop and let them choose again.']
        seat.chat.push({ from: 'note', text: 'You took back your last move.' })
        this.changed(id, seat)
        return
      }
      const who = seat.watch ? 'The person' : 'Your opponent'
      seat.notes = [...(seat.notes ?? []), `${who} took back their last move, which the app allows a few times a game. The table below is the game now: what came after that move, ${seat.watch ? "the bot's replies" : 'your answers'} included, never happened.`]
      seat.chat.push({ from: 'note', text: 'You took back your last move.' })
      this.changed(id, seat)
    }
    sessions.lessonPlan = (id) => {
      const plan = this.seat(id)?.lesson?.plan
      return plan && { now: plan.now, of: plan.points.length }
    }
    games.onForfeit = (id) => {
      const seat = this.seat(id)
      if (!seat) return
      seat.notes = [...(seat.notes ?? []), seat.watch ? 'The person forfeited the game. Nothing more can be played.' : 'Your opponent forfeited the game, so you won. Nothing more can be played.']
      seat.chat.push({ from: 'note', text: 'You forfeited.' })
      this.changed(id, seat)
    }
    games.claudeHolds = (id) => {
      const s = this.seat(id)
      return s && this.holds(s)
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
      // The lines Claude showed on a board in this game's chat go with it.
      for (const e of (this.seats.get(id) ?? this.store.load(id))?.chat ?? []) if (e.demo && sessions.has(e.demo.session)) sessions.remove(e.demo.session)
      void this.seats.get(id)?.run?.interrupt()
      this.seats.delete(id)
      this.store.remove(id)
    })
    games.claudeView = (id) => {
      const s = this.seat(id)
      return (
        s && {
          player: s.player,
          ...(s.watch && { watch: true, knowsDeck: s.knowsDeck ?? true, ...(s.point?.length && { point: s.point }) }),
          model: s.model,
          coach: s.coach,
          share: s.share,
          status: s.status,
          chat: stamp(s.chat),
          costUsd: s.costUsd,
          ...(s.lesson && { holds: s.lesson.holds }),
          ...(s.lesson?.plan && { plan: s.lesson.plan }),
        }
      )
    }
  }

  // Seat Claude in a new game (before its first move). A lesson starts with
  // what you asked to learn.
  join(id: string, player: Player, opts: { model?: ModelChoice; coach?: boolean; lesson?: boolean; topic?: string; brief?: string; watch?: boolean; knowsDeck?: boolean } = {}) {
    const watch = !!opts.watch && !opts.lesson
    const character = watch ? undefined : this.sessions.export(id).players?.[player].list?.character
    const seat: Seat = {
      player,
      ...(watch && { watch, knowsDeck: opts.knowsDeck ?? true }),
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
    // Set up from a chat on the home page: what was said there carries over.
    const brief = opts.brief?.trim()
    if (brief) {
      seat.chat.push({ from: 'note', text: `Carried over from your chat with Claude: ${brief}` })
      seat.notes = [`The person set this ${opts.lesson ? 'lesson' : 'game'} up from a chat with Claude on the app's home page. What that chat passed on to you: ${brief}\nPick up from there: they shouldn't have to explain it again.`]
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
    if (s.knowsDeck !== undefined)
      seat.chat.push({ from: 'note', text: s.knowsDeck ? "Claude can now look at the bot's decklist." : "Claude can't look at the bot's decklist any more." })
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
  played(id: string): Pick<ClaudeRecord, 'player' | 'chat' | 'watch' | 'flags'> | undefined {
    const s = this.seat(id)
    return s && { player: s.player, chat: stamp(s.chat), ...(s.watch && { watch: true }), ...(s.flags && { flags: s.flags }) }
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
    // A coach beside the person isn't in the game's file, only in the store.
    const stored = duel && this.store.load(id)
    const player = stored?.player ?? duel?.claude ?? (duel?.lesson ? 'p1' : undefined)
    if (!player) return undefined
    const rec: ClaudeRecord = stored ?? {
      player,
      model: 'opus',
      coach: true,
      share: false,
      chat: [],
      costUsd: 0,
      seen: 0,
      ...(duel?.lesson && { lesson: { holds: ['p1', 'p2'], handed: [] } }),
    }
    // Claude only answers for a player the game's file gives it: otherwise it is beside them.
    const watch = !duel?.claude && !duel?.lesson
    const seat: Seat = { ...rec, ...(watch && { watch, knowsDeck: rec.knowsDeck ?? true }), share: rec.share ?? false, status: 'idle', queue: [], busy: false }
    // A game from before the log starts it from here, not with its whole history at once.
    if (stored && watch) seat.logged ??= this.sessions.export(id).steps.length
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
          if (await this.send(id, seat, () => this.lessonMessage(id, seat, prompt))) break
          seat.lesson.waitingOn = (await this.question(id, seat))?.id
          const waiting = await this.question(id, seat)
          if (waiting && !seat.lesson.asking && !seat.queue.length && !this.stopped(seat)) this.askNext(id, seat)
          continue
        }
        const prompt = seat.watch ? undefined : await this.games.asking(id, seat.player)
        if (!prompt && !seat.queue.length) break
        nudges = prompt && prompt.id === lastAsked ? nudges + 1 : 0
        if (prompt && nudges > NUDGES) {
          await this.defaultAnswer(id, seat, prompt)
          continue
        }
        lastAsked = prompt?.id
        if (await this.send(id, seat, () => (seat.watch ? this.coachMessage(id, seat) : this.message(id, seat, prompt, nudges > 0)))) break
      }
    } finally {
      seat.busy = false
      this.changed(id, seat)
    }
  }

  // Run Claude on a message. If the run fails, what the message took (your
  // chat, notes) goes back to be sent again on a retry. True if it failed.
  private async send(id: string, seat: Seat, build: () => Promise<string>): Promise<boolean> {
    const queue = [...seat.queue]
    const notes = [...(seat.notes ?? [])]
    const failed = await this.run(id, seat, await build())
    if (failed) {
      seat.queue.unshift(...queue)
      seat.notes = [...notes, ...(seat.notes ?? [])]
    }
    return failed
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
      if (theirs) parts.push(describeQuestion(theirs, state, other(seat.player), this.db(), 'Your opponent is being asked (theirs to answer, not yours)'))
    }
    if (prompt) {
      if (nudge) parts.push(`You haven't answered question ${prompt.id} yet. Answer it with the answer tool.`)
      parts.push(describeQuestion(prompt, state, seat.player, this.db()))
    } else parts.push("There's no question for you right now; just reply.")
    return parts.filter(Boolean).join('\n\n')
  }

  // To the coach beside the person: what they said, and the game as they see it.
  private async coachMessage(id: string, seat: Seat): Promise<string> {
    const game = await this.games.get(id)
    const { state } = game
    const parts: string[] = seat.notes?.splice(0) ?? []
    seat.point = undefined
    const deck = this.sessions.export(id).players?.[seat.player].deck
    if (!seat.sessionId && deck) {
      const notes = this.extras.notes?.read(deck).trim()
      if (notes) parts.push(`The person's notes on this deck, from earlier games:\n${notes}`)
      const past = this.extras.misplays?.(deck) ?? []
      if (past.length) parts.push(`Misplays reviews of their earlier games with this deck marked (watch for the same again):\n${past.map((m) => `- ${m}`).join('\n')}`)
    }
    for (const text of seat.queue.splice(0)) parts.push(`The person says: ${text}`)
    const events = this.catchUp(id, seat)
    if (events.length) parts.push(`Since you last looked:\n${events.map((e) => `- ${e}`).join('\n')}`)
    parts.push(this.texts(state, seat, false), describeTable(state, seat.player, this.db()))
    // What has gone this turn already: summons made, effects used, attacks declared.
    const labels = this.sessions.export(id).steps.flatMap((s) => (s.label ? [s.label] : []))
    const turn = labels.slice(labels.findLastIndex((l) => /^Turn \d+$/.test(l)) + 1).filter((l) => !/ Phase( \d)?$/.test(l))
    if (turn.length) parts.push(`This turn so far:\n${turn.map((l) => `- ${publicLabel(l, state, seat.player, this.db())}`).join('\n')}`)
    const theirs = await this.games.asking(id, seat.player)
    const winner = game.duel.result?.player
    if (winner) parts.push(`The duel is over: ${winner === seat.player ? 'the person won' : 'the bot won'}.`)
    else if (theirs) parts.push(describeQuestion(theirs, state, seat.player, this.db(), 'The person is being asked (theirs to answer; the numbers are what tryLine takes)'))
    else parts.push('The bot is deciding: nothing is being asked of the person right now.')
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

  // An error stops Claude as Stop does, so the game waits for you to resume
  // rather than nudging it or moving for it. True if it failed.
  private async run(id: string, seat: Seat, message: string): Promise<boolean> {
    let failed = false
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
          if (e.error && !this.stopped(seat)) {
            seat.chat.push({ from: 'note', text: `Claude stopped with an error: ${e.error}` })
            seat.status = 'stopped'
            failed = true
          }
        }
        this.changed(id, seat)
      }
    } finally {
      seat.run = undefined
      if (seat.status === 'thinking') seat.status = 'idle'
    }
    return failed
  }

  private tools(id: string, seat: Seat): DuelTools {
    const state = () => this.sessions.get(id).state
    const looking = {
      table: () => describeTable(state(), seat.player, this.db(), seat.share),
      card: (name: string) => cardText(this.db(), name),
      // The other side's list only if Claude has been given it: the bot's for
      // a coach who knows it, the person's while they show their cards.
      deck: (side: 'yours' | 'opponent') => {
        const p = side === 'yours' ? seat.player : other(seat.player)
        const given = side === 'yours' || (seat.watch ? (seat.knowsDeck ?? true) : seat.share)
        return describeDeck(state(), p, seat.player, this.db(), this.sessions.export(id).players?.[p].list, given)
      },
      history: (last = 40) => {
        const labels = this.sessions.export(id).steps.flatMap((s) => (s.label ? [publicLabel(s.label, state(), seat.player, this.db())] : []))
        const from = Math.max(0, labels.length - last)
        return labels.slice(from).map((l, i) => `${from + i + 1}. ${l}`).join('\n') || 'Nothing has happened yet.'
      },
    }
    if (seat.watch)
      return {
        ...looking,
        options: async () => {
          const q = await this.games.asking(id, seat.player)
          return q ? describeQuestion(q, state(), seat.player, this.db(), 'The person is being asked') : 'Nothing is being asked of the person right now.'
        },
        tryLine: (picks, show) => this.tryLine(id, seat, picks, show),
        ...this.coachTools(id, seat),
      }
    return {
      ...looking,
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

  // What else the coach can look up or do.
  private coachTools(id: string, seat: Seat): Partial<DuelTools> {
    const state = () => this.sessions.get(id).state
    const file = () => this.sessions.export(id)
    const deckId = () => file().players?.[seat.player].deck
    const { notes, rules, saveDeck, findCards } = this.extras
    return {
      lethal: () => describeLethal(state(), seat.player, this.db()),
      odds: (cards, draws, from = 'deck') => {
        const want = new Set(cards.map((c) => this.db().byName(c)?.name ?? c))
        const list = file().players?.[seat.player].list
        const opening = from === 'opening' && list
        const pool = opening ? list.main.flatMap((e) => Array<string>(e.count).fill(e.name)) : state().players[seat.player].zones.deck.map((iid) => cardFace(state(), iid, this.db()).name)
        const hits = pool.filter((n) => want.has(n)).length
        const n = draws ?? (opening ? 5 : 1)
        return `${hits} of the ${pool.length} cards ${opening ? 'in the Main Deck' : 'left in the Deck'} are ${[...want].join(' or ')}. At least one in ${n} draw${n === 1 ? '' : 's'}: ${(drawOdds(pool.length, hits, n) * 100).toFixed(1)}%.`
      },
      searchCards: (query) => searchCards(this.db(), query, findCards),
      ...(rules && { rules: (topic) => rulesTopic(rules(), topic) }),
      point: (cards) => {
        const want = new Set(cards.map((c) => this.db().byName(c)?.name ?? c))
        const s = state()
        seat.point = Object.keys(s.cards).filter((iid) => want.has(cardFace(s, iid, this.db()).name) && seenBy(s, iid, seat.player, this.db()) && !s.players.p1.zones.deck.includes(iid) && !s.players.p2.zones.deck.includes(iid))
        this.changed(id, seat)
        return seat.point.length ? `Highlighted ${seat.point.length} card(s) on their screen.` : cards.length ? 'None of those are on show to point at.' : 'Cleared.'
      },
      offerTakeBack: (why) => {
        const left = this.sessions.get(id).game?.undos
        if (!left) return "They can't take a move back right now (none of theirs to take back, or all take-backs used)."
        seat.chat.push({ from: 'note', text: `Claude suggests taking back your last move: ${why} (Take back is under the … menu; ${left} left.)` })
        this.changed(id, seat)
        return 'Suggested. It is theirs to decide; carry on as if they might not.'
      },
      flag: (kind, title) => {
        const step = file().steps.length
        seat.flags = [...(seat.flags ?? []).filter((m) => m.step !== step), { step, kind, player: seat.player, title }]
        this.changed(id, seat)
        return `Flagged step ${step} for the review.`
      },
      ...(notes && {
        note: (text) => {
          const deck = deckId()
          if (!deck) return 'This game has no deck to keep notes on.'
          notes.add(deck, text)
          seat.chat.push({ from: 'note', text: `Claude saved a note on this deck: ${text}` })
          this.changed(id, seat)
          return 'Saved.'
        },
      }),
      ...(saveDeck && {
        suggestDeck: async (name, main, extra, why) => {
          try {
            const saved = await saveDeck(name, main, extra, deckId() ?? 'deck')
            seat.chat.push({ from: 'note', text: `Claude saved a suggested deck, "${name}" (${saved}): ${why}` })
            this.changed(id, seat)
            return `Saved as ${saved}. It is in their deck list to try in a new game.`
          } catch (e) {
            return `Not saved: ${(e as Error).message}`
          }
        },
      }),
      botMove: () => {
        const last = this.games.botThinking(id)
        if (!last.length) return "Nothing to report: the opponent isn't the trained bot, or it hasn't decided anything yet. The simple bot picks at random."
        return last.map((l) => `Its last decision had ${l!.options} option(s); it picked one with probability ${(l!.confidence * 100).toFixed(0)}%.${l!.winRate === undefined ? '' : ` It puts its own chance of winning at ${(l!.winRate * 100).toFixed(0)}%.`}`).join('\n')
      },
      evaluate: async () => {
        const view = await this.games.evaluate(id, seat.player).catch(() => undefined)
        const prompt = this.sessions.get(id).game?.prompt
        if (!view || (view.winRate === undefined && view.pick === undefined)) return 'No view: it only looks at positions for decks made of cards it knows, when the person has a question open.'
        return [
          view.winRate !== undefined && `The trained bot puts the person's chance of winning from here at ${(view.winRate * 100).toFixed(0)}%.`,
          view.pick !== undefined && prompt && `In their place it would pick "${optionLabel(prompt, view.pick, state(), seat.player, this.db())}" (${((view.confidence ?? 0) * 100).toFixed(0)}% sure).`,
          "It knows nothing of cards outside its training and doesn't explain itself, so weigh it against your own reading; don't quote it as fact.",
        ]
          .filter(Boolean)
          .join(' ')
      },
    }
  }

  // A line of the person's played on a copy of the game, for the coach.
  private async tryLine(id: string, seat: Seat, picks: number[][], show?: string): Promise<string> {
    const before = this.sessions.get(id).state
    const t = await this.games.trial(id, seat.player, picks)
    // Cards the trial drew are the real next cards: kept back, unless the line
    // itself named them (a search).
    const said = t.steps.map((s) => s.label ?? '').join('\n')
    const drawn = new Set(t.state.players[seat.player].zones.hand.filter((iid) => before.players[seat.player].zones.deck.includes(iid) && !said.includes(cardFace(t.state, iid, this.db()).name)))
    const events = t.steps.flatMap((s) => (s.label ? [publicLabel(s.label, t.state, seat.player, this.db())] : []))
    const parts = [
      t.refused ? `Pick ${t.played + 1} wasn't accepted (a wrong number of options, an option that isn't there, or the engine turned it down). Up to there:` : '',
      events.length ? `What would happen:\n${events.map((e) => `- ${e}`).join('\n')}` : 'Nothing would happen yet.',
      `The table after it:\n${describeTable(t.state, seat.player, this.db(), false, drawn)}`,
      t.winner ? `The duel would be over: ${t.winner === seat.player ? 'the person wins' : 'the bot wins'}.` : '',
      t.next ? describeQuestion(t.next, t.state, seat.player, this.db(), `Then the person would be asked (add a pick for it to go on)`) : '',
      t.theirs ? "It stops here: the next decision is the bot's." : '',
      `Nothing was played in the real game. This assumes the bot passes wherever it could respond.${drawn.size ? ' Cards drawn in this line are shown as hidden: nobody knows them yet.' : ''}`,
      show ? (drawn.size ? "Not put on a board: the line draws cards nobody knows yet, and a board would show them." : this.showLine(id, seat, t, show)) : '',
    ]
    return parts.filter(Boolean).join('\n\n')
  }

  // A tried line on a board in the chat: a hidden copy of the game with the
  // line's steps after its own, shown from where the line starts.
  private showLine(id: string, seat: Seat, t: Trial, title: string): string {
    if (!t.steps.length) return ''
    const file = this.sessions.export(id)
    delete file.duel
    const made = this.sessions.createFrom({ ...file, title, demo: true, steps: [...file.steps, ...t.steps] })
    seat.chat.push({ from: 'note', text: `Claude's line: ${title}`, demo: { session: made.id, title, from: file.steps.length, closed: true } })
    this.changed(id, seat)
    return 'The person has this line on a board in the chat, to step through.'
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
    return seat.lesson ? seat.lesson.holds : seat.watch ? [] : [seat.player]
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

  // The person's Next, for when they've taken in Claude's last move.
  private askNext(id: string, seat: Seat) {
    const prompt = { type: 'ack' as const, message: 'Take your time. Ready for the next move?', button: 'Next' }
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
      // p1's open question played on a copy, so Claude can check what a move
      // costs or leads to before it says so.
      options: async () => {
        const q = await this.games.asking(id, 'p1')
        return q ? describeQuestion(q, (await this.games.get(id)).state, 'p1', this.db(), 'p1 is being asked') : 'Nothing is being asked of p1 right now.'
      },
      tryLine: async (picks, show) => {
        if (!(await this.games.asking(id, 'p1'))) return 'Nothing is being asked of p1 right now, so there is no line to try.'
        const t = await this.games.trial(id, 'p1', picks)
        const events = t.steps.flatMap((s) => (s.label ? [s.label] : []))
        return [
          t.refused ? `Pick ${t.played + 1} wasn't accepted (a wrong number of options, an option that isn't there, or the engine turned it down). Up to there:` : '',
          events.length ? `What would happen:\n${events.map((e) => `- ${e}`).join('\n')}` : 'Nothing would happen yet.',
          t.winner ? `The duel would be over: ${t.winner} wins.` : '',
          t.next ? describeQuestion(t.next, t.state, 'p1', this.db(), 'Then p1 would be asked (add a pick for it to go on)') : '',
          t.theirs ? "It stops here: the next decision is p2's." : '',
          'Nothing was played in the real game. This assumes p2 passes wherever it could respond.',
          show ? this.showLine(id, seat, t, show) : '',
        ]
          .filter(Boolean)
          .join('\n\n')
      },
      plan: (points, now) => {
        const plan = points?.length ? { points, now: now ?? 0 } : lesson.plan && { ...lesson.plan, now: now ?? lesson.plan.now + 1 }
        if (!plan) return 'There is no plan yet: give its points first.'
        lesson.plan = { ...plan, now: Math.max(0, Math.min(plan.now, plan.points.length)) }
        this.changed(id, seat)
        const { now: at, points: all } = lesson.plan
        return at >= all.length ? 'The plan is done: wrap up with two or three takeaways.' : `The person sees: ${at + 1} of ${all.length}, ${all[at]}.`
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

  // A coached game's chat keeps a log of what's played, since Claude, who
  // isn't playing, leaves no lines of its own: each turn, and each summon,
  // activation, attack and Set, by whose card it is.
  private log(id: string) {
    const seat = this.seat(id)
    if (!seat?.watch) return
    const { steps } = this.sessions.export(id)
    const { state } = this.sessions.get(id)
    const other = seat.player === 'p1' ? 'p2' : 'p1'
    const lines = steps.slice(seat.logged ?? 0).flatMap((s) => {
      if (isTurnStart(s)) return [s.label!]
      if (!played(s)) return []
      const theirs = playedBy(s, other)
      return [`${theirs ? state.players[other].name : 'You'}: ${s.label ?? 'A move'}`] // labels never name a hidden card
    })
    seat.logged = steps.length
    if (!lines.length) return
    seat.chat.push(...lines.map((text) => ({ from: 'log' as const, text })))
    this.changed(id, seat)
  }

  private changed(id: string, seat: Seat) {
    this.save(id, seat)
    this.sessions.touch(id)
  }

  private save(id: string, seat: Seat) {
    if (this.seats.get(id) !== seat) return // deleted while a run was finishing
    const { player, watch, knowsDeck, flags, model, coach, share, sessionId, chat, costUsd, seen, logged, texts, character, lesson } = seat
    this.store.save(id, {
      player,
      ...(watch && { watch, knowsDeck: knowsDeck ?? true }),
      ...(flags && { flags }),
      model,
      coach,
      share,
      ...(sessionId && { sessionId }),
      chat: stamp(chat),
      costUsd,
      seen,
      ...(logged !== undefined && { logged }),
      ...(texts && { texts }),
      ...(character && { character }),
      ...(lesson && { lesson }),
    })
  }
}
