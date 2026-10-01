// Claude reviewing a game with you once it's over: a game against Claude or
// the bot, or a lesson Claude ran. It's its own conversation, apart from the
// game's chat. The first message gives Claude the whole game: who played,
// how it ended, every step, and the game's chat. After that, each message
// brings it up to date with anything new, says which step you're looking
// at, and shows the table there. The game's over, so both sides are open.
// A new review starts with Claude looking through the game for its key
// moments, which you then step through with Claude leading each one.
// One review per session, kept by a RecordStore so it carries on after a
// restart.
import type { ChatEntry, ModelChoice } from '../../src/api/game'
import { reviewable, type Moment, type ReviewView } from '../../src/api/review'
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
  moments: Moment[]
  scanned: boolean // Claude finished its first look for key moments
}

// Something for Claude to answer: your questions, its first look through the
// game, or leading you through a moment it marked.
type Asked = { position: number } & ({ text: string } | { scan: true } | { lead: Moment })

// interrupted: stopped by you, so the run ending early isn't an error.
type Review = ReviewRecord & {
  status: ReviewView['status']
  queue: Asked[]
  position: number
  run?: AgentRun
  busy: boolean
  scanning?: boolean
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

const fresh = (model: ModelChoice = 'opus'): ReviewRecord => ({ open: true, model, chat: [], costUsd: 0, read: 0, heard: 0, moments: [], scanned: false })

// A chat from before entries carried their moment: Claude's replies after a
// moment's note, up to the next thing you or the app said, are about it.
function tagMoments(chat: ChatEntry[]): ChatEntry[] {
  let moment: number | undefined
  return chat.map((e) => {
    if (e.moment) return e
    if (e.from !== 'claude') moment = e.from === 'note' ? Number(/^Step (\d+), /.exec(e.text)?.[1]) || undefined : undefined
    return moment ? { ...e, moment } : e
  })
}

const KIND: Record<Moment['kind'], string> = { blunder: 'a blunder', mistake: 'a mistake', missed: 'a missed chance', good: 'a good play' }

const SCAN =
  "Before they ask anything, go through the whole game and find its key moments: the person's blunders, mistakes, missed chances and good plays, and the other side's mistakes they could have punished. Don't mark the other side's good plays, least of all your own: mark where the person could have played around it. Look at the table around a step with `tableAt` when the labels aren't enough. `mark` each one on the step of the move itself, checking the number against the list, most games have 3 to 8, then write two or three sentences on how the game was decided. Don't go through the moments here: they'll step through them with you."
const LEAD =
  "Take them through it. If the choice was theirs, ask what they'd do here before you say what you'd have done. If it was the other side's, say what happened and what the person could have done about it."

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
    this.scan(id, r)
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

  // Go to a moment Claude marked, and have it take you through it. You're
  // shown the table just before the move, where the choice was made.
  moment(id: string, step: number): ReviewView {
    const r = this.need(id)
    const m = r.moments.find((m) => m.step === step)
    if (!m) throw new SessionError(409, `Claude didn't mark step ${step}`)
    r.chat.push({ from: 'note', text: `Step ${m.step}, ${KIND[m.kind]}`, moment: m.step })
    r.queue.push({ lead: m, position: m.step - 1 })
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
    this.scan(id, r)
    return this.view(r)
  }

  // Wait for Claude to settle (tests).
  async idle(id: string) {
    while (this.find(id)?.busy) await new Promise((res) => setTimeout(res, 5))
  }

  private view({ model, status, chat, costUsd, moments, scanned }: Review): ReviewView {
    return { model, status, chat, costUsd, moments, scanned }
  }

  // Claude's first look, unless it's had one or is having it.
  private scan(id: string, r: Review) {
    if (r.scanned || r.scanning || r.queue.some((a) => 'scan' in a)) return
    r.queue.unshift({ scan: true, position: this.sessions.get(id).file.steps.length })
    void this.pump(id, r)
  }

  private find(id: string): Review | undefined {
    const known = this.reviews.get(id)
    if (known !== undefined) return known ?? undefined
    const rec = this.store.load(id)
    if (!rec) return void this.reviews.set(id, null)
    return this.load(id, rec)
  }

  private load(id: string, rec: ReviewRecord): Review {
    // A review from before moments has none.
    const r: Review = { ...rec, chat: tagMoments(rec.chat), moments: rec.moments ?? [], scanned: rec.scanned ?? false, status: 'idle', queue: [], position: 0, busy: false }
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
        // Questions go together; a first look or a moment goes on its own.
        const n = r.queue.findIndex((a) => !('text' in a))
        const asked = r.queue.splice(0, n === 0 ? 1 : n < 0 ? r.queue.length : n)
        const first = asked[0]
        r.position = asked.at(-1)!.position
        if ('scan' in first) {
          r.scanning = true
          r.moments = []
          r.scanned = await this.run(id, r, this.message(id, r, SCAN))
          r.scanning = false
        } else {
          const ask =
            'lead' in first
              ? `They've gone to the moment you marked at step ${first.lead.step}, ${KIND[first.lead.kind]} by ${first.lead.player} ("${first.lead.title}"), and are looking at the table just before it. ${LEAD}`
              : asked.map((a) => ('text' in a ? `They ask: ${a.text}` : '')).join('\n')
          await this.run(id, r, this.message(id, r, ask), 'lead' in first ? first.lead.step : undefined)
        }
      }
    } finally {
      r.busy = false
      this.changed(id, r)
    }
  }

  private message(id: string, r: Review, ask: string): string {
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
    if (ask === SCAN) parts.push(`The table at the end. p1 is ${players.p1.name}, p2 is ${players.p2.name}.`)
    else parts.push(`They're looking at ${where} (of ${steps.length} steps). p1 is ${players.p1.name}, p2 is ${players.p2.name}.`)
    const state = this.state(id, r)
    parts.push(this.texts(state, r), describeTable(state, 'p1', this.db(), true))
    parts.push(ask)
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

  // Whether it finished without an error or being stopped. moment: the step
  // of the moment Claude is taking them through, which its replies carry.
  private async run(id: string, r: Review, message: string, moment?: number): Promise<boolean> {
    r.status = 'thinking'
    this.changed(id, r)
    const run = this.agent({
      message,
      system: this.system(),
      model: r.model,
      sessionId: r.sessionId,
      tools: {
        table: () => describeTable(this.state(id, r), 'p1', this.db(), true),
        card: (name) => cardText(this.db(), name),
        tableAt: (step) => describeTable(this.sessions.stateAt(id, step), 'p1', this.db(), true),
        mark: (m) => this.mark(id, r, m),
      },
    })
    r.run = run
    const chat = r.chat // a reply finishing after Start over stays out of the new chat
    let ok = false
    try {
      for await (const e of run.events) {
        if (e.type === 'text') chat.push({ from: 'claude', text: e.text, ...(moment && { moment }) })
        if (e.type === 'done') {
          if (r.chat === chat) r.sessionId = e.sessionId ?? r.sessionId
          r.costUsd += e.costUsd
          if (e.error && !r.interrupted) chat.push({ from: 'note', text: `Claude stopped with an error: ${e.error}` })
          ok = !e.error && !r.interrupted && r.chat === chat
        }
        this.changed(id, r)
      }
    } finally {
      r.run = undefined
      r.status = 'idle'
      r.interrupted = false
    }
    return ok
  }

  private mark(id: string, r: Review, m: Moment): string {
    const steps = this.sessions.get(id).file.steps.length
    if (m.step > steps) return `There are only ${steps} steps.`
    r.moments = [...r.moments.filter((x) => x.step !== m.step), m].sort((a, b) => a.step - b.step)
    this.changed(id, r)
    return `Marked step ${m.step}.`
  }

  private changed(id: string, r: Review) {
    if (this.reviews.get(id) !== r) return // deleted while a run was finishing
    const { open, model, sessionId, chat, costUsd, read, heard, texts, moments, scanned } = r
    this.store.save(id, { open, model, ...(sessionId && { sessionId }), chat, costUsd, read, heard, ...(texts && { texts }), moments, scanned })
    this.sessions.touch(id)
  }
}
