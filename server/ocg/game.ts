// A duel on the rules core together with its translation into our steps.
// Built from a resolved scenario, whose setup state is where translation
// starts. With only decks, the pools give the core its decks; with a setup
// (a hand, a board), the core starts from that position.
import type { BoardState, CardInstance, Player, Step } from '../../src/engine'
import type { ResolvedScenario } from '../../src/scenarios/resolve'
import { OcgDuel, playerOf, type DuelSetup, type Placed, type RunResult } from './duel'
import { LOC, POS, type Ocg, type PromptMsg } from './lib'
import { selectHint } from './prompt'
import { Translator } from './translate'

// hint is the core's "select a..." text for the prompt, if it sent one.
export type Progress = { steps: Step[]; prompt?: PromptMsg; hint?: number; waitingFor?: Player; winner?: RunResult['winner']; retried?: boolean }

export class OcgGame {
  readonly duel: OcgDuel
  readonly translator: Translator

  constructor(ocg: Ocg, scenario: ResolvedScenario, shuffle = true) {
    const { setup } = scenario.game
    const initial = scenario.timeline[0].state
    const cards = Object.values(initial.cards)
    const missing = cards.filter((c) => c.cardId === undefined || !ocg.card(c.cardId))
    if (missing.length) throw new Error(`the rules engine doesn't know ${[...new Set(missing.map((c) => c.custom?.name ?? c.cardId))].join(', ')}`)
    let duel: DuelSetup
    if (isPosition(initial)) {
      if (initial.activePlayer !== 'p1') throw new Error("a position on the rules engine starts on p1's turn")
      // Already in order: the setup shuffled what it didn't place.
      duel = { seed: setup.seed, position: { p1: position(initial, 'p1'), p2: position(initial, 'p2') } }
    } else {
      const deck = (p: Player, extra: boolean) => setup.players[p].pool.filter((c) => !!c.extra === extra).map((c) => c.cardId!)
      duel = { seed: setup.seed, shuffle, decks: { p1: { main: deck('p1', false), extra: deck('p1', true) }, p2: { main: deck('p2', false), extra: deck('p2', true) } } }
    }
    this.duel = new OcgDuel(ocg, duel)
    this.translator = new Translator(initial, ocg, this.duel)
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

// A setup puts cards somewhere other than the Decks, or changes LP.
const isPosition = (s: BoardState) =>
  (['p1', 'p2'] as const).some((p) => {
    const { lp, zones } = s.players[p]
    return lp !== 8000 || Object.entries(zones).some(([zone, cards]) => zone !== 'deck' && zone !== 'extraDeck' && cards.some(Boolean))
  })

const PILES = { deck: LOC.deck, hand: LOC.hand, gy: LOC.grave, banished: LOC.removed, extraDeck: LOC.extra } as const

const onField = (c: CardInstance) => (c.faceUp ? (c.position === 'def' ? POS.faceUpDef : POS.faceUpAtk) : c.position === 'def' ? POS.faceDownDef : POS.faceDownAtk)

// Where the core places each card this player controls. Extra Monster Zones
// are numbered from each player's own left (see zoneFor in translate.ts).
function position(s: BoardState, player: Player): { lp: number; cards: Placed[] } {
  const { lp, zones } = s.players[player]
  const cards: Placed[] = []
  const put = (iid: string, location: number, sequence: number, position: number) => {
    const c = s.cards[iid]
    cards.push({ code: c.cardId!, owner: c.owner, location, sequence, position })
  }
  for (const [zone, location] of Object.entries(PILES)) {
    const pos = (iid: string) => (location === LOC.grave || (location === LOC.removed && s.cards[iid].faceUp) ? POS.faceUpAtk : POS.faceDownDef)
    // Our Deck is top first; the core's top is the last card in.
    const pile = zones[zone as keyof typeof PILES]
    for (const iid of location === LOC.deck ? pile.toReversed() : pile) put(iid, location, 0, pos(iid))
  }
  const monster = (iid: string, sequence: number) => {
    put(iid, LOC.mzone, sequence, onField(s.cards[iid]))
    for (const m of s.cards[iid].materials) put(m, LOC.overlay, sequence, POS.faceUpAtk)
  }
  zones.monster.forEach((iid, slot) => iid && monster(iid, slot))
  s.extraMonster.forEach((iid, slot) => iid && s.cards[iid].owner === player && monster(iid, player === 'p1' ? slot + 5 : 6 - slot))
  zones.spellTrap.forEach((iid, slot) => iid && put(iid, LOC.szone, slot, s.cards[iid].faceUp ? POS.faceUpAtk : POS.faceDownDef))
  zones.fieldSpell.forEach((iid) => iid && put(iid, LOC.szone, 5, s.cards[iid].faceUp ? POS.faceUpAtk : POS.faceDownDef))
  return { lp, cards }
}
