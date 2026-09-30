// One duel on the rules core. It's the seed, both players' cards and the
// answers given so far, so replaying the answers rebuilds it exactly (after a
// restart, say).
import { Core, LOC, M, POS, type Msg, type Ocg, type PromptMsg } from './lib'
import type { Player } from '../../src/engine'
import { seededRng } from './bot'

// A card as the core places it before the duel starts. Cards in piles go in
// the order given, so the last card into the Deck is its top; sequence only
// matters on the field, or for a material, where it's the Xyz Monster's zone.
export type Placed = { code: number; owner: Player; location: number; sequence: number; position: number }
// Either both decks, and each player draws 5, or a position (as EDOPro
// puzzles do): every card placed where it starts, Decks in the order given,
// no opening hands, and the first turn can attack.
// shuffle: shuffle each Deck from the seed first. The core doesn't; in
// YGOPro the host does. Games saved before this replay unshuffled.
export type DuelSetup = { seed: number } & (
  { decks: Record<Player, { main: number[]; extra: number[] }>; shuffle?: boolean } | { position: Record<Player, { lp: number; cards: Placed[] }> }
)

// Placed directly; monsters and their materials go in by script (addMonster).
const PLACE_ORDER: number[] = [LOC.deck, LOC.extra, LOC.hand, LOC.szone, LOC.grave, LOC.removed]

// How each Extra Deck (or Ritual) monster on the field counts as summoned.
const SUMMON_TYPES: [number, string][] = [
  [0x40, 'SUMMON_TYPE_FUSION'],
  [0x80, 'SUMMON_TYPE_RITUAL'],
  [0x2000, 'SUMMON_TYPE_SYNCHRO'],
  [0x800000, 'SUMMON_TYPE_XYZ'],
  [0x4000000, 'SUMMON_TYPE_LINK'],
]
let scriptsRun = 0

// A material is added to the zone of the Xyz Monster it goes under.
function addMonster(ocg: Ocg, c: Placed, player: number) {
  const add = `Debug.AddCard(${c.code},${indexOf(c.owner)},${player},LOCATION_MZONE,${c.sequence},${c.position},true)`
  if (c.location === LOC.overlay) return add
  const type = SUMMON_TYPES.find(([bit]) => (ocg.card(c.code)?.type ?? 0) & bit)?.[1]
  return type ? `Debug.PreSummon(${add},${type})` : add
}

export const playerOf = (n: number): Player => (n === 0 ? 'p1' : 'p2')
export const indexOf = (p: Player) => (p === 'p1' ? 0 : 1)

export type RunResult = {
  messages: Msg[] // everything that happened since the last answer, in full view
  prompt?: PromptMsg // what the core is waiting for, if the duel isn't over
  winner?: { player: Player; reason: number }
  retried?: boolean // the last answer was invalid and was dropped
}

function fromDecks(p: Player, setup: Extract<DuelSetup, { decks: unknown }>, rng: () => number) {
  const main = [...setup.decks[p].main]
  if (setup.shuffle) {
    for (let i = main.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[main[i], main[j]] = [main[j], main[i]]
    }
  }
  const placed = (code: number, location: number): Placed => ({ code, owner: p, location, sequence: 0, position: POS.faceDownDef })
  return { lp: 8000, cards: [...main.map((c) => placed(c, LOC.deck)), ...setup.decks[p].extra.map((c) => placed(c, LOC.extra))] }
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
    const monsters: string[] = []
    for (const p of ['p1', 'p2'] as const) {
      const player = indexOf(p)
      const { lp, cards } = 'position' in setup ? setup.position[p] : fromDecks(p, setup, rng)
      this.duel.setPlayerInfo({ player, lp, startHand: 'position' in setup ? 0 : 5, drawCount: 1 })
      for (const location of PLACE_ORDER) {
        for (const c of cards.filter((c) => c.location === location)) this.duel.newCard({ ...c, owner: indexOf(c.owner), player })
      }
      monsters.push(...cards.filter((c) => c.location === LOC.mzone || c.location === LOC.overlay).map((c) => addMonster(ocg, c, player)))
    }
    // Monsters go in through a script, as EDOPro puzzles do: that's the only
    // way to give an Xyz Monster its materials, or to count a monster as
    // properly summoned (so it can be revived once it leaves the field).
    if (monsters.length) {
      const path = `./position/${++scriptsRun}.lua`
      ocg.scripts.set(path, monsters.join('\n'))
      this.duel.preloadScript(path)
      ocg.scripts.delete(path)
    }
    // Master Rule 2020. A position is mid-duel, so its first turn can attack.
    this.duel.startDuel({ rule: 5, flags: 'position' in setup ? [Core.OcgcoreDuelOptionFlag.AttackFirstTurn] : [] })
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
