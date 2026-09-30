// Claude reviewing a game with you once it's over: a game against Claude or
// the bot, or a lesson Claude ran. It's its own conversation, apart from the
// game's chat. The first message gives Claude the whole game: who played,
// how it ended, every step, and the game's chat. After that, each message
// brings it up to date with anything new, says which step you're looking
// at, and shows the table there. The game's over, so both sides are open.
// One review per session, kept by a RecordStore so it carries on after a
// restart.
import type { ChatEntry, ModelChoice } from '../../src/api/game'
import { reviewable, type ReviewView } from '../../src/api/review'
import type { CardDb } from '../../src/data/cardDb'
import type { BoardState } from '../../src/engine'
import { SessionError, type SessionService } from '../sessions'
import type { Agent, AgentRun } from './agent'
import { memoryClaudeStore, type ClaudeRecord, type RecordStore } from './service'
import { cardText, describeTable, knownCards } from './view'

export type ReviewRecord = {
  open: boolean // shown in place of the game's chat
  model: ModelChoice
  sessionId?: string
  chat: ChatEntry[]
  costUsd: number
  read: number // steps Claude has been told about
  heard: number // entries of the game's chat Claude has been given
  texts?: string[] // cards whose text Claude has been given
}

// interrupted: stopped by you, so the run ending early isn't an error.
type Review = ReviewRecord & {
  status: ReviewView['status']
  queue: { text: string; position: number }[]
  position: number
  run?: AgentRun
  busy: boolean
  interrupted?: boolean
}

export type ReviewDeps = {
  sessions: SessionService
  db: () => CardDb
  agent: Agent
  system: () => string
  // The side Claude played and the game's chat, when Claude played or ran a lesson.
  played?: (id: string) => Pick<ClaudeRecord, 'player' | 'chat'> | undefined
  store?: RecordStore<ReviewRecord>
}

const fresh = (model: ModelChoice = 'opus'): ReviewRecord => ({ open: true, model, chat: [], costUsd: 0, read: 0, heard: 0 })

const SPEAKER: Record<ChatEntry['from'], string> = { you: 'The person', claude: 'Claude', move: 'Claude played', note: 'The app' }

export class ReviewService {
  // null: looked for and there isn't one, so a session's updates don't hit the store.
  private reviews = new Map<string, Review | null>()
  private sessions: SessionService
  private db: () => CardDb
  private agent: Agent
  private system: () => string
  private played: NonNullable<ReviewDeps['played']>
  private store: RecordStore<ReviewRecord>

  constructor({ sessions, db, agent, system, played = () => undefined, store = memoryClaudeStore<ReviewRecord>() }: ReviewDeps) {
    this.sessions = sessions
    this.played = played
    this.db = db
    this.agent = agent
    this.system = system
    this.store = store
    sessions.reviewView = (id) => {
      const r = this.find(id)
      return r?.open ? this.view(r) : undefined
    }
    sessions.onRemove.push((id) => {
      const r = this.reviews.get(id)
      void r?.run?.interrupt()
      this.reviews.delete(id)
      this.store.remove(id)
    })
  }

  // Open the review (a new one, or the one you had), in place of the game's chat.
  start(id: string): ReviewView {
    const summary = this.sessions.get(id)
    if (!reviewable(summary)) throw new SessionError(409, `session ${id} can't be reviewed until the game is over`)
    const r = this.find(id) ?? this.load(id, fresh())
    r.open = true
    this.changed(id, r)
    return this.view(r)
  }

  // Back to the game's chat. The review is kept for next time.
  close(id: string): ReviewView {
    const r = this.need(id)
    r.open = false
    this.changed(id, r)
    return this.view(r)
  }

  // Sent while Claude is answering, it waits for that answer to finish.
  chat(id: string, text: string, position: number): ReviewView {
    const r = this.need(id)
    r.chat.push({ from: 'you', text })
    r.queue.push({ text, position })
    this.changed(id, r)
    void this.pump(id, r)
    return this.view(r)
  }

  async stop(id: string): Promise<ReviewView> {
    const r = this.need(id)
    r.queue = []
    r.interrupted = true
    await r.run?.interrupt()
    return this.view(r)
  }

  settings(id: string, s: { model?: ModelChoice }): ReviewView {
    const r = this.need(id)
    if (s.model) r.model = s.model
    this.changed(id, r)
    return this.view(r)
  }

  // Forget the conversation and start again.
  async clear(id: string): Promise<ReviewView> {
    const r = this.need(id)
    r.queue = []
    r.interrupted = true
    await r.run?.interrupt()
    Object.assign(r, fresh(r.model), { sessionId: undefined, texts: undefined })
    this.changed(id, r)
    return this.view(r)
  }

  // Wait for Claude to settle (tests).
  async idle(id: string) {
    while (this.find(id)?.busy) await new Promise((res) => setTimeout(res, 5))
  }

  private view({ model, status, chat, costUsd }: Review): ReviewView {
    return { model, status, chat, costUsd }
  }

  private find(id: string): Review | undefined {
    const known = this.reviews.get(id)
    if (known !== undefined) return known ?? undefined
    const rec = this.store.load(id)
    if (!rec) return void this.reviews.set(id, null)
    return this.load(id, rec)
  }

  private load(id: string, rec: ReviewRecord): Review {
    const r: Review = { ...rec, status: 'idle', queue: [], position: 0, busy: false }
    this.reviews.set(id, r)
    return r
  }

  private need(id: string): Review {
    const r = this.find(id)
    if (!r) throw new SessionError(409, `there's no review of session ${id}; start one first`)
    return r
  }

  private async pump(id: string, r: Review) {
    if (r.busy) return
    r.busy = true
    try {
      while (r.queue.length) {
        const asked = r.queue.splice(0)
        r.position = asked.at(-1)!.position
        await this.run(
          id,
          r,
          this.message(
            id,
            r,
            asked.map((a) => a.text),
          ),
        )
      }
    } finally {
      r.busy = false
      this.changed(id, r)
    }
  }

  private message(id: string, r: Review, questions: string[]): string {
    const view = this.sessions.get(id)
    const { steps } = view.file
    const { players } = view.state
    const parts: string[] = []
    if (!r.sessionId) parts.push(this.overview(id))
    // A lesson that carried on after the review started has more to tell.
    const chat = this.played(id)?.chat ?? []
    if (chat.length > r.heard) {
      parts.push(`${r.heard ? 'The game chat since' : 'The chat during the game'}:\n${chat.slice(r.heard).map((e) => `${SPEAKER[e.from]}: ${e.text}`).join('\n')}`)
      r.heard = chat.length
    }
    if (steps.length > r.read) {
      const lines = steps.slice(r.read).flatMap((s, i) => (s.label ? [`Step ${r.read + i + 1}: ${s.label}`] : []))
      parts.push(`${r.read ? 'Steps since' : 'The steps (position n is the table after step n)'}:\n${lines.join('\n')}`)
      r.read = steps.length
    }
    const position = Math.min(Math.max(0, r.position), steps.length)
    const where = position === 0 ? 'the start, before step 1' : `step ${position}: ${steps[position - 1].label ?? '(no label)'}`
    parts.push(`They're looking at ${where} (of ${steps.length} steps). p1 is ${players.p1.name}, p2 is ${players.p2.name}.`)
    const state = this.state(id, r)
    parts.push(this.texts(state, r), describeTable(state, 'p1', this.db(), true))
    parts.push(questions.map((q) => `They ask: ${q}`).join('\n'))
    return parts.filter(Boolean).join('\n\n')
  }

  // Who played whom, and how it went.
  private overview(id: string): string {
    const v = this.sessions.get(id)
    const seat = (p: 'p1' | 'p2') => `${v.players[p].name}${v.players[p].deckName ? ` (${v.players[p].deckName})` : ''}`
    const claude = this.played(id)
    const how = v.claudeLesson
      ? 'It was a lesson you ran for the person: you played both sides, and handed them p1 to try things.'
      : claude
        ? `You played ${claude.player} against the person.`
        : 'The person played p1 against a bot picking random legal moves.'
    const result = v.winner ? `${v.players[v.winner].name} (${v.winner}) won, on turn ${v.turn}.` : `It stopped on turn ${v.turn} without a winner.`
    return [`The game: ${v.title}. p1 is the person, ${seat('p1')}; p2 is ${seat('p2')}.`, how, result].join(' ')
  }

  private state(id: string, r: Review): BoardState {
    return this.sessions.stateAt(id, r.position)
  }

  // The text of each card on the table Claude hasn't been given yet.
  private texts(state: BoardState, r: Review): string {
    const given = new Set(r.texts)
    const fresh = knownCards(state, 'p1', this.db(), true).filter((n) => !given.has(n))
    if (!fresh.length) return ''
    r.texts = [...given, ...fresh]
    return `Card texts (new to you):\n${fresh.map((n) => cardText(this.db(), n)).join('\n\n')}`
  }

  private async run(id: string, r: Review, message: string) {
    r.status = 'thinking'
    this.changed(id, r)
    const run = this.agent({
      message,
      system: this.system(),
      model: r.model,
      sessionId: r.sessionId,
      tools: { table: () => describeTable(this.state(id, r), 'p1', this.db(), true), card: (name) => cardText(this.db(), name) },
    })
    r.run = run
    const chat = r.chat // a reply finishing after Start over stays out of the new chat
    try {
      for await (const e of run.events) {
        if (e.type === 'text') chat.push({ from: 'claude', text: e.text })
        if (e.type === 'done') {
          if (r.chat === chat) r.sessionId = e.sessionId ?? r.sessionId
          r.costUsd += e.costUsd
          if (e.error && !r.interrupted) chat.push({ from: 'note', text: `Claude stopped with an error: ${e.error}` })
        }
        this.changed(id, r)
      }
    } finally {
      r.run = undefined
      r.status = 'idle'
      r.interrupted = false
    }
  }

  private changed(id: string, r: Review) {
    if (this.reviews.get(id) !== r) return // deleted while a run was finishing
    const { open, model, sessionId, chat, costUsd, read, heard, texts } = r
    this.store.save(id, { open, model, ...(sessionId && { sessionId }), chat, costUsd, read, heard, ...(texts && { texts }) })
    this.sessions.touch(id)
  }
}
