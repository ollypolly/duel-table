// Claude on the home page: a chat about what to play and learn, not tied to
// a game. It can look up any card, read your decks, notes and games, save a
// deck, start a game or lesson for you, and play out an example on a board in
// the chat: a game on the rules engine only it plays, kept out of your lists
// and deleted with the chat. Each chat is its own thread with
// its own SDK session, so a new one starts light; threads are kept by a
// RecordStore and listed newest first.
import { randomBytes } from 'node:crypto'
import { stamp, type ChatEntry, type ModelChoice } from '../../src/api/game'
import type { HomeThread, HomeView } from '../../src/api/home'
import type { CardData } from '../../src/data/cardDb'
import type { Player } from '../../src/engine'
import { parseDeck, type ResolveContext } from '../../src/scenarios/resolve'
import type { DeckFile } from '../../src/scenarios/schema'
import type { GameService } from '../games'
import { SessionError, type SessionService } from '../sessions'
import type { Agent, AgentRun, DemoStart, DuelTools, StartGame } from './agent'
import { memoryClaudeStore, type RecordStore } from './service'
import { cardText, describeQuestion, describeTable, drawOdds, knownCards, rulesTopic, searchCards } from './view'

export type HomeRecord = {
  title: string
  model: ModelChoice
  sessionId?: string
  chat: ChatEntry[]
  costUsd: number
  updatedAt: number
}

// interrupted: stopped by you, so the run ending early isn't an error.
// seen, texts: how much of the open example Claude has been told, and the cards it has the text of.
type Thread = HomeRecord & { status: HomeView['status']; queue: string[]; run?: AgentRun; busy: boolean; interrupted?: boolean; seen?: number; texts?: string[] }

type Entry = { name: string; count: number }

export type HomeDeps = {
  ctx: () => ResolveContext
  sessions: SessionService
  games?: GameService // without it, Claude can't start a game
  agent: Agent
  system: () => string
  store?: RecordStore<HomeRecord>
  notes?: (deck: string) => string
  rules?: () => string
  findCards?: (query: string) => Promise<CardData[]> // by name, among every card printed
  saveDeck?: (id: string, name: string, main: Entry[], extra: Entry[]) => Promise<string> // returns the id it was saved under
  misplays?: (deck: string) => string[]
  draftDeck?: (id: string, name: string, main: Entry[], extra: Entry[]) => Promise<DeckFile> // a list of Claude's own, its cards downloaded
}

// An example stops taking moves here, so one that runs away ends.
const DEMO_MOVES = 60

const TITLE_MAX = 60
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck'
const count = (list: Entry[]) => list.reduce((n, e) => n + e.count, 0)
const lines = (list: Entry[]) => list.map((e) => `${e.count}x ${e.name}`).join('\n')

export class HomeService {
  private threads = new Map<string, Thread>()
  private deps: HomeDeps
  private store: RecordStore<HomeRecord>

  constructor(deps: HomeDeps) {
    this.deps = deps
    this.store = deps.store ?? memoryClaudeStore<HomeRecord>()
  }

  list(): HomeThread[] {
    return this.store
      .ids()
      .flatMap((id) => {
        const t = this.threads.get(id) ?? this.store.load(id)
        return t ? [{ id, title: t.title, updatedAt: t.updatedAt }] : []
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  view(id: string): HomeView {
    const { title, model, status, chat, costUsd, updatedAt } = this.need(id)
    return { id, title, updatedAt, model, status, chat: stamp(chat), costUsd }
  }

  // A new chat, named after its first message.
  start(text: string, model: ModelChoice = 'haiku'): HomeView {
    let id: string
    do id = `h-${randomBytes(3).toString('hex')}`
    while (this.store.load(id))
    const title = text.replace(/\s+/g, ' ').trim()
    this.threads.set(id, { title: title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title, model, chat: [], costUsd: 0, updatedAt: Date.now(), status: 'idle', queue: [], busy: false })
    this.ask(id, text)
    return this.view(id)
  }

  // Sent while Claude is answering, it waits for that answer to finish.
  ask(id: string, text: string) {
    const t = this.need(id)
    t.chat.push({ from: 'you', text })
    t.queue.push(text)
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

  rename(id: string, title: string) {
    const t = this.need(id)
    t.title = title
    this.save(id, t)
  }

  async remove(id: string) {
    const t = this.need(id)
    t.queue = []
    t.interrupted = true
    await t.run?.interrupt()
    for (const e of t.chat) if (e.demo) this.drop(e.demo.session)
    this.threads.delete(id)
    this.store.remove(id)
  }

  // Wait for Claude to settle (tests).
  async idle(id: string) {
    while (this.threads.get(id)?.busy) await new Promise((r) => setTimeout(r, 5))
  }

  private need(id: string): Thread {
    const found = this.threads.get(id)
    if (found) return found
    const saved = this.store.load(id)
    if (!saved) throw new SessionError(404, `no chat ${id}`)
    const t: Thread = { ...saved, status: 'idle', queue: [], busy: false }
    this.threads.set(id, t)
    return t
  }

  private async pump(id: string, t: Thread) {
    if (t.busy) return
    t.busy = true
    try {
      while (t.queue.length) await this.run(id, t, this.message(t, t.queue.splice(0)))
    } finally {
      t.busy = false
      this.save(id, t)
    }
  }

  // A new chat opens with what the person has: their decks and their record.
  private message(t: Thread, asked: string[]): string {
    const parts = t.sessionId ? [] : [`Their decks:\n${this.decks()}`, `Their games:\n${this.games(8)}`]
    return [...parts, asked.join('\n\n')].join('\n\n')
  }

  private async run(id: string, t: Thread, message: string) {
    t.status = 'thinking'
    const run = this.deps.agent({ message, system: this.deps.system(), model: t.model, sessionId: t.sessionId, tools: this.tools(id, t) })
    t.run = run
    try {
      for await (const e of run.events) {
        if (e.type === 'text') t.chat.push({ from: 'claude', text: e.text })
        if (e.type === 'done') {
          t.sessionId = e.sessionId ?? t.sessionId
          t.costUsd += e.costUsd
          if (e.error && !t.interrupted) t.chat.push({ from: 'note', text: `Claude stopped with an error: ${e.error}` })
        }
        this.save(id, t)
      }
    } finally {
      t.run = undefined
      t.status = 'idle'
      t.interrupted = false
    }
  }

  private tools(id: string, t: Thread): DuelTools {
    const { ctx, rules, findCards, saveDeck, games, sessions } = this.deps
    let moves = 0
    return {
      ...(games && {
        demo: async (d) => {
          let made: string | undefined
          try {
            const view = await games.create({ ...(await this.demoDecks(d)), title: d.title, demo: true, bots: [] })
            made = view.id
            if (d.setup) await games.restart(made, d.setup, d.lp)
          } catch (e) {
            if (made) this.drop(made)
            const err = e as SessionError
            return `Not set up: ${err.message}${err.details?.length ? `\n${err.details.join('\n')}` : ''}`
          }
          const last = t.chat.findLastIndex((e) => e.demo)
          if (d.again && last >= 0) this.drop(t.chat.splice(last, 1)[0].demo!.session)
          t.chat.push({ from: 'note', text: `Claude's example: ${d.title}`, demo: { session: made, title: d.title } })
          t.seen = 0
          t.texts = []
          moves = 0
          this.save(id, t)
          return this.demoNow(made, t, true)
        },
        table: () => {
          const sid = this.example(t)?.session
          return sid && sessions.has(sid) ? describeTable(sessions.get(sid).state, 'p1', ctx().db, true) : 'No example is open. Start one with demo.'
        },
        answer: async (question, choices, _batch, say) => {
          const demo = this.example(t)
          if (!demo || !sessions.has(demo.session)) return 'No example is open. Start one with demo.'
          if (++moves > DEMO_MOVES) return "That's as long as one example runs. Stop here and sum up what it showed."
          const prompt = await this.question(demo.session)
          if (!prompt || prompt.id !== question) return prompt ? `Question ${question} isn't open; question ${prompt.id} is.` : 'Nothing is being asked: the example is over.'
          const before = sessions.export(demo.session).steps.length
          try {
            await games.answer(demo.session, prompt.player, { id: question, choices })
          } catch (e) {
            return `Not accepted: ${(e as Error).message}`
          }
          // Shown under the board from the first step this move made.
          if (say) demo.captions = { ...demo.captions, [before + 1]: say }
          this.save(id, t)
          return this.demoNow(demo.session, t)
        },
      }),
      // A card the app hasn't downloaded is looked up by name among every card printed.
      card: async (name) => {
        if (ctx().db.byName(name)) return cardText(ctx().db, name)
        const found = (await findCards?.(name).catch(() => [])) ?? []
        const exact = found.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? (found.length === 1 ? found[0] : undefined)
        if (!exact) return found.length ? `No card named "${name}". Close: ${found.map((c) => c.name).join('; ')}` : `No card named "${name}".`
        return cardText({ ...ctx().db, byName: () => exact }, exact.name)
      },
      searchCards: (query) => searchCards(ctx().db, query, findCards),
      ...(rules && { rules: (topic) => rulesTopic(rules(), topic) }),
      decks: (deck) => this.decks(deck),
      games: () => this.games(30),
      odds: (cards, draws = 5, _from, deck) => {
        const list = this.deck(deck ?? '')
        if (!list) return `No deck "${deck}".`
        const want = new Set(cards.map((c) => ctx().db.byName(c)?.name ?? c))
        const hits = count(list.main.filter((e) => want.has(e.name)))
        const size = count(list.main)
        return `${hits} of the ${size} cards in the Main Deck are ${[...want].join(' or ')}. At least one in ${draws} draw${draws === 1 ? '' : 's'}: ${(drawOdds(size, hits, draws) * 100).toFixed(1)}%.`
      },
      ...(saveDeck && {
        suggestDeck: async (name, main, extra, why) => {
          try {
            const saved = await saveDeck(slug(name), name, main, extra)
            t.chat.push({ from: 'note', text: `Claude saved a deck, "${name}" (${saved}): ${why}` })
            this.save(id, t)
            return `Saved as ${saved}. It is in their deck list.`
          } catch (e) {
            return `Not saved: ${(e as Error).message}`
          }
        },
      }),
      ...(games && {
        startGame: async (g) => {
          try {
            const made = await games.create(this.gameOptions(g))
            t.chat.push({ from: 'note', text: g.opponent === 'lesson' ? 'Claude set up a lesson for you.' : 'Claude set up a game for you.', open: { session: made.id, title: `${made.players.p1.deckName ?? g.deck} vs ${made.players.p2.name}` } })
            this.save(id, t)
            return `Started (${made.id}). They have a button in the chat to open it.`
          } catch (e) {
            return `Not started: ${(e as Error).message}`
          }
        },
      }),
    }
  }

  // The example this chat has open: its latest.
  private example(t: Thread) {
    return t.chat.findLast((e) => e.demo)?.demo
  }

  private async question(sid: string) {
    const games = this.deps.games!
    return (await games.asking(sid, 'p1')) ?? (await games.asking(sid, 'p2'))
  }

  // Each side's deck in an example: one of the person's by id, or Claude's own list.
  private async demoDecks({ deck, opponentDeck = deck }: DemoStart) {
    const lists: Partial<Record<Player, DeckFile>> = {}
    const ids: { deck?: string; opponentDeck?: string } = {}
    for (const [p, key, side] of [['p1', 'deck', deck], ['p2', 'opponentDeck', opponentDeck]] as const) {
      if (typeof side === 'string') {
        if (!this.deck(side)) throw new SessionError(404, `no deck "${side}". Call decks for the list, or give the cards.`)
        ids[key] = side
      } else {
        if (!this.deps.draftDeck) throw new SessionError(501, 'only decks by id here')
        lists[p] = await this.deps.draftDeck(`demo-${slug(side.name)}`, side.name, side.main, side.extra)
      }
    }
    return { ...ids, lists }
  }

  // What Claude hasn't been told of the example yet, and the open question.
  private async demoNow(sid: string, t: Thread, table = false): Promise<string> {
    const { ctx, sessions, games } = this.deps
    const { steps } = sessions.export(sid)
    const fresh = steps.slice(t.seen ?? 0).flatMap((s) => (s.label ? [s.label] : []))
    t.seen = steps.length
    const game = await games!.get(sid)
    const given = new Set(t.texts)
    const cards = knownCards(game.state, 'p1', ctx().db, true).filter((n) => !given.has(n))
    t.texts = [...given, ...cards]
    const next = await this.question(sid)
    const winner = game.duel.result
    return (
      [
        fresh.length ? `Then:\n${fresh.map((l) => `- ${l}`).join('\n')}` : '',
        cards.length ? `Card texts (new to you):\n${cards.map((n) => cardText(ctx().db, n)).join('\n\n')}` : '',
        table ? describeTable(game.state, 'p1', ctx().db, true) : '',
        winner ? `The duel is over: ${winner.player} (${game.state.players[winner.player].name}) won.` : next ? `For ${next.player} (${game.state.players[next.player].name}): ${describeQuestion(next, game.state, next.player, ctx().db)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n') || 'Done.'
    )
  }

  private drop(sid: string) {
    try {
      this.deps.sessions.remove(sid)
    } catch {
      // Already gone.
    }
  }

  private gameOptions({ deck, opponentDeck = deck, opponent, topic }: StartGame) {
    if (opponent === 'lesson') return { deck, opponentDeck, lesson: true, ...(topic && { topic }) }
    if (opponent === 'claude') return { deck, opponentDeck, claude: 'p2' as const, coach: true }
    return { deck, opponentDeck, bot: opponent === 'trained' ? ('agent' as const) : ('random' as const), watch: true }
  }

  private deck(id: string) {
    const raw = this.deps.ctx().decks[id]
    try {
      return raw ? parseDeck(raw, `deck ${id}`) : undefined
    } catch {
      return undefined
    }
  }

  // The list of decks, or one deck's cards with the person's notes on it.
  private decks(id?: string): string {
    const { ctx, notes, games } = this.deps
    if (id) {
      const d = this.deck(id)
      if (!d) return `No deck "${id}". Call decks with no id for the list.`
      const said = notes?.(id).trim()
      return [`${d.name} (${id})`, `Main Deck (${count(d.main)}):\n${lines(d.main)}`, d.extra.length ? `Extra Deck (${count(d.extra)}):\n${lines(d.extra)}` : '', said ? `Their notes on it:\n${said}` : ''].filter(Boolean).join('\n\n')
    }
    const trained = new Set(games?.agentDecks() ?? [])
    const played = this.deps.sessions.list().filter((s) => s.kind === 'game')
    return (
      Object.keys(ctx().decks)
        .flatMap((k) => {
          const d = this.deck(k)
          if (!d) return []
          const n = played.filter((s) => s.players.p1.deck === k).length
          return [`- ${k}: ${d.name}${trained.has(k) ? ' (the trained bot can play it)' : ''}${n ? `, played ${n} time${n === 1 ? '' : 's'}` : ''}`]
        })
        .join('\n') || 'None yet.'
    )
  }

  // Games on the rules engine, newest first, then what reviews marked per deck.
  private games(limit: number): string {
    const all = this.deps.sessions
      .list()
      .filter((s) => s.kind === 'game' && !s.claudeLesson)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (!all.length) return 'None yet.'
    const line = (s: (typeof all)[number]) => {
      const marks = Object.entries(s.reviewed?.moments ?? {}).map(([k, n]) => `${n} ${k}`)
      const result = s.winner ? (s.winner === 'p1' ? 'won' : 'lost') : 'in progress'
      return `- ${s.updatedAt.slice(0, 10)}: ${s.players.p1.deckName ?? s.players.p1.deck} vs ${s.players.p2.deckName ?? s.players.p2.deck} (${s.opponent ?? 'a person'}), turn ${s.turn}, ${result}${marks.length ? `; review: ${marks.join(', ')}` : ''}`
    }
    const decks = [...new Set(all.flatMap((s) => s.players.p1.deck ?? []))]
    const marked = decks.flatMap((d) => {
      const m = this.deps.misplays?.(d) ?? []
      return m.length ? [`What reviews marked with ${d}:\n${m.map((x) => `- ${x}`).join('\n')}`] : []
    })
    const won = all.filter((s) => s.winner === 'p1').length
    const lost = all.filter((s) => s.winner === 'p2').length
    return [`${all.length} games: ${won} won, ${lost} lost.${all.length > limit ? ` The latest ${limit}:` : ''}`, all.slice(0, limit).map(line).join('\n'), ...(limit > 8 ? marked : [])].join('\n\n')
  }

  private save(id: string, t: Thread) {
    if (this.threads.get(id) !== t) return
    t.updatedAt = Date.now()
    const { title, model, sessionId, chat, costUsd, updatedAt } = t
    this.store.save(id, { title, model, ...(sessionId && { sessionId }), chat: stamp(chat), costUsd, updatedAt })
  }
}
