// Turns a resolved scenario setup (cards already mapped to passcodes) into the
// starting BoardState. Card names only matter here: they become iids.
import type { BoardState, CardInstance, CustomCard, Iid, Phase, Player, PlayerZone, Position } from './types'
import { shuffle } from './rng'
import { EngineError, emptyZones, isSlotZone, PLAYERS, ZONES } from './zones'

export type SetupCard = {
  name: string
  cardId?: number
  custom?: CustomCard
  extra: boolean // lives in the Extra Deck
}

export type Placement = {
  name: string
  faceUp?: boolean
  position?: Position
  materials?: string[] // names, taken from the same player's pool
}

export type PlayerSetup = {
  name: string
  lp?: number
  deck?: string // the deck file it came from, for its sleeves and mat
  pool: SetupCard[] // every card this player owns, in deck-list order
  // Starting positions. Slot zones use array index as slot (null = empty).
  // For the deck, listed cards go on top in order; the rest are shuffled below.
  placed?: Partial<Record<PlayerZone, (Placement | null)[]>>
}

export type GameSetup = {
  seed: number
  players: Record<Player, PlayerSetup>
  extraMonster?: ((Placement & { player: Player }) | null)[]
  turn?: number
  activePlayer?: Player
  phase?: Phase
}

export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const iidFor = (player: Player, name: string, copy: number) => `${player}-${slug(name)}-${copy}`

export function createInitialState(setup: GameSetup): BoardState {
  const state: BoardState = {
    players: {
      p1: { name: setup.players.p1.name, lp: setup.players.p1.lp ?? 8000, zones: emptyZones() },
      p2: { name: setup.players.p2.name, lp: setup.players.p2.lp ?? 8000, zones: emptyZones() },
    },
    extraMonster: Array(ZONES.extraMonster.capacity).fill(null),
    cards: {},
    turn: setup.turn ?? 1,
    activePlayer: setup.activePlayer ?? 'p1',
    phase: setup.phase ?? 'draw',
    chain: [],
    modifiers: [],
    history: [],
    turnFlags: { normalSummonUsed: { p1: false, p2: false }, oncePerTurn: {} },
    rng: { seed: setup.seed, cursor: 0 },
    revealed: [],
    highlights: [],
    arrows: [],
  }

  const unplaced: Record<Player, Iid[]> = { p1: [], p2: [] }
  const extraByIid: Record<Iid, boolean> = {}

  for (const player of PLAYERS) {
    const copies: Record<string, number> = {}
    for (const c of setup.players[player].pool) {
      const n = (copies[c.name] = (copies[c.name] ?? 0) + 1)
      const iid = iidFor(player, c.name, n)
      state.cards[iid] = {
        iid,
        ...(c.cardId !== undefined && { cardId: c.cardId }),
        ...(c.custom && { custom: c.custom }),
        owner: player,
        faceUp: false,
        position: 'atk',
        materials: [],
      }
      unplaced[player].push(iid)
      extraByIid[iid] = c.extra
    }
  }

  // Take the lowest-numbered copy of `name` that hasn't been placed yet.
  const take = (player: Player, name: string, where: string): CardInstance => {
    const prefix = `${player}-${slug(name)}-`
    const i = unplaced[player].findIndex((iid) => iid.startsWith(prefix) && /^\d+$/.test(iid.slice(prefix.length)))
    if (i === -1) throw new EngineError(`Setup puts "${name}" in ${player}'s ${where}, but no unplaced copy is left in their cards`)
    return state.cards[unplaced[player].splice(i, 1)[0]]
  }

  const place = (card: CardInstance, p: Placement, zone: PlayerZone | 'extraMonster', player: Player) => {
    card.faceUp = p.faceUp ?? ZONES[zone].defaultFaceUp
    if (p.position) card.position = p.position
    for (const m of p.materials ?? []) {
      const mat = take(player, m, `materials of ${card.iid}`)
      mat.faceUp = true
      card.materials.push(mat.iid)
    }
  }

  for (const player of PLAYERS) {
    const zones = state.players[player].zones
    for (const [zone, entries] of Object.entries(setup.players[player].placed ?? {}) as [PlayerZone, (Placement | null)[]][]) {
      if (!ZONES[zone]) throw new EngineError(`Unknown zone "${zone}" in ${player}'s setup`)
      entries.forEach((p, i) => {
        if (!p) return
        const card = take(player, p.name, ZONES[zone].label)
        place(card, p, zone, player)
        if (isSlotZone(zone)) {
          if (i >= zones[zone].length) throw new EngineError(`${player}'s ${ZONES[zone].label} has no slot ${i}`)
          zones[zone][i] = card.iid
        } else {
          zones[zone].push(card.iid)
        }
      })
    }
  }

  setup.extraMonster?.forEach((p, i) => {
    if (!p) return
    const card = take(p.player, p.name, ZONES.extraMonster.label)
    place(card, p, 'extraMonster', p.player)
    state.extraMonster[i] = card.iid
  })

  for (const player of PLAYERS) {
    const zones = state.players[player].zones
    zones.extraDeck.push(...unplaced[player].filter((iid) => extraByIid[iid]))
    const rest = shuffle(
      unplaced[player].filter((iid) => !extraByIid[iid]),
      state.rng,
    )
    state.rng = rest.rng
    zones.deck.push(...rest.items)
  }

  return state
}
