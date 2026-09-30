// Games on the rules engine. Each is a session whose steps are translated from
// the core, plus the answers given to the core so far (saved in the session
// file as duel.responses). After a restart a game is rebuilt by replaying
// those answers the first time it's needed.
import type { BoardState, Player, Step } from '../src/engine'
import type { GameAnswer, GameView, ModelChoice } from '../src/api/game'
import { resolveScenario, type ResolveContext } from '../src/scenarios/resolve'
import type { DeckFile, ScenarioFile } from '../src/scenarios/schema'
import { botResponse, seededRng, type Rng } from './ocg/bot'
import { decodeResponse, encodeResponse } from './ocg/duel'
import { OcgGame, type Progress } from './ocg/game'
import { loadOcg, M, ocgDataDir, type Ocg } from './ocg/lib'
import { question, type Question } from './ocg/prompt'
import { SessionError, type SessionService, type SessionView } from './sessions'

// claude: the player Claude answers for, with its model and coach setting.
export type CreateGameOptions = {
  deck: string
  opponentDeck?: string
  seed?: number
  bots?: Player[]
  claude?: Player
  model?: ModelChoice
  coach?: boolean
  title?: string
}

// How long each bot (or Claude) step stays on screen before the next.
export const BOT_STEP_MS = 700

type Asked = Extract<Question, { prompt: unknown }>
type Live = { game: OcgGame; ocg: Ocg; bots: Player[]; claude?: Player; shuffled: boolean; rng: Rng; codes: number[]; asked?: Asked }

export class GameService {
  private games = new Map<string, Live>()
  private sessions: SessionService
  private ctx: () => ResolveContext
  private ocg: () => Promise<Ocg>
  // Called when a game is created, before its first move, and whenever it
  // moves on or asks something (Claude listens).
  onCreate?: (id: string, opts: CreateGameOptions) => void
  onChange?: (id: string) => void
  // Claude's part of a game's view (set by ClaudeService).
  claudeView?: (id: string) => GameView['claude']

  constructor(sessions: SessionService, ctx: () => ResolveContext, ocg: () => Promise<Ocg> = () => loadOcg(ocgDataDir())) {
    this.sessions = sessions
    this.ctx = ctx
    this.ocg = ocg
    sessions.gameView = (id) => this.view(id)
    sessions.onRemove.push((id) => this.games.delete(id))
  }

  async create(opts: CreateGameOptions): Promise<SessionView> {
    const ocg = await this.ocg()
    const bots = opts.claude ? [] : (opts.bots ?? ['p2'])
    const { id } = this.sessions.create({
      deck: opts.deck,
      opponentDeck: opts.opponentDeck,
      seed: opts.seed,
      title: opts.title ?? `Game: ${opts.deck} vs ${opts.opponentDeck ?? opts.deck}`,
      ...(bots.includes('p2') && { opponentName: 'Bot' }),
      // Claude plays as the character its deck belongs to, if it has one.
      ...(opts.claude === 'p2' && { opponentName: (this.ctx().decks[opts.opponentDeck ?? opts.deck] as DeckFile | undefined)?.character?.name ?? 'Claude' }),
    })
    const file = this.sessions.export(id)
    let game: OcgGame
    try {
      game = new OcgGame(ocg, this.setup(file))
    } catch (e) {
      throw new SessionError(422, (e as Error).message)
    }
    const live = this.track(id, game, ocg, bots, file.seed!, opts.claude, true)
    this.onCreate?.(id, opts)
    return this.advance(id, live, game.start())
  }

  // A person's answer to the open question: the options they picked.
  async answer(id: string, player: Player, a: GameAnswer): Promise<SessionView> {
    const live = await this.live(id)
    const { asked } = live
    if (!asked || asked.prompt.player !== player) throw new SessionError(409, `nothing is being asked of ${player}`)
    const { prompt } = asked
    if (a.id !== prompt.id) throw new SessionError(409, `question ${a.id} isn't open (${prompt.id} is)`)
    const { min, max, options } = prompt
    if (a.choices.length < min || a.choices.length > max) throw new SessionError(400, min === max ? `pick ${min}` : `pick ${min}-${max}`)
    if (new Set(a.choices).size !== a.choices.length || a.choices.some((c) => c >= options.length))
      throw new SessionError(400, `choices must be distinct, 0-${options.length - 1}`)
    const p = live.game.respond(asked.answer(a.choices))
    if (p.retried) throw new SessionError(422, "the rules engine didn't accept that")
    return this.advance(id, live, p)
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
    const prompt = asked && asked.prompt.player !== live.claude ? asked.prompt : undefined
    return { bots, ...(game.waitingFor && { waitingFor: game.waitingFor }), ...(winner && { winner }), ...(prompt && { prompt }), ...(claude && { claude }) }
  }

  // Save what happened, then answer for bots, and for people where there's
  // nothing to decide, until a person has a real question (or the duel ends).
  // Bot steps are paced so they can be watched.
  private advance(id: string, live: Live, first: Progress): SessionView {
    const steps: Step[] = []
    const paced = new Set<Step>()
    let p = first
    let actor: Player | undefined
    let attempt = 0
    live.asked = undefined
    for (;;) {
      for (const s of p.steps) {
        steps.push(s)
        if (actor && (live.bots.includes(actor) || actor === live.claude)) paced.add(s)
      }
      if (!p.prompt || !p.waitingFor) break
      if (attempt > 50) throw new Error(`stuck on ${p.prompt.constructor.name}`)
      attempt = p.retried ? attempt + 1 : 0
      actor = p.waitingFor
      let response: Uint8Array
      if (live.bots.includes(actor)) response = botResponse(p.prompt, live.rng, attempt, live.codes)
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
    const duel = {
      responses: live.game.duel.responses.map(encodeResponse),
      bots: live.bots,
      ...(live.claude && { claude: live.claude }),
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
    return question(p.prompt!, { id: live.game.duel.responses.length, hint: p.hint, ocg: live.ocg, translator: live.game.translator, codes: live.codes })
  }

  private async live(id: string): Promise<Live> {
    const found = this.games.get(id)
    if (found) return found
    const file = this.sessions.export(id)
    if (!file.duel) throw new SessionError(409, `session ${id} isn't a game on the rules engine`)
    const ocg = await this.ocg()
    const game = new OcgGame(ocg, this.setup(file), !!file.duel.shuffled)
    if (this.games.has(id)) return this.games.get(id)!
    const last = game.replay(file.duel.responses.map(decodeResponse))
    // The bot's randomness continues from a fresh seed; its past answers are
    // in the log.
    const live = this.track(id, game, ocg, file.duel.bots ?? [], (file.seed ?? 0) + file.duel.responses.length, file.duel.claude, !!file.duel.shuffled)
    if (last.prompt && last.waitingFor && !live.bots.includes(last.waitingFor)) {
      const q = this.ask(live, last)
      if ('prompt' in q) live.asked = q
    }
    this.onChange?.(id)
    return live
  }

  private track(id: string, game: OcgGame, ocg: Ocg, bots: Player[], seed: number, claude: Player | undefined, shuffled: boolean): Live {
    const codes = [...new Set(Object.values(game.state.cards).flatMap((c) => (c.cardId === undefined ? [] : [c.cardId])))]
    const live = { game, ocg, bots, claude, shuffled, rng: seededRng(seed), codes }
    this.games.set(id, live)
    return live
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
