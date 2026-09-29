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
export type SessionView = SessionSummary & { file: ScenarioFile; state: BoardState }
export type ApplyResult =
  | { ok: true; state: BoardState; events: EngineEvent[]; issues: Issue[]; position: number }
  | { ok: false; issues: Issue[] }

export class SessionError extends Error {
  readonly status: 400 | 404 | 409 | 422
  readonly details?: string[]
  constructor(status: 400 | 404 | 409 | 422, message: string, details?: string[]) {
    super(message)
    this.status = status
    this.details = details
  }
}

type Listener = (view: SessionView) => void
type Live = { file: ScenarioFile; resolved: ResolvedScenario }

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
      if (r.ok) this.sessions.set(file.id, { file, resolved: r.scenario })
    }
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map(({ file, resolved }) => summary(file, resolved))
  }

  get(id: string): SessionView {
    const s = this.live(id)
    return view(s.file, s.resolved)
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
    return this.commit(file)
  }

  apply(id: string, step: Step, { strict = false } = {}): ApplyResult {
    const s = this.live(id)
    const state = s.resolved.timeline.at(-1)!.state
    const issues = validateStep(tableRules, state, step.actions)
    if (issues.some((i) => i.severity === 'error') || (strict && issues.length)) return { ok: false, issues }
    const saved = this.commit({ ...s.file, steps: [...s.file.steps, step] })
    const last = this.live(id).resolved.timeline.at(-1)!
    return { ok: true, state: saved.state, events: last.events, issues, position: saved.steps }
  }

  undo(id: string): SessionView {
    const s = this.live(id)
    if (s.file.steps.length === 0) throw new SessionError(409, 'nothing to undo: the session has no steps of its own')
    return this.commit({ ...s.file, steps: s.file.steps.slice(0, -1) })
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
    return this.commit(file)
  }

  // The session as a scenario file, ready for scenarios/.
  export(id: string, as?: { id?: string; title?: string }): ScenarioFile {
    const s = this.live(id)
    return { ...s.file, id: as?.id ?? s.file.id, title: as?.title ?? s.file.title }
  }

  subscribe(id: string, fn: Listener): () => void {
    this.live(id)
    const set = this.listeners.get(id) ?? new Set()
    set.add(fn)
    this.listeners.set(id, set)
    return () => set.delete(fn)
  }

  private commit(file: ScenarioFile): SessionView {
    const r = this.resolve(file)
    if (!r.ok) throw new SessionError(422, 'the session no longer resolves', r.errors)
    this.sessions.set(file.id, { file, resolved: r.scenario })
    this.store.save(file)
    const v = view(file, r.scenario)
    for (const fn of this.listeners.get(file.id) ?? []) fn(v)
    return v
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

const view = (file: ScenarioFile, r: ResolvedScenario): SessionView => ({ ...summary(file, r), file, state: r.timeline.at(-1)!.state })
