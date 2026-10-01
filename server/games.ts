// Games on the rules engine. Each is a session whose steps are translated from
// the core, plus the answers given to the core so far (saved in the session
// file as duel.responses). After a restart a game is rebuilt by replaying
// those answers the first time it's needed.
import { PLAYERS, type BoardState, type Player, type Step } from '../src/engine'
import type { GameAnswer, GamePrompt, GameView, ModelChoice, Respond, Skipped } from '../src/api/game'
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
// watch: in a bot game, Claude sits beside you as a coach (it sees your side,
// answers nothing). knowsDeck: that coach is given the bot's decklist (default true).
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
  watch?: boolean
  knowsDeck?: boolean
  respond?: Respond
  title?: string
}

// How long each bot (or Claude) step stays on screen before the next.
export const BOT_STEP_MS = 700
// Moves a person can take back in one game.
export const UNDOS = 3

const TYPE_MONSTER = 0x1

type Asked = Extract<Question, { prompt: unknown }>
export type BotKind = 'random' | 'agent'
// respond: when the person is asked to chain. skipped: chances passed for
// them. forced: an answer index where they asked for a passed chance back.
type Seats = { bots: Player[]; bot?: BotKind; claude?: Player; lesson?: boolean; shuffled: boolean; respond?: Respond; skipped?: Skipped[]; forced?: number }
// What Claude makes of a chance to respond: stop for it or not, and why.
export type ChainAdvice = { stop: boolean; why: string }
// moves: for each move a person began, how many answers had been given.
// agents: the trained bot's side of the conversation, for each player it plays.
type Live = Seats & { deciding?: boolean; game: OcgGame; ocg: Ocg; rng: Rng; codes: number[]; asked?: Asked; moves: number[]; answered?: number; agents?: Partial<Record<Player, AgentBot>> }

// A line tried on a copy of the game: what happened, the table after it, how
// many of the picks were played, and why it stopped (the next question for the
// player, a decision of the other side's, a pick the engine refused, the end).
export type Trial = { steps: Step[]; state: BoardState; played: number; next?: GamePrompt; theirs?: boolean; refused?: boolean; winner?: Player }

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
  // Claude's view of a chance to respond, for the levels that ask it.
  adviser?: (id: string, player: Player, prompt: GamePrompt) => Promise<ChainAdvice | undefined>

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

  // Whether the trained bot's service answers.
  async agentUp(): Promise<boolean> {
    if (!this.agent) return false
    return fetch(this.agent.url, { signal: AbortSignal.timeout(1500) }).then(
      (r) => r.ok,
      () => false,
    )
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
      if (!(await this.agentUp())) throw new SessionError(501, "the trained bot isn't running (docker compose up -d ygo-agent)")
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
    const live = this.track(id, game, ocg, file.seed!, { bots, bot, claude: opts.claude, lesson: opts.lesson, shuffled: true, respond: opts.respond })
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
    // In a lesson only the person's own moves count: Claude's aren't theirs to take back.
    if (!live.bots.includes(player) && player !== live.claude && (person || !live.lesson) && startsMove(before, response)) live.moves.push(at)
    if (person) live.answered = at
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
    const { bots, bot, claude, lesson, shuffled, respond } = old
    const live = this.track(id, game, old.ocg, file.seed ?? 0, { bots, bot, claude, lesson, shuffled, respond })
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
      if ((duel.undone ?? 0) >= UNDOS) throw new SessionError(409, `all ${UNDOS} take-backs are used`)
      throw new SessionError(409, old.moves.length ? "a move can be taken back when it's your move" : 'no move of yours to take back')
    }
    this.rewind(id, old, old.moves.at(-1)!, old.lesson ? {} : { undone: (duel.undone ?? 0) + 1 })
    this.onUndo?.(id)
    this.onChange?.(id)
    return this.sessions.get(id)
  }

  // Go back to a chance to respond that was passed for the person, and ask
  // them after all. What came after it is dropped, as with a take-back, but
  // it doesn't use one up.
  async reopen(id: string, at: number): Promise<SessionView> {
    const old = await this.live(id)
    if (!old.skipped?.some((s) => s.at === at)) throw new SessionError(409, 'no passed chance to respond there')
    if (old.asked && this.held(id, old).includes(old.asked.prompt.player)) throw new SessionError(409, "wait until it's your move")
    this.rewind(id, old, at, { asked: at })
    this.onUndo?.(id)
    this.onChange?.(id)
    return this.sessions.get(id)
  }

  // Change when the person is asked to respond, from here on.
  async setRespond(id: string, respond: Respond): Promise<SessionView> {
    const live = await this.live(id)
    live.respond = respond
    this.sessions.appendGame(id, [], { ...this.sessions.export(id).duel!, respond })
    return this.sessions.get(id)
  }

  // Replay the game up to answer `to` and ask the question open there.
  private rewind(id: string, old: Live, to: number, change: { undone?: number; asked?: number }) {
    const file = this.sessions.export(id)
    const duel = file.duel!
    const game = new OcgGame(old.ocg, this.setup(file), !!duel.shuffled)
    const last = game.replay(duel.responses.slice(0, to).map(decodeResponse))
    const { bots, bot, claude, lesson, shuffled, respond } = old
    const skipped = old.skipped?.filter((s) => s.at < to)
    const live = this.track(id, game, old.ocg, (file.seed ?? 0) + to, { bots, bot, claude, lesson, shuffled, respond, skipped, forced: change.asked })
    live.moves = old.moves.filter((m) => m < to)
    const q = last.prompt && this.ask(live, last)
    if (q && 'prompt' in q) live.asked = q
    this.sessions.rewindGame(id, last.steps, { ...duel, responses: duel.responses.slice(0, to), winner: undefined, forfeit: undefined, endedAt: undefined, skipped, asked: undefined, ...change })
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
    this.sessions.appendGame(id, [], { ...this.sessions.export(id).duel!, forfeit: player, winner: live.game.duel.result!.player, endedAt: Date.now() })
    this.onForfeit?.(id)
    this.onChange?.(id)
    return this.sessions.get(id)
  }

  // Take-backs left, when there's a move to take back now: at a person's
  // question, or once the game is over. A lesson doesn't count them.
  private undos(id: string, live: Live): number | undefined {
    const left = UNDOS - (this.sessions.export(id).duel?.undone ?? 0)
    const yours = live.asked && !this.held(id, live).includes(live.asked.prompt.player)
    return (live.lesson || left > 0) && live.moves.length && (yours || live.game.duel.result) ? (live.lesson ? UNDOS : left) : undefined
  }

  // What would happen if player answered their open question, and the ones
  // after it, with these picks: played on a copy, so the game doesn't move.
  // Wherever the other side could respond they pass; the copy stops at any
  // other decision of theirs, or when the picks run out.
  async trial(id: string, player: Player, picks: number[][]): Promise<Trial> {
    const live = await this.live(id)
    const file = this.sessions.export(id)
    const game = new OcgGame(live.ocg, this.setup(file), !!file.duel!.shuffled)
    let p = game.replay(file.duel!.responses.map(decodeResponse))
    const steps: Step[] = []
    const copy = { game, ocg: live.ocg, codes: live.codes }
    const done = (rest: Omit<Trial, 'steps' | 'state' | 'played'>): Trial => ({ steps, state: game.state, played, ...rest })
    let played = 0
    for (let i = 0; i < 500; i++) {
      if (game.duel.result) return done({ winner: game.duel.result.player })
      if (!p.prompt || !p.waitingFor) return done({})
      let response: Uint8Array | undefined
      let picked = false
      if (p.waitingFor !== player) {
        if (!(p.prompt instanceof M.YGOProMsgSelectChain) || p.prompt.chains.some((c) => c.forced)) return done({ theirs: true })
        response = p.prompt.defaultResponse()
      } else if (quietChance(p, game.state)) response = (p.prompt as InstanceType<typeof M.YGOProMsgSelectChain>).defaultResponse()
      else {
        const q = this.ask(copy, p)
        if ('prompt' in q) {
          const pick = picks[played]
          const { min, max, options } = q.prompt
          if (!pick) return done({ next: q.prompt })
          if (pick.length < min || pick.length > max || new Set(pick).size !== pick.length || pick.some((c) => c >= options.length))
            return done({ next: q.prompt, refused: true })
          response = q.answer(pick)
          picked = true
        } else response = q.auto
      }
      if (!response) return done({ theirs: true })
      p = game.respond(response)
      if (p.retried) return done({ refused: true })
      if (picked) played++
      steps.push(...p.steps)
    }
    return done({})
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
    const { startedAt, endedAt } = this.sessions.export(id).duel ?? {}
    // Passed chances are shown until the person has answered something since.
    const fresh = (live.skipped ?? []).filter((s) => s.at > (live.answered ?? -1)).slice(-3)
    const claude = this.claudeView?.(id)
    // Claude's questions stay on the server; the browser only needs yours.
    const prompt = asked && !this.held(id, live).includes(asked.prompt.player) ? asked.prompt : undefined
    const undos = this.undos(id, live)
    const person = !live.lesson && PLAYERS.some((p) => !bots.includes(p) && p !== live.claude)
    return { bots, ...(bots.length && { bot: live.bot ?? ('random' as const) }), ...(game.waitingFor && { waitingFor: game.waitingFor }), ...(winner && { winner }), ...(startedAt && { startedAt }), ...(endedAt && { endedAt }), ...(prompt && { prompt }), ...(claude && { claude }), ...(undos && { undos }), ...(person && { respond: live.respond ?? ('auto' as const) }), ...(person && fresh.length && { skipped: fresh }), ...(live.deciding && { deciding: true }) }
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
    live.deciding = false
    for (;;) {
      for (const s of p.steps) {
        steps.push(s)
        if (actor && (live.bots.includes(actor) || this.held(id, live).includes(actor))) paced.add(s)
      }
      if (!p.prompt || !p.waitingFor) break
      if (attempt > 50) throw new Error(`stuck on ${p.prompt.constructor.name}`)
      attempt = p.retried ? attempt + 1 : 0
      const cause = actor
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
      else if (quietChance(p, live.game.state) && (live.respond ?? 'auto') !== 'all') response = (p.prompt as InstanceType<typeof M.YGOProMsgSelectChain>).defaultResponse()
      else {
        const q = this.ask(live, p)
        if ('prompt' in q) {
          const passed = await this.chance(id, live, p, q, cause)
          if (live.game.duel.result) break
          if (!passed) {
            live.asked = q
            break
          }
          live.skipped = [...(live.skipped ?? []), passed]
          response = (p.prompt as InstanceType<typeof M.YGOProMsgSelectChain>).defaultResponse()
        } else response = q.auto
      }
      p = live.game.respond(response)
    }
    const before = this.sessions.export(id).duel
    const { undone, forfeit, asked: reopened } = before ?? {}
    // The clock starts with a game's first answer; games from before it have none.
    const startedAt = before?.startedAt ?? (before?.responses.length ? undefined : Date.now())
    const endedAt = live.game.duel.result ? (before?.endedAt ?? Date.now()) : undefined
    const duel = {
      responses: live.game.duel.responses.map(encodeResponse),
      ...(undone && { undone }),
      ...(forfeit && { forfeit }),
      bots: live.bots,
      ...(live.bot && { bot: live.bot }),
      ...(live.claude && { claude: live.claude }),
      ...(live.lesson && { lesson: true, yours: live.moves }),
      ...(live.shuffled && { shuffled: true }),
      ...(live.respond && { respond: live.respond }),
      ...(live.skipped?.length && { skipped: live.skipped.slice(-20) }),
      ...(reopened !== undefined && live.asked?.prompt.id === reopened && { asked: reopened }),
      ...(live.game.duel.result && { winner: live.game.duel.result.player }),
      ...(startedAt && { startedAt }),
      ...(endedAt && { endedAt }),
    }
    const view = this.sessions.appendGame(id, steps, duel, (s) => (paced.has(s) ? { afterMs: BOT_STEP_MS } : undefined))
    this.onChange?.(id)
    return view
  }

  // A chance for a person to respond: passed for them (returned, to be
  // recorded), or theirs to answer. Anything forced and a chance they asked
  // to have back are always theirs.
  private async chance(id: string, live: Live, p: Progress, q: Asked, cause?: Player): Promise<Skipped | undefined> {
    const m = p.prompt
    const { prompt } = q
    const level = live.respond ?? 'auto'
    if (!(m instanceof M.YGOProMsgSelectChain) || m.chains.some((c) => c.forced)) return undefined
    if (level === 'all' || live.lesson || live.forced === prompt.id || this.held(id, live).includes(prompt.player)) return undefined
    const { state } = live.game
    const names = [...new Set(prompt.options.flatMap((o) => (o.card ? [live.ocg.card(state.cards[o.card]?.cardId ?? 0)?.name ?? 'a card'] : [])))]
    const top = state.chain.at(-1)
    const to = top && live.ocg.card(state.cards[top.card]?.cardId ?? 0)?.name
    const skip = (by: Skipped['by'], why?: string): Skipped => ({ at: prompt.id, cards: names, ...(to && { to }), by, ...(why && { why }), turn: state.turn })
    // The engine counts the responses that answer what just happened (and
    // your trigger effects); the rest are cards that could be used at any time.
    // After your own summon or activation, with nothing of theirs on the chain, those aren't asked.
    if (m.specialCount === 0 && (top ? top.player === prompt.player : cause === prompt.player)) return skip('rules', 'it followed your own move')
    // Chaining a Spell or Trap of your own onto your own card is rarely meant.
    // Monsters are still asked: theirs may be a trigger effect, lost if passed.
    const spellOrTrap = (code: number) => !((live.ocg.card(code)?.type ?? TYPE_MONSTER) & TYPE_MONSTER)
    if (top?.player === prompt.player && m.chains.every((c) => spellOrTrap(c.code))) return skip('rules', 'it would respond to your own card')
    if (level === 'auto' || !this.adviser) return undefined
    live.deciding = true
    this.sessions.touch(id)
    const advice = await this.adviser(id, prompt.player, prompt).catch(() => undefined)
    live.deciding = false
    if (!advice) return undefined
    if (level === 'claude' && !advice.stop) return skip('claude', advice.why)
    prompt.advice = `${advice.stop ? 'Worth responding' : 'Claude would pass'}: ${advice.why}`
    return undefined
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

  private ask(live: Pick<Live, 'game' | 'ocg' | 'codes'>, p: Progress): Question {
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
    const p1Moves: number[] = []
    let answered: number | undefined
    const { bots = [], bot, claude, lesson, shuffled, respond, skipped, asked: forced, yours } = file.duel
    const last = game.replay(file.duel.responses.map(decodeResponse), (prompt, response, i) => {
      const p = playerOf(prompt.responsePlayer())
      if (!lesson && !bots.includes(p) && p !== claude && startsMove(prompt, response)) moves.push(i)
      if (lesson && p === 'p1' && startsMove(prompt, response)) p1Moves.push(i)
      if (!bots.includes(p) && p !== claude && !skipped?.some((s) => s.at === i)) answered = i
    })
    // The bot's randomness continues from a fresh seed; its past answers are
    // in the log.
    const live = this.track(id, game, ocg, (file.seed ?? 0) + file.duel.responses.length, { bots, bot, claude, lesson, shuffled: !!shuffled, respond, skipped, forced })
    // A lesson records which moves were the person's. One from before it did
    // counts p1's, whoever made them.
    live.moves = lesson ? (yours ?? p1Moves).filter((m) => m < file.duel!.responses.length) : moves
    live.answered = answered
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

  // The trained bot's latest prediction in a game, for each player it plays.
  botThinking(id: string): AgentBot['last'][] {
    return Object.values(this.games.get(id)?.agents ?? {}).flatMap((a) => (a.last ? [a.last] : []))
  }

  // The trained bot's view of player's open question: its estimate of their
  // chance to win, and which option it would pick (when it's a pick of one),
  // with how sure it is. Undefined when it can't say: it isn't set up, the
  // deck has cards it doesn't know, or nothing is being asked of them.
  async evaluate(id: string, player: Player): Promise<{ winRate?: number; pick?: number; confidence?: number } | undefined> {
    const live = await this.live(id)
    const pending = live.game.duel.pending
    await this.loadAgent()
    const deck = this.sessions.export(id).players?.[player].deck
    if (!this.agent || !pending || live.game.waitingFor !== player || !deck || !this.agentDecks()!.includes(deck)) return undefined
    const bot = new AgentBot(this.agent.url, this.agent.codes)
    const { state } = live.game
    try {
      const { winRate, response, confidence } = await bot.rate(pending, { ocg: live.ocg, duel: live.game.duel, me: player, turn: state.turn, phase: state.phase, active: state.activePlayer })
      const q = live.asked
      // Its answer is the engine's bytes: the option that gives the same ones.
      const same = (i: number) => {
        try {
          return Buffer.from(q!.answer([i])).equals(Buffer.from(response!))
        } catch {
          return false
        }
      }
      const pick = q && response && q.prompt.max === 1 ? q.prompt.options.findIndex((_, i) => same(i)) : -1
      return { winRate, ...(pick >= 0 && { pick, confidence }) }
    } finally {
      void bot.close()
    }
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
  if (!(m instanceof M.YGOProMsgSelectChain) || m.specialCount > 0 || m.chains.some((c) => c.forced) || state.chain.length) return false
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
