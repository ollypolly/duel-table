// A duel on the rules core together with its translation into our steps.
// Built from a resolved deck scenario: the pools give the core its decks and
// the setup state is where translation starts.
import type { BoardState, Player, Step } from '../../src/engine'
import type { ResolvedScenario } from '../../src/scenarios/resolve'
import { OcgDuel, playerOf, type DuelDecks, type RunResult } from './duel'
import type { Ocg, PromptMsg } from './lib'
import { selectHint } from './prompt'
import { Translator } from './translate'

// hint is the core's "select a..." text for the prompt, if it sent one.
export type Progress = { steps: Step[]; prompt?: PromptMsg; hint?: number; waitingFor?: Player; winner?: RunResult['winner']; retried?: boolean }

export class OcgGame {
  readonly duel: OcgDuel
  readonly translator: Translator

  constructor(ocg: Ocg, scenario: ResolvedScenario) {
    const { setup } = scenario.game
    const decks = {} as DuelDecks
    for (const p of ['p1', 'p2'] as const) {
      const pool = setup.players[p].pool
      const missing = pool.filter((c) => c.cardId === undefined || !ocg.card(c.cardId))
      if (missing.length) throw new Error(`the rules engine doesn't know ${[...new Set(missing.map((c) => c.name))].join(', ')}`)
      decks[p] = { main: pool.filter((c) => !c.extra).map((c) => c.cardId!), extra: pool.filter((c) => c.extra).map((c) => c.cardId!) }
    }
    this.duel = new OcgDuel(ocg, { seed: setup.seed, decks })
    this.translator = new Translator(scenario.timeline[0].state, ocg, this.duel)
  }

  get state(): BoardState {
    return this.translator.state
  }

  get waitingFor(): Player | undefined {
    const p = this.duel.pending
    return p ? playerOf(p.responsePlayer()) : undefined
  }

  start(): Progress {
    return this.progress(this.duel.run())
  }

  respond(response: Uint8Array): Progress {
    const actor = this.waitingFor
    return this.progress(this.duel.respond(response), actor)
  }

  // Rebuild from saved answers. Returns every step, as start + respond would.
  replay(responses: Uint8Array[]): Progress {
    const all = this.start()
    for (const r of responses) {
      const next = this.respond(r)
      if (next.retried) throw new Error('a saved answer was rejected on replay')
      all.steps.push(...next.steps)
      Object.assign(all, { prompt: next.prompt, hint: next.hint, waitingFor: next.waitingFor, winner: next.winner })
    }
    return all
  }

  private progress(r: RunResult, actor?: Player): Progress {
    const steps = this.translator.feed(r.messages, actor)
    const hint = r.prompt && selectHint(r.messages, r.prompt.responsePlayer())
    return { steps, prompt: r.prompt, hint, waitingFor: this.waitingFor, winner: r.winner, ...(r.retried && { retried: true }) }
  }
}
