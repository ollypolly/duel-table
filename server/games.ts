// Games on the rules engine. Each is a session whose steps are translated from
// the core, plus the answers given to the core so far (saved in the session
// file as duel.responses). After a restart a game is rebuilt by replaying
// those answers the first time it's needed.
import { PLAYERS, type BoardState, type Player, type Step } from '../src/engine'
import type { GameAnswer, GameView, ModelChoice } from '../src/api/game'
import { resolveScenario, type ResolveContext } from '../src/scenarios/resolve'
import type { DeckFile, ScenarioFile, Setup } from '../src/scenarios/schema'
import { AgentBot, agentCodes, agentUrl } from './ocg/agentBot'
import { botResponse, seededRng, type Rng } from './ocg/bot'
import { decodeResponse, encodeResponse, playerOf } from './ocg/duel'
import { OcgGame, type Progress } from './ocg/game'
import { loadOcg, M, ocgDataDir, type Ocg, type PromptMsg } from './ocg/lib'
import { question, type Question } from './ocg/prompt'
import { ROOT } from './files'
import { SessionError, type SessionService, type SessionView } from './sessions'

// claude: the player Claude answers for, with its model and coach setting.
// lesson: Claude runs the game as a lesson on topic, answering for whichever
// players it holds (both, to begin with).
// bot: which bot answers for the players in bots: the trained one (ygo-agent)
// or, by default, the random one.
// scenario: start from that scenario's setup (hands, fields, LP) instead of
// two decks and opening hands.
export type CreateGameOptions = {
  deck?: string
  scenario?: string
  opponentDeck?: string
  seed?: number
  bots?: Player[]
  bot?: BotKind
  claude?: Player
  lesson?: boolean
  topic?: string
  model?: ModelChoice
  coach?: boolean
  title?: string
}

// How long each bot (or Claude) step stays on screen before the next.
export const BOT_STEP_MS = 700
// Moves a person can take back in one game.
export const UNDOS = 3

type Asked = Extract<Question, { prompt: unknown }>
export type BotKind = 'random' | 'agent'
type Seats = { bots: Player[]; bot?: BotKind; claude?: Player; lesson?: boolean; shuffled: boolean }
// moves: for each move a person began, how many answers had been given.
// agents: the trained bot's side of the conversation, for each player it plays.
type Live = Seats & { game: OcgGame; ocg: Ocg; rng: Rng; codes: number[]; asked?: Asked; moves: number[]; agents?: Partial<Record<Player, AgentBot>> }

// Where the trained bot is served, and the cards it knows.
export type AgentConfig = { url: string; codes: Set<number> }

export class GameService {
  private games = new Map<string, Live>()
  private sessions: SessionService
  private ctx: () => ResolveContext
  private ocg: () => Promise<Ocg>
  private agent?: AgentConfig
  // Called when a game is created, before its first move, and whenever it
  // moves on or asks something (Claude listens).
  onCreate?: (id: string, opts: CreateGameOptions) => void
  onChange?: (id: string) => void
  // Claude's part of a game's view, and the players it answers for now (set
  // by ClaudeService).
  claudeView?: (id: string) => GameView['claude']
  claudeHolds?: (id: string) => Player[] | undefined
  // A person answered for player (a lesson takes back a player handed over
  // for one question).
  onPersonAnswer?: (id: string, player: Player) => void
  // A move was taken back, so the steps after it never happened.
  onUndo?: (id: string) => void
  // The person gave up.
  onForfeit?: (id: string) => void

  constructor(
    sessions: SessionService,
    ctx: () => ResolveContext,
    ocg: () => Promise<Ocg> = () => loadOcg(ocgDataDir()),
    agent: AgentConfig | undefined = agentUrl() ? { url: agentUrl()!, codes: agentCodes(ROOT) } : undefined,
  ) {
    this.sessions = sessions
    this.ctx = ctx
    this.ocg = ocg
    this.agent = agent
    sessions.gameView = (id) => this.view(id)
    sessions.onRemove.push((id) => {
      this.hangUp(id)
      this.games.delete(id)
    })
  }

  // The decks the trained bot can play: those made only of cards it knows.
  // Undefined when it isn't set up.
  agentDecks(): string[] | undefined {
    if (!this.agent) return undefined
    const { db, decks } = this.ctx()
    const { codes } = this.agent
    const knows = (name: string) => {
      const id = db.byName(name)?.id
      return id !== undefined && (codes.has(id) || this.aliases?.get(id) !== undefined)
    }
    return Object.values(decks as Record<string, DeckFile>)
      .filter((d) => [...d.main, ...d.extra].every((e) => knows(e.name)))
      .map((d) => d.id)
  }

  // Printings the trained bot knows under another code, once the engine's
  // card data is loaded.
  private aliases?: Map<number, number>
  async loadAgent() {
    if (!this.agent || this.aliases) return
    const ocg = await this.ocg()
    const aliases = new Map<number, number>()
    for (const c of ocg.cards()) if (c.alias && this.agent.codes.has(c.alias)) aliases.set(c.code, c.alias)
    this.aliases = aliases
  }

  async create(opts: CreateGameOptions): Promise<SessionView> {
    const ocg = await this.ocg()
    const bots = opts.claude || opts.lesson ? [] : (opts.bots ?? ['p2'])
    const bot = bots.length && opts.bot === 'agent' ? 'agent' : undefined
    if (bot) {
      await this.loadAgent()
      const deck = opts.opponentDeck ?? opts.deck ?? ''
      if (!this.agent) throw new SessionError(501, "the trained bot isn't set up (YGO_AGENT_URL)")
      if (opts.scenario || !this.agentDecks()!.includes(deck)) throw new SessionError(422, `the trained bot can't play ${opts.scenario ? 'from a position' : deck}: it only knows its own decks`)
    }
    const { id } = this.sessions.create({
      ...(opts.scenario
        ? {
            scenario: opts.scenario,
            atStep: 0,
            title: opts.title ?? `Practice: ${(this.ctx().scenarios[opts.scenario] as ScenarioFile | undefined)?.title ?? opts.scenario}`,
          }
        : {
            deck: opts.deck,
            opponentDeck: opts.opponentDeck,
            seed: opts.seed,
            title: opts.title ?? `${opts.lesson ? 'Lesson' : 'Game'}: ${opts.deck} vs ${opts.opponentDeck ?? opts.deck}`,
          }),
      ...(bots.includes('p2') && { opponentName: bot ? 'Trained bot' : 'Bot' }),
      // Claude plays as the character its deck belongs to, if it has one.
      ...(opts.claude === 'p2' && { opponentName: (this.ctx().decks[opts.opponentDeck ?? opts.deck ?? ''] as DeckFile | undefined)?.character?.name ?? 'Claude' }),
    })
    const file = this.sessions.export(id)
    let game: OcgGame
    try {
      game = new OcgGame(ocg, this.setup(file))
    } catch (e) {
      throw new SessionError(422, (e as Error).message)
    }
    const live = this.track(id, game, ocg, file.seed!, { bots, bot, claude: opts.claude, lesson: opts.lesson, shuffled: true })
    this.onCreate?.(id, opts)
    return this.advance(id, live, game.start())
  }

  // A person's answer to the open question: the options they picked. player
  // defaults to whoever it's for, as long as Claude isn't answering for them.
  async answer(id: string, player: Player | undefined, a: GameAnswer): Promise<SessionView> {
    const live = await this.live(id)
    const { asked } = live
    const person = !player
    if (!player) {
      player = asked?.prompt.player
      if (player && this.held(id, live).includes(player)) throw new SessionError(409, `Claude is answering for ${player}`)
    }
    if (!asked || asked.prompt.player !== player) throw new SessionError(409, `nothing is being asked of ${player}`)
    const { prompt } = asked
    if (a.id !== prompt.id) throw new SessionError(409, `question ${a.id} isn't open (${prompt.id} is)`)
    const { min, max, options } = prompt
    if (a.choices.length < min || a.choices.length > max) throw new SessionError(400, min === max ? `pick ${min}` : `pick ${min}-${max}`)
    if (new Set(a.choices).size !== a.choices.length || a.choices.some((c) => c >= options.length))
      throw new SessionError(400, `choices must be distinct, 0-${options.length - 1}`)
    const at = live.game.duel.responses.length
    const before = live.game.duel.pending
    const response = asked.answer(a.choices)
    const p = live.game.respond(response)
    if (p.retried) throw new SessionError(422, "the rules engine didn't accept that")
    if (!live.bots.includes(player) && player !== live.claude && startsMove(before, response)) live.moves.push(at)
    if (person) this.onPersonAnswer?.(id, player)
    return this.advance(id, live, p)
  }

  // Start a game over from a new position, on p1's turn in Main Phase 1 (a
  // lesson's setup). A card placed more times than its player's deck has it
  // is added to what they own, so any board can be set up.
  async restart(id: string, setup: Setup, lp: Partial<Record<Player, number>> = {}): Promise<SessionView> {
    const old = await this.live(id)
    const file = this.sessions.export(id)
    const { db, decks } = this.ctx()
    const players = structuredClone(file.players!)
    for (const p of ['p1', 'p2'] as const) {
      const deck = players[p].list ?? (decks[players[p].deck ?? ''] as DeckFile | undefined)
      const have = new Map<string, number>()
      for (const e of [...(deck?.main ?? []), ...(deck?.extra ?? [])]) have.set(e.name, (have.get(e.name) ?? 0) + e.count)
      const cards: string[] = []
      for (const name of placedNames(setup, p)) {
        const n = db.byName(name)?.name ?? name
        if ((have.get(n) ?? 0) > 0) have.set(n, have.get(n)! - 1)
        else cards.push(n)
      }
      players[p] = { ...players[p], cards, ...(lp[p] !== undefined && { lp: lp[p] }) }
      if (!cards.length) delete players[p].cards
    }
    const from = { players, setup, start: { phase: 'main1' as const } }
    let game: OcgGame
    try {
      game = new OcgGame(old.ocg, this.setup({ ...file, ...from }))
    } catch (e) {
      throw new SessionError(422, e instanceof SessionError ? `${e.message}: ${e.details?.join('; ')}` : (e as Error).message)
    }
    this.sessions.restartGame(id, from)
    const { bots, bot, claude, lesson, shuffled } = old
    const live = this.track(id, game, old.ocg, file.seed ?? 0, { bots, bot, claude, lesson, shuffled })
    return this.advance(id, live, game.start())
  }

  // Take back the person's last move: the game goes back to the question it
  // began with, by replaying the answers before it. A move is a choice in the
  // Main or Battle Phase, or a response they chose to make; what it led to
  // (costs, targets, the other side's replies) goes with it. Draws and
  // shuffles come out the same, as they follow from the seed.
  async undo(id: string): Promise<SessionView> {
    const old = await this.live(id)
    const file = this.sessions.export(id)
    const duel = file.duel!
    if (this.undos(id, old) === undefined) {
      if (duel.lesson) throw new SessionError(409, "a lesson's moves can't be taken back")
      if ((duel.undone ?? 0) >= UNDOS) throw new SessionError(409, `all ${UNDOS} take-backs are used`)
      throw new SessionError(409, old.moves.length ? "a move can be taken back when it's your move" : 'no move of yours to take back')
    }
    const to = old.moves.at(-1)!
    const game = new OcgGame(old.ocg, this.setup(file), !!duel.shuffled)
    const last = game.replay(duel.responses.slice(0, to).map(decodeResponse))
    const { bots, bot, claude, lesson, shuffled } = old
    const live = this.track(id, game, old.ocg, (file.seed ?? 0) + to, { bots, bot, claude, lesson, shuffled })
    live.moves = old.moves.slice(0, -1)
    const q = last.prompt && this.ask(live, last)
    if (q && 'prompt' in q) live.asked = q
    this.sessions.rewindGame(id, last.steps, { ...duel, responses: duel.responses.slice(0, to), winner: undefined, forfeit: undefined, undone: (duel.undone ?? 0) + 1 })
    this.onUndo?.(id)
    this.onChange?.(id)
    return this.sessions.get(id)
  }

  // The person gives up a game that's still going, at any point: the other
  // side wins. Whatever was being asked is dropped.
  async forfeit(id: string): Promise<SessionView> {
    const live = await this.live(id)
    if (live.lesson) throw new SessionError(409, "a lesson can't be forfeited")
    if (live.game.duel.result) throw new SessionError(409, 'the game is already over')
    const player = PLAYERS.find((p) => !live.bots.includes(p) && p !== live.claude)
    if (!player) throw new SessionError(409, 'nobody is playing this game')
    live.game.duel.surrender(player)
    live.asked = undefined
    this.sessions.appendGame(id, [], { ...this.sessions.export(id).duel!, forfeit: player, winner: live.game.duel.result!.player })
    this.onForfeit?.(id)
    this.onChange?.(id)
    return this.sessions.get(id)
  }

  // Take-backs left, when there's a move to take back now: at a person's
  // question, or once the game is over.
  private undos(id: string, live: Live): number | undefined {
    const left = UNDOS - (this.sessions.export(id).duel?.undone ?? 0)
    const yours = live.asked && !this.held(id, live).includes(live.asked.prompt.player)
    return !live.lesson && left > 0 && live.moves.length && (yours || live.game.duel.result) ? left : undefined
  }

  async get(id: string): Promise<OcgGame> {
    return (await this.live(id)).game
  }

  // The open question, if it's for this player.
  async asking(id: string, player: Player) {
    const { asked } = await this.live(id)
    return asked?.prompt.player === player ? asked.prompt : undefined
  }

  isGame(id: string): boolean {
    return !!this.sessions.export(id).duel
  }

  private view(id: string): GameView | undefined {
    const live = this.games.get(id)
    if (!live) {
      // Not rebuilt yet: start that, and report what the file knows.
      void this.live(id)
        .then(() => this.sessions.touch(id))
        .catch(() => {})
      return { bots: this.sessions.export(id).duel?.bots ?? [] }
    }
    const { game, bots, asked } = live
    const winner = game.duel.result
    const claude = this.claudeView?.(id)
    // Claude's questions stay on the server; the browser only needs yours.
    const prompt = asked && !this.held(id, live).includes(asked.prompt.player) ? asked.prompt : undefined
    const undos = this.undos(id, live)
    return { bots, ...(game.waitingFor && { waitingFor: game.waitingFor }), ...(winner && { winner }), ...(prompt && { prompt }), ...(claude && { claude }), ...(undos && { undos }) }
  }

  // Save what happened, then answer for bots, and for people where there's
  // nothing to decide, until a person has a real question (or the duel ends).
  // Bot steps are paced so they can be watched.
  private async advance(id: string, live: Live, first: Progress): Promise<SessionView> {
    const steps: Step[] = []
    const paced = new Set<Step>()
    let p = first
    let actor: Player | undefined
    let attempt = 0
    live.asked = undefined
    for (;;) {
      for (const s of p.steps) {
        steps.push(s)
        if (actor && (live.bots.includes(actor) || this.held(id, live).includes(actor))) paced.add(s)
      }
      if (!p.prompt || !p.waitingFor) break
      if (attempt > 50) throw new Error(`stuck on ${p.prompt.constructor.name}`)
      attempt = p.retried ? attempt + 1 : 0
      actor = p.waitingFor
      let response: Uint8Array
      if (live.bots.includes(actor)) {
        // The trained bot's pick, or the random bot's when it has none (or
        // the core turned its pick down).
        const { state } = live.game
        const picked = attempt === 0 ? await live.agents?.[actor]?.respond(p.prompt, { ocg: live.ocg, duel: live.game.duel, me: actor, turn: state.turn, phase: state.phase, active: state.activePlayer }) : undefined
        if (live.game.duel.result) break // given up while it was thinking
        response = picked ?? botResponse(p.prompt, live.rng, attempt, live.codes)
      }
      else if (quietChance(p, live.game.state)) response = (p.prompt as InstanceType<typeof M.YGOProMsgSelectChain>).defaultResponse()
      else {
        const q = this.ask(live, p)
        if ('prompt' in q) {
          live.asked = q
          break
        }
        response = q.auto
      }
      p = live.game.respond(response)
    }
    const { undone, forfeit } = this.sessions.export(id).duel ?? {}
    const duel = {
      responses: live.game.duel.responses.map(encodeResponse),
      ...(undone && { undone }),
      ...(forfeit && { forfeit }),
      bots: live.bots,
      ...(live.bot && { bot: live.bot }),
      ...(live.claude && { claude: live.claude }),
      ...(live.lesson && { lesson: true }),
      ...(live.shuffled && { shuffled: true }),
      ...(live.game.duel.result && { winner: live.game.duel.result.player }),
    }
    const view = this.sessions.appendGame(id, steps, duel, (s) => (paced.has(s) ? { afterMs: BOT_STEP_MS } : undefined))
    this.onChange?.(id)
    return view
  }

  // Games saved before the winner was, get it by replaying them (without
  // tracking them, so nobody is asked anything). Slow, so run it in the
  // background at startup.
  async recordResults() {
    const ocg = await this.ocg()
    for (const { id } of this.sessions.list()) {
      const file = this.sessions.export(id)
      if (!file.duel || file.duel.winner || this.games.has(id)) continue
      try {
        const game = new OcgGame(ocg, this.setup(file), !!file.duel.shuffled)
        game.replay(file.duel.responses.map(decodeResponse))
        const result = game.duel.result
        if (result && !this.games.has(id)) this.sessions.appendGame(id, [], { ...file.duel, winner: result.player })
      } catch {
        // A game that no longer replays stays as it is.
      }
    }
  }

  private ask(live: Live, p: Progress): Question {
    return question(p.prompt!, { id: live.game.duel.responses.length, hint: p.hint, chain: p.chain, ocg: live.ocg, translator: live.game.translator, codes: live.codes })
  }

  private async live(id: string): Promise<Live> {
    const found = this.games.get(id)
    if (found) return found
    const file = this.sessions.export(id)
    if (!file.duel) throw new SessionError(409, `session ${id} isn't a game on the rules engine`)
    const ocg = await this.ocg()
    const game = new OcgGame(ocg, this.setup(file), !!file.duel.shuffled)
    if (this.games.has(id)) return this.games.get(id)!
    const moves: number[] = []
    const { bots = [], bot, claude, lesson, shuffled } = file.duel
    const last = game.replay(file.duel.responses.map(decodeResponse), (prompt, response, i) => {
      const p = playerOf(prompt.responsePlayer())
      if (!bots.includes(p) && p !== claude && startsMove(prompt, response)) moves.push(i)
    })
    // The bot's randomness continues from a fresh seed; its past answers are
    // in the log.
    const live = this.track(id, game, ocg, (file.seed ?? 0) + file.duel.responses.length, { bots, bot, claude, lesson, shuffled: !!shuffled })
    live.moves = moves
    if (file.duel.forfeit) game.duel.surrender(file.duel.forfeit)
    else if (last.prompt && last.waitingFor && !live.bots.includes(last.waitingFor)) {
      const q = this.ask(live, last)
      if ('prompt' in q) live.asked = q
    }
    this.onChange?.(id)
    return live
  }

  // The players Claude answers for: its side of a game, or the ones it holds
  // in a lesson.
  private held(id: string, live: Live): Player[] {
    return this.claudeHolds?.(id) ?? (live.claude ? [live.claude] : [])
  }

  private track(id: string, game: OcgGame, ocg: Ocg, seed: number, seats: Seats): Live {
    const codes = [...new Set(Object.values(game.state.cards).flatMap((c) => (c.cardId === undefined ? [] : [c.cardId])))]
    // A game of the trained bot's starts a fresh conversation with it: after
    // a take-back or a restart it has the table, but not its memory of the duel.
    this.hangUp(id)
    const { agent } = this
    const agents = seats.bot === 'agent' && agent ? Object.fromEntries(seats.bots.map((p) => [p, new AgentBot(agent.url, agent.codes)])) : undefined
    const live: Live = { ...seats, game, ocg, rng: seededRng(seed), codes, moves: [], ...(agents && { agents }) }
    this.games.set(id, live)
    return live
  }

  private hangUp(id: string) {
    for (const a of Object.values(this.games.get(id)?.agents ?? {})) void a.close()
  }

  // What the trained bot couldn't answer in a game (the random bot did).
  agentMisses(id: string): string[] {
    return Object.values(this.games.get(id)?.agents ?? {}).flatMap((a) => a.missed)
  }

  // The game's setup, without its steps: translation starts from there.
  private setup(file: ScenarioFile) {
    const r = resolveScenario({ ...file, steps: [], duel: undefined }, this.ctx())
    if (!r.ok) throw new SessionError(422, "the game's decks don't load", r.errors)
    return r.scenario
  }
}

// A chance to respond when nothing has happened to respond to (a new phase,
// say) is passed for you, as most clients do. Anything on the chain, or a
// summon, attack or activation just now, and you're asked.
function quietChance(p: Progress, state: BoardState): boolean {
  const m = p.prompt
  if (!(m instanceof M.YGOProMsgSelectChain) || m.chains.some((c) => c.forced) || state.chain.length) return false
  const loud = new Set(['activate', 'normalSummon', 'tributeSummon', 'specialSummon', 'attack'])
  return !p.steps.some((s) => s.intent && loud.has(s.intent.type))
}

// An answer that begins a move: a choice in the Main or Battle Phase, or a
// response that isn't a pass.
function startsMove(prompt: PromptMsg | undefined, response: Uint8Array): boolean {
  if (prompt instanceof M.YGOProMsgSelectIdleCmd || prompt instanceof M.YGOProMsgSelectBattleCmd) return true
  if (!(prompt instanceof M.YGOProMsgSelectChain)) return false
  const pass = prompt.defaultResponse()
  return !!pass && encodeResponse(response) !== encodeResponse(pass)
}

// Every card a setup places for player, materials included.
function placedNames(setup: Setup, player: Player): string[] {
  const names = (e: string | { name: string; materials?: string[] } | null) => (!e ? [] : typeof e === 'string' ? [e] : [e.name, ...(e.materials ?? [])])
  return [
    ...Object.values(setup[player] ?? {}).flatMap((zone) => zone.flatMap(names)),
    ...(setup.extraMonster ?? []).flatMap((e) => (e?.player === player ? names(e) : [])),
  ]
}
