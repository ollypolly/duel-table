// One duel on the rules core. It's the seed, both decks and the answers given
// so far, so replaying the answers rebuilds it exactly (after a restart, say).
import { LOC, M, POS, type Msg, type Ocg, type PromptMsg } from './lib'
import type { Player } from '../../src/engine'
import { seededRng } from './bot'

export type DuelDecks = Record<Player, { main: number[]; extra: number[] }>
// shuffle: shuffle each Deck from the seed first. The core doesn't; in
// YGOPro the host does. Games saved before this replay unshuffled.
export type DuelSetup = { seed: number; decks: DuelDecks; shuffle?: boolean }

export const playerOf = (n: number): Player => (n === 0 ? 'p1' : 'p2')
export const indexOf = (p: Player) => (p === 'p1' ? 0 : 1)

export type RunResult = {
  messages: Msg[] // everything that happened since the last answer, in full view
  prompt?: PromptMsg // what the core is waiting for, if the duel isn't over
  winner?: { player: Player; reason: number }
  retried?: boolean // the last answer was invalid and was dropped
}

const MAX_BATCHES = 10_000 // a duel stuck processing without asking anything

export class OcgDuel {
  readonly responses: Uint8Array[] = []
  private duel
  private prompt?: PromptMsg
  private winner?: RunResult['winner']

  constructor(ocg: Ocg, setup: DuelSetup) {
    this.duel = ocg.wrapper.createDuel(setup.seed)
    const rng = seededRng(setup.seed ^ 0x5eed)
    for (const p of ['p1', 'p2'] as const) {
      const player = indexOf(p)
      const main = [...setup.decks[p].main]
      if (setup.shuffle) {
        for (let i = main.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1))
          ;[main[i], main[j]] = [main[j], main[i]]
        }
      }
      this.duel.setPlayerInfo({ player, lp: 8000, startHand: 5, drawCount: 1 })
      const add = (code: number, location: number) => this.duel.newCard({ code, owner: player, player, location, sequence: 0, position: POS.faceDownDef })
      for (const code of main) add(code, LOC.deck)
      for (const code of setup.decks[p].extra) add(code, LOC.extra)
    }
    this.duel.startDuel({ rule: 5 }) // Master Rule 2020
  }

  get pending() {
    return this.prompt
  }

  get result() {
    return this.winner
  }

  // Run until the core needs an answer or the duel ends.
  run(): RunResult {
    const messages: Msg[] = []
    for (let i = 0; i < MAX_BATCHES && !this.winner; i++) {
      const res = this.duel.process()
      for (const m of res.messages ?? (res.message ? [res.message] : [])) {
        if (m instanceof M.YGOProMsgRetry) {
          this.responses.pop()
          return { messages, prompt: this.prompt, retried: true }
        }
        messages.push(m)
        if (m instanceof M.YGOProMsgWin) this.winner = { player: playerOf(m.player), reason: m.type }
        else if (m instanceof M.YGOProMsgResponseBase) {
          this.prompt = m
          return { messages, prompt: m }
        }
      }
      if (res.status === 2) break
    }
    this.prompt = undefined
    return { messages, winner: this.winner }
  }

  // Answer the pending prompt and run on. An invalid answer comes back with
  // retried set and the same prompt still pending.
  respond(response: Uint8Array): RunResult {
    if (!this.prompt) throw new Error('the duel is not waiting for an answer')
    this.responses.push(response)
    this.duel.setResponse(response)
    return this.run()
  }

  // Full-view queries, for syncing stats and checking the translation.
  fieldCards(player: Player, location: number, flags: number) {
    return this.duel.queryFieldCard({ player: indexOf(player), location, queryFlag: flags }).cards ?? []
  }

  card(player: Player, location: number, sequence: number, flags: number) {
    return this.duel.queryCard({ player: indexOf(player), location, sequence, queryFlag: flags }).card
  }

  lp(player: Player): number {
    return this.duel.queryFieldInfo().field.players[indexOf(player)].lp
  }

  end() {
    this.duel.endDuel()
  }
}

export const encodeResponse = (r: Uint8Array) => Buffer.from(r).toString('base64')
export const decodeResponse = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))
