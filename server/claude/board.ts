// An example Claude lays out by hand, for what the rules engine can't play:
// anime cards, made-up cards, a ruling shown the slow way. It gives a
// position and its moves with cards by name; here they become a free table's
// file and steps, which nothing checks against the rules.
import { z } from 'zod'
import type { CardDb } from '../../src/data/cardDb'
import type { Action, BoardState, Iid, Player, Step, ZoneRef } from '../../src/engine'
import { locate } from '../../src/engine'
import { CustomCardSchema, PhaseSchema, PlayerSchema, PositionSchema, SetupSchema, SummonMethodSchema, ZoneNameSchema, type ScenarioFile, type Setup } from '../../src/scenarios/schema'
import { cardFace } from '../../src/view/boardView'

const card = z.string().describe('A card on the table, by name')
const OpSchema = z.discriminatedUnion('do', [
  z.object({
    do: z.literal('move'),
    card,
    to: ZoneNameSchema,
    player: PlayerSchema.optional().describe("Whose zone (the card's owner if not given)"),
    from: ZoneNameSchema.optional().describe('Which copy, when the card is in more than one place'),
    position: PositionSchema.optional(),
    faceUp: z.boolean().optional().describe('false to Set it'),
    summon: SummonMethodSchema.optional().describe('When the move is a Summon'),
  }),
  z.object({ do: z.literal('lp'), player: PlayerSchema, delta: z.number().describe('Negative for damage') }),
  z.object({ do: z.literal('attach'), card, to: card.describe('The Xyz Monster it goes under') }),
  z.object({ do: z.literal('flip'), card }),
  z.object({ do: z.literal('position'), card, position: PositionSchema }),
  z.object({ do: z.literal('arrow'), from: card, to: card }).describe('An attack or a target, drawn from one card to another'),
  z.object({ do: z.literal('draw'), player: PlayerSchema, count: z.int().min(1).optional() }).describe('From the top cards the setup put in the Deck'),
  z.object({ do: z.literal('phase'), phase: PhaseSchema }),
  z.object({ do: z.literal('nextTurn') }),
])
type Op = z.infer<typeof OpSchema>

export const BoardSchema = z.object({
  title: z.string().describe('What the example shows, in a few words'),
  custom: z.array(CustomCardSchema).optional().describe('Cards that are not real printed cards (anime-only, made up): name, text, kind and ATK/DEF. Place them by name like any other'),
  setup: SetupSchema.describe(
    'Where every card starts. Zones per player: hand, monster and spellTrap (5 slots, left to right; null for an empty slot), fieldSpell, gy, banished, deck (its top cards, top first), extraDeck. A monster can be { name, position: "atk" | "def", faceUp, materials }. Only the cards you place exist: there are no decks behind them.',
  ),
  lp: z.object({ p1: z.int().min(0).optional(), p2: z.int().min(0).optional() }).optional().describe('Life points (8000 each if not given)'),
  moves: z
    .array(z.object({ label: z.string().describe('What happens, in a few words, card names in full'), say: z.string().optional().describe('One short line on why, shown under the board'), do: z.array(OpSchema).min(1) }))
    .min(1)
    .max(40)
    .describe('The steps of the example, in order: each is one thing the person steps to'),
  again: z.boolean().optional().describe('Your last example went wrong: take it out of the chat and show this one in its place'),
})
export type Board = z.infer<typeof BoardSchema>

// Every card a setup places for player, materials included.
export function placedNames(setup: Setup, player: Player): string[] {
  const names = (e: string | { name: string; materials?: string[] } | null) => (!e ? [] : typeof e === 'string' ? [e] : [e.name, ...(e.materials ?? [])])
  return [...Object.values(setup[player] ?? {}).flatMap((zone) => zone.flatMap(names)), ...(setup.extraMonster ?? []).flatMap((e) => (e?.player === player ? names(e) : []))]
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

// Real cards the table needs that the app may not have yet.
export const realNames = (b: Board) => [...new Set((['p1', 'p2'] as const).flatMap((p) => placedNames(b.setup, p)))].filter((n) => !b.custom?.some((c) => same(c.name, n)))

// The table as a file: each player owns just what the setup places for them.
export function boardFile(b: Board, db: CardDb): Omit<ScenarioFile, 'id'> {
  const owned = (p: Player) => placedNames(b.setup, p).map((n) => b.custom?.find((c) => same(c.name, n)) ?? n)
  const unknown = realNames(b).filter((n) => !db.byName(n))
  if (unknown.length) throw new Error(`no such card${unknown.length > 1 ? 's' : ''}: ${unknown.map((n) => `${n}${db.closeMatches(n, 3).length ? ` (did you mean ${db.closeMatches(n, 3).join(' / ')}?)` : ''}`).join('; ')}. A card that isn't a real printed one goes in custom.`)
  const player = (p: Player, name: string) => ({ name, ...(b.lp?.[p] !== undefined && { lp: b.lp[p] }), cards: owned(p).map((c) => (typeof c === 'string' ? c : { custom: c })) })
  return { title: b.title, demo: true, seed: 1, players: { p1: player('p1', 'You'), p2: player('p2', 'Opponent') }, setup: b.setup, start: { phase: 'main1' }, steps: [] }
}

// Where to look for a card first: one in play before one in a pile.
const ORDER = ['monster', 'extraMonster', 'spellTrap', 'fieldSpell', 'hand', 'gy', 'banished', 'extraDeck', 'deck']

// One move as a step on the table as it stands. Throws if a card isn't there.
export function boardStep(move: Board['moves'][number], state: BoardState, db: CardDb): Step {
  const zoneOf = (iid: Iid) => {
    const loc = locate(state, iid)
    return loc && 'zone' in loc ? loc.zone.zone : 'attached'
  }
  const find = (name: string, hint: { from?: string; not?: string } = {}): Iid => {
    const all = Object.keys(state.cards).filter((iid) => same(cardFace(state, iid, db, true).baseName, name) || same(cardFace(state, iid, db, true).name, name))
    const found = all
      .filter((iid) => !hint.from || zoneOf(iid) === hint.from)
      .sort((a, b) => Number(zoneOf(a) === hint.not) - Number(zoneOf(b) === hint.not) || ORDER.indexOf(zoneOf(a)) - ORDER.indexOf(zoneOf(b)))
    if (!found.length) throw new Error(all.length ? `${name} isn't in ${hint.from}` : `${name} isn't on the table: place it in the setup`)
    return found[0]
  }
  const action = (op: Op): Action => {
    switch (op.do) {
      case 'move': {
        const iid = find(op.card, { from: op.from, not: op.to })
        const to: ZoneRef = op.to === 'extraMonster' ? { zone: op.to } : { player: op.player ?? state.cards[iid].owner, zone: op.to }
        return { type: 'move', card: iid, to, ...(op.position && { position: op.position }), ...(op.faceUp !== undefined && { faceUp: op.faceUp }), ...(op.summon && { summon: op.summon }) }
      }
      case 'lp':
        return { type: 'lp', player: op.player, delta: op.delta }
      case 'attach':
        return { type: 'attach', card: find(op.card), to: find(op.to) }
      case 'flip':
        return { type: 'flip', card: find(op.card) }
      case 'position':
        return { type: 'position', card: find(op.card), position: op.position }
      case 'arrow':
        return { type: 'arrow', from: find(op.from), to: find(op.to) }
      case 'draw':
        return { type: 'draw', player: op.player, ...(op.count && { count: op.count }) }
      case 'phase':
        return { type: 'phase', phase: op.phase }
      case 'nextTurn':
        return { type: 'nextTurn' }
    }
  }
  return { label: move.label, ...(move.say && { narration: move.say }), actions: move.do.map(action), author: 'claude' }
}
