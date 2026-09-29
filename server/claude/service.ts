// Claude playing one side of a game. When the rules engine asks Claude's
// player something, or you send a chat message, Claude gets a message with
// what happened since it last looked, the table as it sees it, and the open
// question; it answers with its tools. One run at a time per game: chat sent
// meanwhile waits for the next run.
//
// Each game's record (settings, chat, cost, the SDK session to resume) is
// saved by a ClaudeStore, so a game carries on after a restart.
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatEntry, ClaudeSettings, ClaudeView, GamePrompt, ModelChoice } from '../../src/api/game'
import type { CardDb } from '../../src/data/cardDb'
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
}

export type ClaudeStore = { load(id: string): ClaudeRecord | undefined; save(id: string, r: ClaudeRecord): void }

export const memoryClaudeStore = (): ClaudeStore => {
  const m = new Map<string, ClaudeRecord>()
  return { load: (id) => m.get(id), save: (id, r) => void m.set(id, r) }
}

export const diskClaudeStore = (dir: string): ClaudeStore => ({
  load: (id) => (existsSync(join(dir, `${id}.json`)) ? (JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as ClaudeRecord) : undefined),
  save: (id, r) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(r, null, 2)}\n`)
  },
})

const other = (p: Player): Player => (p === 'p1' ? 'p2' : 'p1')

type Seat = ClaudeRecord & { status: ClaudeView['status']; queue: string[]; run?: AgentRun; busy: boolean }

// Times Claude is reminded of a question it left open before a default pick.
const NUDGES = 2

export type ClaudeDeps = {
  games: GameService
  sessions: SessionService
  db: () => CardDb
  agent: Agent
  system: (coach: boolean) => string // the system prompt
  store?: ClaudeStore
}

export class ClaudeService {
  private seats = new Map<string, Seat>()
  private games: GameService
  private sessions: SessionService
  private db: () => CardDb
  private agent: Agent
  private system: (coach: boolean) => string
  private store: ClaudeStore

  constructor({ games, sessions, db, agent, system, store = memoryClaudeStore() }: ClaudeDeps) {
    this.games = games
    this.sessions = sessions
    this.db = db
    this.agent = agent
    this.system = system
    this.store = store
    games.onCreate = (id, opts) => opts.claude && this.join(id, opts.claude, opts)
    games.onChange = (id) => void this.poke(id)
    games.claudeView = (id) => {
      const s = this.seat(id)
      return s && { player: s.player, model: s.model, coach: s.coach, share: s.share, status: s.status, chat: s.chat, costUsd: s.costUsd }
    }
  }

  // Seat Claude in a new game (before its first move).
  join(id: string, player: Player, opts: { model?: ModelChoice; coach?: boolean } = {}) {
    const seat: Seat = {
      player,
      model: opts.model ?? 'opus',
      coach: opts.coach ?? true,
      share: false,
      chat: [],
      costUsd: 0,
      seen: 0,
      status: 'idle',
      queue: [],
      busy: false,
    }
    this.seats.set(id, seat)
    this.save(id, seat)
  }

  chat(id: string, text: string) {
    const seat = this.need(id)
    seat.chat.push({ from: 'you', text })
    seat.queue.push(text)
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

  private seat(id: string): Seat | undefined {
    const found = this.seats.get(id)
    if (found) return found
    let player: Player | undefined
    try {
      player = this.sessions.export(id).duel?.claude
    } catch {
      return undefined
    }
    if (!player) return undefined
    const rec = this.store.load(id) ?? { player, model: 'opus', coach: true, share: false, chat: [], costUsd: 0, seen: 0 }
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
    for (const text of seat.queue.splice(0)) parts.push(`Your opponent says: ${text}`)
    const events = this.catchUp(id, seat)
    if (events.length) parts.push(`Since you last looked:\n${events.map((e) => `- ${e}`).join('\n')}`)
    parts.push(this.texts(state, seat), describeTable(state, seat.player, this.db(), seat.share))
    if (seat.share) {
      parts.push('Your opponent is showing you their hidden cards (named above) so you can advise them: when they ask, explain the best play for them and why.')
      const theirs = await this.games.asking(id, other(seat.player))
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
  private texts(state: BoardState, seat: Seat): string {
    const given = new Set(seat.texts)
    const fresh = knownCards(state, seat.player, this.db(), seat.share).filter((n) => !given.has(n))
    if (!fresh.length) return ''
    seat.texts = [...given, ...fresh]
    return `Card texts (new to you):\n${fresh.map((n) => cardText(this.db(), n)).join('\n\n')}`
  }

  // Labels of the steps since Claude last looked, as its player sees them.
  private catchUp(id: string, seat: Seat): string[] {
    const { steps } = this.sessions.export(id)
    const state = this.sessions.get(id).state
    const fresh = steps.slice(seat.seen).flatMap((s) => (s.label ? [publicLabel(s.label, state, seat.player, this.db())] : []))
    seat.seen = steps.length
    return fresh
  }

  private async run(id: string, seat: Seat, message: string) {
    seat.status = 'thinking'
    this.changed(id, seat)
    const run = this.agent({ message, system: this.system(seat.coach), model: seat.model, sessionId: seat.sessionId, tools: this.tools(id, seat) })
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
    const parts = [events.length ? `Done. Then:\n${events.map((e) => `- ${e}`).join('\n')}` : 'Done.', this.texts(game.state, seat)].filter(Boolean)
    const winner = game.duel.result
    const next = await this.games.asking(id, seat.player)
    if (winner) parts.push(`The duel is over: ${winner.player === seat.player ? 'you won' : 'your opponent won'}.`)
    else if (next) parts.push(describeQuestion(next, game.state, seat.player, this.db()))
    else parts.push('Your opponent is deciding now. Stop here; you will get a message when you are asked something.')
    return parts.join('\n\n')
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
    const { player, model, coach, share, sessionId, chat, costUsd, seen, texts } = seat
    this.store.save(id, { player, model, coach, share, ...(sessionId && { sessionId }), chat, costUsd, seen, ...(texts && { texts }) })
  }
}
