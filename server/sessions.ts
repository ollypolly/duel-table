// The session service: boards in progress that Claude (over HTTP) and the
// browser both act on. No HTTP in here, so an MCP transport can wrap it too.
//
// A session is stored as a scenario file (a fork of a scenario, or a full
// scenario built from decks), so its log replays with the same code as any
// scenario and exporting one is just writing the file out.
//
// Positions follow the UI and URLs: 0 is the setup, n is "after step n".
import { randomBytes } from 'node:crypto'
import { validateStep, tableRules, type BoardState, type EngineEvent, type Issue, type Step } from '../src/engine'
import { resolveScenario, type ResolveContext, type ResolvedScenario } from '../src/scenarios/resolve'
import type { ScenarioFile } from '../src/scenarios/schema'
import type { Answer, LessonView, Prompt, Reveal } from '../src/api/lesson'
import { SessionError } from './errors'
import { Lesson } from './lesson'

export { SessionError }

export type SessionStore = {
  load(): ScenarioFile[]
  save(file: ScenarioFile): void
}

export const memoryStore = (): SessionStore => ({ load: () => [], save: () => {} })

export type CreateOptions = {
  scenario?: string
  atStep?: number // a position; defaults to the scenario's end
  deck?: string
  opponentDeck?: string // defaults to deck
  seed?: number
  title?: string
}

export type SessionSummary = { id: string; title: string; steps: number; basedOn?: string }
export type SessionView = SessionSummary & { file: ScenarioFile; state: BoardState; lesson: LessonView }
export type ApplyResult =
  | { ok: true; state: BoardState; events: EngineEvent[]; issues: Issue[]; position: number; revealed: number }
  | { ok: false; issues: Issue[] }

type Listener = (view: SessionView) => void
type Live = { file: ScenarioFile; resolved: ResolvedScenario; lesson: Lesson }

export class SessionService {
  private sessions = new Map<string, Live>()
  private listeners = new Map<string, Set<Listener>>()
  private ctx: () => ResolveContext
  private store: SessionStore

  // ctx is a function so edits to scenarios/ and decks/ are picked up.
  constructor(ctx: () => ResolveContext, store: SessionStore = memoryStore()) {
    this.ctx = ctx
    this.store = store
    for (const file of store.load()) {
      const r = this.resolve(file)
      if (r.ok) this.sessions.set(file.id, { file, resolved: r.scenario, lesson: this.newLesson(file.id, r.scenario) })
    }
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map(({ file, resolved }) => summary(file, resolved))
  }

  get(id: string): SessionView {
    const s = this.live(id)
    return { ...summary(s.file, s.resolved), file: s.file, state: s.resolved.timeline.at(-1)!.state, lesson: s.lesson.view() }
  }

  create(opts: CreateOptions): SessionView {
    const id = this.newId()
    let file: ScenarioFile
    if (opts.scenario) {
      if (opts.deck || opts.opponentDeck || opts.seed !== undefined) {
        throw new SessionError(400, 'give either a scenario, or decks and a seed, not both')
      }
      const parent = this.resolve(this.ctx().scenarios[opts.scenario] ?? missing(opts.scenario))
      if (!parent.ok) throw new SessionError(422, `scenario ${opts.scenario} doesn't load`, parent.errors)
      const last = parent.scenario.game.steps.length
      const at = opts.atStep ?? last
      if (at < 0 || at > last) throw new SessionError(400, `atStep must be 0-${last} for ${opts.scenario}`)
      file = { id, title: opts.title ?? `${parent.scenario.title} (live)`, extends: { scenario: opts.scenario, atStep: at - 1 }, steps: [] }
    } else if (opts.deck) {
      file = {
        id,
        title: opts.title ?? `Live: ${opts.deck}`,
        seed: opts.seed ?? Math.floor(Math.random() * 2 ** 31),
        players: { p1: { name: 'You', deck: opts.deck }, p2: { name: 'Friend', deck: opts.opponentDeck ?? opts.deck } },
        steps: [],
      }
    } else {
      throw new SessionError(400, 'give a scenario (optionally with atStep) or a deck')
    }
    this.commit(file)
    return this.get(id)
  }

  // Checked against the state after every step, queued ones included. The
  // viewer's own steps (author "user") can't jump the queue.
  apply(id: string, step: Step, { strict = false, reveal }: { strict?: boolean; reveal?: Reveal } = {}): ApplyResult {
    const s = this.live(id)
    if (step.author === 'user' && s.lesson.view().queued) throw new SessionError(409, 'steps are still queued for the viewer')
    const state = s.resolved.timeline.at(-1)!.state
    const issues = validateStep(tableRules, state, step.actions)
    if (issues.some((i) => i.severity === 'error') || (strict && issues.length)) return { ok: false, issues }
    const saved = { ...step, author: step.author ?? 'claude' }
    const last = this.commit({ ...s.file, steps: [...s.file.steps, saved] }).timeline.at(-1)!
    const position = s.lesson.total + 1
    s.lesson.added(saved, position, reveal)
    this.notify(id)
    return { ok: true, state: last.state, events: last.events, issues, position, revealed: s.lesson.view().revealed }
  }

  undo(id: string, { byUser = false } = {}): SessionView {
    const s = this.live(id)
    if (s.file.steps.length === 0) throw new SessionError(409, 'nothing to undo: the session has no steps of its own')
    this.commit({ ...s.file, steps: s.file.steps.slice(0, -1) })
    s.lesson.removed(byUser)
    return this.notify(id)
  }

  // A new session from this one at a position (default: its end).
  fork(id: string, atStep?: number): SessionView {
    const s = this.live(id)
    const last = s.resolved.game.steps.length
    const at = atStep ?? last
    if (at < 0 || at > last) throw new SessionError(400, `atStep must be 0-${last}`)
    const inherited = s.resolved.inheritedSteps
    const file: ScenarioFile = { ...s.file, id: this.newId(), title: `${s.file.title} (fork at step ${at})` }
    if (!s.file.extends || at >= inherited) file.steps = s.file.steps.slice(0, at - inherited)
    else Object.assign(file, { extends: { ...s.file.extends, atStep: at - 1 }, steps: [] })
    this.commit(file)
    return this.get(file.id)
  }

  // The session as a scenario file, ready for scenarios/.
  export(id: string, as?: { id?: string; title?: string }): ScenarioFile {
    const s = this.live(id)
    return { ...s.file, id: as?.id ?? s.file.id, title: as?.title ?? s.file.title }
  }

  // Lessons: see ./lesson.ts.

  next(id: string): SessionView {
    this.live(id).lesson.next()
    return this.notify(id)
  }

  present(id: string, to: { position: number; from?: number }): SessionView {
    this.live(id).lesson.present(to)
    return this.notify(id)
  }

  ask(id: string, prompt: Prompt) {
    const open = this.live(id).lesson.ask(prompt)
    this.notify(id)
    return open
  }

  withdraw(id: string): SessionView {
    this.live(id).lesson.withdraw()
    return this.notify(id)
  }

  answer(id: string, answer: Answer): SessionView {
    this.live(id).lesson.answer(answer)
    return this.notify(id)
  }

  wait(id: string, since: number | undefined, timeoutMs: number) {
    return this.live(id).lesson.wait(since, timeoutMs)
  }

  subscribe(id: string, fn: Listener): () => void {
    this.live(id)
    const set = this.listeners.get(id) ?? new Set()
    set.add(fn)
    this.listeners.set(id, set)
    return () => set.delete(fn)
  }

  private commit(file: ScenarioFile): ResolvedScenario {
    const r = this.resolve(file)
    if (!r.ok) throw new SessionError(422, 'the session no longer resolves', r.errors)
    const lesson = this.sessions.get(file.id)?.lesson ?? this.newLesson(file.id, r.scenario)
    this.sessions.set(file.id, { file, resolved: r.scenario, lesson })
    this.store.save(file)
    return r.scenario
  }

  private notify(id: string): SessionView {
    const v = this.get(id)
    for (const fn of this.listeners.get(id) ?? []) fn(v)
    return v
  }

  private newLesson(id: string, r: ResolvedScenario) {
    return new Lesson(r.game.steps.length, () => this.notify(id))
  }

  private resolve(file: unknown) {
    const ctx = this.ctx()
    const sessions = Object.fromEntries([...this.sessions].map(([id, s]) => [id, s.file]))
    return resolveScenario(file, { ...ctx, scenarios: { ...sessions, ...ctx.scenarios } })
  }

  private live(id: string): Live {
    const s = this.sessions.get(id)
    if (!s) throw new SessionError(404, `no session "${id}"`)
    return s
  }

  private newId(): string {
    let id: string
    do id = `s-${randomBytes(3).toString('hex')}`
    while (this.sessions.has(id))
    return id
  }
}

const missing = (id: string): never => {
  throw new SessionError(404, `no scenario "${id}"`)
}

const summary = (file: ScenarioFile, r: ResolvedScenario): SessionSummary => ({
  id: file.id,
  title: file.title,
  steps: r.game.steps.length,
  ...(file.extends && { basedOn: file.extends.scenario }),
})
