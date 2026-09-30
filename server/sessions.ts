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
import { Lesson, type AnswerEvent } from './lesson'
import type { GameView } from '../src/api/game'
import type { ReviewView } from '../src/api/review'
import type { Player } from '../src/engine'

export { SessionError }

export type SessionStore = {
  load(): ScenarioFile[]
  save(file: ScenarioFile): void
  remove(id: string): void
  updatedAt?(id: string): number | undefined // when it was last saved, if known
}

export const memoryStore = (): SessionStore => ({ load: () => [], save: () => {}, remove: () => {} })

export type CreateOptions = {
  scenario?: string
  atStep?: number // a position; defaults to the scenario's end
  deck?: string
  opponentDeck?: string // defaults to deck
  seed?: number
  title?: string
  opponentName?: string // defaults to Friend
}

export type SessionSummary = {
  id: string
  title: string
  steps: number
  basedOn?: string
  updatedAt: string
  players: Record<Player, { name: string; deck?: string; deckName?: string }>
  turn: number
  kind: 'game' | 'board' // a game on the rules engine, or a free board
  winner?: Player // the other player's LP hit 0
  claudeLesson?: true // a lesson Claude ran on the rules engine
}
export type SessionView = SessionSummary & { file: ScenarioFile; state: BoardState; lesson: LessonView; game?: GameView; review?: ReviewView }
type Duel = NonNullable<ScenarioFile['duel']>
export type ApplyResult = { ok: true; state: BoardState; events: EngineEvent[]; issues: Issue[]; position: number; revealed: number } | { ok: false; issues: Issue[] }

type Listener = (view: SessionView) => void
type Live = { file: ScenarioFile; resolved: ResolvedScenario; lesson: Lesson; updatedAt: number }

export class SessionService {
  private sessions = new Map<string, Live>()
  private listeners = new Map<string, Set<Listener>>()
  private ctx: () => ResolveContext
  private store: SessionStore
  // Live game state for sessions on the rules engine (set by GameService).
  gameView?: (id: string) => GameView | undefined
  // A review of the session with Claude, while one is open (set by ReviewService).
  reviewView?: (id: string) => ReviewView | undefined
  // Told when a session is deleted, to drop what else they hold for it.
  onRemove: ((id: string) => void)[] = []
  // Told when the viewer answers a lesson prompt (Claude, running a lesson).
  onAnswer: ((id: string, answer: AnswerEvent) => void)[] = []

  // ctx is a function so edits to scenarios/ and decks/ are picked up.
  constructor(ctx: () => ResolveContext, store: SessionStore = memoryStore()) {
    this.ctx = ctx
    this.store = store
    for (const file of store.load()) {
      const r = this.resolve(file)
      if (r.ok)
        this.sessions.set(file.id, { file, resolved: r.scenario, lesson: this.newLesson(file.id, r.scenario), updatedAt: store.updatedAt?.(file.id) ?? Date.now() })
    }
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map((s) => this.summary(s))
  }

  get(id: string): SessionView {
    const s = this.live(id)
    const game = s.file.duel && this.gameView?.(id)
    const review = this.reviewView?.(id)
    return { ...this.summary(s), file: s.file, state: s.resolved.timeline.at(-1)!.state, lesson: s.lesson.view(), ...(game && { game }), ...(review && { review }) }
  }

  // The board at a position (0 is the setup, n is after step n), clamped to the steps there are.
  stateAt(id: string, position: number): BoardState {
    const { timeline } = this.live(id).resolved
    return timeline[Math.min(Math.max(0, position), timeline.length - 1)].state
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
        players: { p1: { name: 'You', ...this.deck(opts.deck) }, p2: { name: opts.opponentName ?? 'Friend', ...this.deck(opts.opponentDeck ?? opts.deck) } },
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
    if (s.file.duel) throw new SessionError(409, 'this is a game on the rules engine: answer its prompts instead of posting steps')
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
    if (s.file.duel) throw new SessionError(409, "games on the rules engine can't be undone")
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

  rename(id: string, title: string): SessionView {
    this.commit({ ...this.live(id).file, title })
    return this.notify(id)
  }

  remove(id: string) {
    this.live(id)
    const children = [...this.sessions.values()].filter((s) => s.file.extends?.scenario === id).map((s) => s.file.id)
    if (children.length) throw new SessionError(409, `sessions ${children.join(', ')} start from this one`, children)
    for (const fn of this.onRemove) fn(id)
    this.sessions.delete(id)
    this.listeners.delete(id)
    this.store.remove(id)
  }

  // Games: steps translated from the rules engine, with its saved answers.
  // Each step is paced like a posted one.
  appendGame(id: string, steps: Step[], duel: Duel, reveal?: (step: Step) => Reveal | undefined): SessionView {
    const s = this.live(id)
    this.commit({ ...s.file, steps: [...s.file.steps, ...steps], duel })
    let position = s.lesson.total
    for (const step of steps) s.lesson.added(step, ++position, reveal?.(step))
    return this.notify(id)
  }

  // A game started over from a new position (a lesson's setup): no steps or
  // answers yet, and the viewer's place starts again too.
  restartGame(id: string, from: Pick<ScenarioFile, 'players' | 'setup' | 'start'>): SessionView {
    const s = this.live(id)
    if (!s.file.duel) throw new SessionError(409, `session ${id} isn't a game on the rules engine`)
    const file: ScenarioFile = { ...s.file, ...from, steps: [], duel: { ...s.file.duel, responses: [], winner: undefined } }
    const r = this.resolve(file)
    if (!r.ok) throw new SessionError(422, "that setup doesn't work", r.errors)
    this.sessions.set(id, { file, resolved: r.scenario, lesson: this.newLesson(id, r.scenario), updatedAt: Date.now() })
    this.store.save(file)
    return this.notify(id)
  }

  // Tell listeners something outside the file changed (a game's prompt).
  touch(id: string): SessionView {
    return this.notify(id)
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
    const e = this.live(id).lesson.answer(answer)
    const view = this.notify(id)
    for (const fn of this.onAnswer) fn(id, e)
    return view
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
    this.sessions.set(file.id, { file, resolved: r.scenario, lesson, updatedAt: Date.now() })
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

  private summary({ file, resolved, updatedAt }: Live): SessionSummary {
    const last = resolved.timeline.at(-1)!.state
    const decks = this.ctx().decks as Record<string, { name?: string } | undefined>
    const player = (p: Player) => {
      const { name, deck } = resolved.game.setup.players[p]
      const deckName = file.players?.[p].list?.name ?? (deck && decks[deck]?.name)
      return { name, ...(deck && { deck }), ...(deckName && { deckName }) }
    }
    const lost = (['p1', 'p2'] as const).find((p) => last.players[p].lp <= 0)
    const winner = file.duel?.winner ?? (lost && (lost === 'p1' ? 'p2' : 'p1'))
    return {
      id: file.id,
      title: file.title,
      steps: resolved.game.steps.length,
      ...(file.extends && { basedOn: file.extends.scenario }),
      updatedAt: new Date(updatedAt).toISOString(),
      players: { p1: player('p1'), p2: player('p2') },
      turn: last.turn,
      kind: file.duel ? 'game' : 'board',
      ...(file.duel && winner && { winner }),
      ...(file.duel?.lesson && { claudeLesson: true as const }),
    }
  }

  // A deck and a copy of its list, so editing the deck later leaves this
  // session as it was.
  private deck(id: string) {
    const list = this.ctx().decks[id] as NonNullable<ScenarioFile['players']>['p1']['list']
    return { deck: id, ...(list && { list }) }
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
