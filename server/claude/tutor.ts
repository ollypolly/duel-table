// Claude as a tutor on a lesson: you ask about the step you're on, or any
// before it. Each message says where you are and brings Claude up to date
// with the narration of the steps it hasn't read yet. Steps after yours are
// never sent, so it can't give the lesson away. One chat per lesson, kept by
// a RecordStore so it carries on after a restart.
import { stamp, type ChatEntry, type ModelChoice } from '../../src/api/game'
import type { TutorView } from '../../src/api/tutor'
import type { BoardState } from '../../src/engine'
import { resolveScenario, type ResolveContext, type ResolvedScenario } from '../../src/scenarios/resolve'
import { SessionError } from '../sessions'
import type { Agent, AgentRun } from './agent'
import { memoryClaudeStore, type RecordStore } from './service'
import { cardText, describeTable, knownCards } from './view'

export type TutorRecord = {
  model: ModelChoice
  sessionId?: string
  chat: ChatEntry[]
  costUsd: number
  read: number // steps whose narration Claude has been given
  texts?: string[] // cards whose text Claude has been given
}

// interrupted: stopped by you, so the run ending early isn't an error.
type Tutor = TutorRecord & {
  status: TutorView['status']
  queue: { text: string; position: number }[]
  position: number
  run?: AgentRun
  busy: boolean
  interrupted?: boolean
}

export type TutorDeps = {
  ctx: () => ResolveContext
  agent: Agent
  system: () => string
  store?: RecordStore<TutorRecord>
}

// A chat's lesson: the chat is the lesson's id, or that with ~account after it.
const lessonOf = (chat: string) => chat.split('~')[0]

const fresh = (model: ModelChoice = 'opus'): TutorRecord => ({ model, chat: [], costUsd: 0, read: 0 })

export class TutorService {
  private tutors = new Map<string, Tutor>()
  private ctx: () => ResolveContext
  private agent: Agent
  private system: () => string
  private store: RecordStore<TutorRecord>

  constructor({ ctx, agent, system, store = memoryClaudeStore<TutorRecord>() }: TutorDeps) {
    this.ctx = ctx
    this.agent = agent
    this.system = system
    this.store = store
  }

  view(id: string): TutorView {
    const { model, status, chat, costUsd } = this.need(id)
    return { model, status, chat: stamp(chat), costUsd }
  }

  // Sent while Claude is answering, it waits for that answer to finish.
  ask(id: string, position: number, text: string) {
    const t = this.need(id)
    t.chat.push({ from: 'you', text })
    t.queue.push({ text, position })
    this.save(id, t)
    void this.pump(id, t)
  }

  async stop(id: string) {
    const t = this.need(id)
    t.queue = []
    t.interrupted = true
    await t.run?.interrupt()
  }

  settings(id: string, s: { model?: ModelChoice }) {
    const t = this.need(id)
    if (s.model) t.model = s.model
    this.save(id, t)
  }

  // Forget the conversation and start again.
  async clear(id: string) {
    const t = this.need(id)
    t.queue = []
    t.interrupted = true
    await t.run?.interrupt()
    Object.assign(t, fresh(t.model), { sessionId: undefined, texts: undefined })
    this.save(id, t)
  }

  // Wait for Claude to settle (tests).
  async idle(id: string) {
    while (this.tutors.get(id)?.busy) await new Promise((r) => setTimeout(r, 5))
  }

  private need(id: string): Tutor {
    if (!this.ctx().scenarios[lessonOf(id)]) throw new SessionError(404, `no scenario ${id}`)
    const found = this.tutors.get(id)
    if (found) return found
    const t: Tutor = { ...(this.store.load(id) ?? fresh()), status: 'idle', queue: [], position: 0, busy: false }
    this.tutors.set(id, t)
    return t
  }

  private lesson(id: string): ResolvedScenario {
    const r = resolveScenario(this.ctx().scenarios[lessonOf(id)], this.ctx())
    if (!r.ok) throw new SessionError(422, `scenario ${id} doesn't resolve`)
    return r.scenario
  }

  private async pump(id: string, t: Tutor) {
    if (t.busy) return
    t.busy = true
    try {
      while (t.queue.length) {
        const asked = t.queue.splice(0)
        t.position = asked.at(-1)!.position
        await this.run(
          id,
          t,
          this.message(
            id,
            t,
            asked.map((a) => a.text),
          ),
        )
      }
    } finally {
      t.busy = false
      this.save(id, t)
    }
  }

  private state(id: string, position: number): BoardState {
    const { timeline } = this.lesson(id)
    return timeline[Math.min(Math.max(0, position), timeline.length - 1)].state
  }

  private message(id: string, t: Tutor, questions: string[]): string {
    const lesson = this.lesson(id)
    const steps = lesson.game.steps
    const position = Math.min(Math.max(0, t.position), steps.length)
    const parts: string[] = []
    if (!t.sessionId) parts.push(`The lesson: ${lesson.title}\n\n${lesson.description ?? ''}`.trim())
    if (position > t.read) {
      parts.push(
        steps
          .slice(t.read, position)
          .map((s, i) => `Step ${t.read + i + 1}: ${s.label ?? ''}\n${s.narration ?? ''}`.trim())
          .join('\n\n'),
      )
      t.read = position
    }
    const where = position === 0 ? 'the setup, before step 1' : `step ${position}: ${steps[position - 1].label ?? ''}`
    parts.push(`They're on ${where} (of ${steps.length} steps).`)
    const state = this.state(id, position)
    parts.push(this.texts(state, t), describeTable(state, 'p1', this.ctx().db, true))
    parts.push(questions.map((q) => `They ask: ${q}`).join('\n'))
    return parts.filter(Boolean).join('\n\n')
  }

  // The text of each card on the table Claude hasn't been given yet.
  private texts(state: BoardState, t: Tutor): string {
    const given = new Set(t.texts)
    const db = this.ctx().db
    const fresh = knownCards(state, 'p1', db, true).filter((n) => !given.has(n))
    if (!fresh.length) return ''
    t.texts = [...given, ...fresh]
    return `Card texts (new to you):\n${fresh.map((n) => cardText(db, n)).join('\n\n')}`
  }

  private async run(id: string, t: Tutor, message: string) {
    t.status = 'thinking'
    const db = this.ctx().db
    const run = this.agent({
      message,
      system: this.system(),
      model: t.model,
      sessionId: t.sessionId,
      tools: { table: () => describeTable(this.state(id, t.position), 'p1', db, true), card: (name) => cardText(db, name) },
    })
    t.run = run
    const chat = t.chat // a reply finishing after Start over stays out of the new chat
    try {
      for await (const e of run.events) {
        if (e.type === 'text') chat.push({ from: 'claude', text: e.text })
        if (e.type === 'done') {
          if (t.chat === chat) t.sessionId = e.sessionId ?? t.sessionId
          t.costUsd += e.costUsd
          if (e.error && !t.interrupted) chat.push({ from: 'note', text: `Claude stopped with an error: ${e.error}` })
        }
        this.save(id, t)
      }
    } finally {
      t.run = undefined
      t.status = 'idle'
      t.interrupted = false
    }
  }

  private save(id: string, t: Tutor) {
    if (this.tutors.get(id) !== t) return
    const { model, sessionId, chat, costUsd, read, texts } = t
    this.store.save(id, { model, ...(sessionId && { sessionId }), chat: stamp(chat), costUsd, read, ...(texts && { texts }) })
  }
}
