// Games on the rules engine. Each is a session whose steps are translated from
// the core, plus the answers given to the core so far (saved in the session
// file as duel.responses). After a restart a game is rebuilt by replaying
// those answers the first time it's needed.
import type { Player, Step } from '../src/engine'
import type { GameView } from '../src/api/game'
import { resolveScenario, type ResolveContext } from '../src/scenarios/resolve'
import type { ScenarioFile } from '../src/scenarios/schema'
import { botResponse, seededRng, type Rng } from './ocg/bot'
import { decodeResponse, encodeResponse } from './ocg/duel'
import { OcgGame, type Progress } from './ocg/game'
import { loadOcg, ocgDataDir, type Ocg } from './ocg/lib'
import { SessionError, type SessionService, type SessionView } from './sessions'

export type CreateGameOptions = { deck: string; opponentDeck?: string; seed?: number; bots?: Player[]; title?: string }

// How long each bot step stays on screen before the next.
export const BOT_STEP_MS = 700

type Live = { game: OcgGame; bots: Player[]; rng: Rng; codes: number[] }

export class GameService {
  private games = new Map<string, Live>()
  private sessions: SessionService
  private ctx: () => ResolveContext
  private ocg: () => Promise<Ocg>

  constructor(sessions: SessionService, ctx: () => ResolveContext, ocg: () => Promise<Ocg> = () => loadOcg(ocgDataDir())) {
    this.sessions = sessions
    this.ctx = ctx
    this.ocg = ocg
    sessions.gameView = (id) => this.view(id)
  }

  async create(opts: CreateGameOptions): Promise<SessionView> {
    const ocg = await this.ocg()
    const bots = opts.bots ?? ['p2']
    const { id } = this.sessions.create({ deck: opts.deck, opponentDeck: opts.opponentDeck, seed: opts.seed, title: opts.title ?? `Game: ${opts.deck} vs ${opts.opponentDeck ?? opts.deck}` })
    const file = this.sessions.export(id)
    let game: OcgGame
    try {
      game = new OcgGame(ocg, this.setup(file))
    } catch (e) {
      throw new SessionError(422, (e as Error).message)
    }
    const live = this.track(id, game, bots, file.seed!)
    return this.advance(id, live, game.start())
  }

  // Answer the pending prompt for a player (not a bot).
  async respond(id: string, player: Player, response: Uint8Array): Promise<SessionView> {
    const live = await this.live(id)
    if (live.game.waitingFor !== player) throw new SessionError(409, `the rules engine isn't waiting for ${player}`)
    const p = live.game.respond(response)
    if (p.retried) throw new SessionError(422, 'the rules engine rejected that answer')
    return this.advance(id, live, p)
  }

  async get(id: string): Promise<OcgGame> {
    return (await this.live(id)).game
  }

  private view(id: string): GameView | undefined {
    const live = this.games.get(id)
    if (!live) {
      // Not rebuilt yet: start that, and report what the file knows.
      void this.live(id).then(() => this.sessions.touch(id)).catch(() => {})
      return { bots: this.sessions.export(id).duel?.bots ?? [] }
    }
    const { game, bots } = live
    const winner = game.duel.result
    return { bots, ...(game.waitingFor && { waitingFor: game.waitingFor }), ...(winner && { winner }) }
  }

  // Save what happened, then answer for bots until a person has to (or the
  // duel ends). Bot steps are paced so they can be watched.
  private advance(id: string, live: Live, first: Progress): SessionView {
    const steps: Step[] = []
    const paced = new Set<Step>()
    let p = first
    let actor: Player | undefined
    let attempt = 0
    for (;;) {
      for (const s of p.steps) {
        steps.push(s)
        if (actor && live.bots.includes(actor)) paced.add(s)
      }
      if (!p.prompt || !p.waitingFor || !live.bots.includes(p.waitingFor)) break
      if (attempt > 50) throw new Error(`the bot is stuck on ${p.prompt.constructor.name}`)
      attempt = p.retried ? attempt + 1 : 0
      actor = p.waitingFor
      p = live.game.respond(botResponse(p.prompt, live.rng, attempt, live.codes))
    }
    const duel = { responses: live.game.duel.responses.map(encodeResponse), bots: live.bots }
    return this.sessions.appendGame(id, steps, duel, (s) => (paced.has(s) ? { afterMs: BOT_STEP_MS } : undefined))
  }

  private async live(id: string): Promise<Live> {
    const found = this.games.get(id)
    if (found) return found
    const file = this.sessions.export(id)
    if (!file.duel) throw new SessionError(409, `session ${id} isn't a game on the rules engine`)
    const game = new OcgGame(await this.ocg(), this.setup(file))
    if (this.games.has(id)) return this.games.get(id)!
    game.replay(file.duel.responses.map(decodeResponse))
    // The bot's randomness continues from a fresh seed; its past answers are
    // in the log.
    return this.track(id, game, file.duel.bots ?? [], (file.seed ?? 0) + file.duel.responses.length)
  }

  private track(id: string, game: OcgGame, bots: Player[], seed: number): Live {
    const codes = [...new Set(Object.values(game.state.cards).flatMap((c) => (c.cardId === undefined ? [] : [c.cardId])))]
    const live = { game, bots, rng: seededRng(seed), codes }
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
