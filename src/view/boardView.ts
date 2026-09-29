// BoardState + card data → BoardView: a flat, renderer-neutral description of
// everything on the table. Renderers (2D now, maybe 3D later) read only this.
import type { CardDb, CardData } from '../data/cardDb'
import { imagePath } from '../data/cardDb'
import {
  controllerOf,
  currentAtk,
  currentDef,
  currentName,
  locate,
  modifiersOn,
  PLAYERS,
  PLAYER_ZONES,
  ZONES,
  zoneArray,
  type BoardState,
  type CardLookup,
  type Iid,
  type Modifier,
  type Phase,
  type Player,
  type Position,
  type ZoneRef,
} from '../engine'
import { handPlacement, MATERIAL_OFFSET, zonePlacement, type Placement, type Point } from './layout'

export type CardFace = {
  iid: Iid
  cardId?: number
  data?: CardData // undefined for custom cards
  custom?: { name: string; text: string; kind?: string }
  name: string // current name (after modifiers)
  baseName: string
  owner: Player
  controller: Player
  faceUp: boolean
  set: boolean // face-down on the field
  // Whether the viewer (p1, learning) gets to see the face: face-up cards,
  // your own hand and sets, anything revealed this step.
  visible: boolean
  position: Position
  atk?: number
  def?: number
  baseAtk?: number
  baseDef?: number
  modifiers: Modifier[]
  highlighted: boolean
  revealed: boolean
  image?: string
  imageFull?: string
  frame: string // frameType, for custom cards and card backs
}

export type ZoneView = {
  key: string
  ref: ZoneRef
  label: string
  kind: 'pile' | 'slots'
  placement: Placement
  count: number
  top?: CardFace // piles: the top card
  cards: CardFace[] // piles: all cards, top first; slots: the one card (if any)
}

export type PlacedCard = CardFace & {
  placement: Placement
  zone: ZoneRef
  materialOf?: Iid
  materialIndex?: number
  stackIndex?: number // for piles: rendered as the top card
  handIndex?: number
}

export type BoardView = {
  zones: ZoneView[]
  cards: PlacedCard[] // every card the table shows, keyed by iid (field, hands, pile tops, materials)
  players: Record<Player, { name: string; lp: number; handCount: number }>
  turn: number
  activePlayer: Player
  phase: Phase
  chain: { number: number; card: CardFace; label?: string; player: Player }[]
  arrows: { from: Point; to: Point; fromIid: Iid; toIid: Iid }[]
}

export const VIEWER: Player = 'p1'

export function cardFace(state: BoardState, iid: Iid, db: CardDb): CardFace {
  const card = state.cards[iid]
  const lookup: CardLookup = (id) => db.byId(id)
  const data = card.cardId !== undefined ? db.byId(card.cardId) : undefined
  const revealed = state.revealed.includes(iid)
  const loc = locate(state, iid)
  const zone = loc && 'zone' in loc ? loc.zone.zone : undefined
  const inDeck = zone === 'deck' || zone === 'extraDeck'
  const visible = card.faceUp || revealed || (card.owner === VIEWER && !inDeck)
  return {
    iid,
    cardId: card.cardId,
    data,
    custom: card.custom,
    name: currentName(state, iid, lookup),
    baseName: data?.name ?? card.custom?.name ?? iid,
    owner: card.owner,
    controller: controllerOf(state, iid),
    faceUp: card.faceUp,
    set: !card.faceUp && zone !== undefined && ZONES[zone].field,
    visible,
    position: card.position,
    atk: currentAtk(state, iid, lookup),
    def: currentDef(state, iid, lookup),
    baseAtk: data?.atk ?? card.custom?.atk,
    baseDef: data?.def ?? card.custom?.def,
    modifiers: modifiersOn(state, iid),
    highlighted: state.highlights.includes(iid),
    revealed,
    ...(card.cardId !== undefined && { image: imagePath(card.cardId, 'small'), imageFull: imagePath(card.cardId, 'full') }),
    frame: data?.frameType ?? customFrame(card.custom?.kind),
  }
}

const customFrame = (kind?: string) =>
  kind === 'spell' ? 'spell' : kind === 'trap' ? 'trap' : kind === 'extra' ? 'fusion' : 'effect'

export function buildBoardView(state: BoardState, db: CardDb): BoardView {
  const face = (iid: Iid) => cardFace(state, iid, db)
  const zones: ZoneView[] = []
  const cards: PlacedCard[] = []
  const placements = new Map<Iid, Placement>()

  const addZone = (ref: ZoneRef) => {
    const def = ZONES[ref.zone]
    const arr = zoneArray(state, ref)
    if (def.kind === 'slots') {
      arr.forEach((iid, slot) => {
        const slotRef = { ...ref, slot }
        const placement = zonePlacement(slotRef)
        const f = iid ? face(iid) : undefined
        zones.push({
          key: `${ref.player ?? 'shared'}.${ref.zone}.${slot}`,
          ref: slotRef,
          label: def.label,
          kind: 'slots',
          placement,
          count: iid ? 1 : 0,
          cards: f ? [f] : [],
        })
        if (!iid || !f) return
        const host = state.cards[iid]
        host.materials.forEach((m, i) => {
          const offset = (host.materials.length - i) * MATERIAL_OFFSET
          const flip = placement.rotation === 180 ? -1 : 1
          cards.push({
            ...face(m),
            placement: { ...placement, x: placement.x + offset * flip, y: placement.y - offset * flip },
            zone: slotRef,
            materialOf: iid,
            materialIndex: i,
          })
        })
        cards.push({ ...f, placement, zone: slotRef })
        placements.set(iid, placement)
      })
      return
    }
    if (ref.zone === 'hand') {
      const hand = arr as Iid[]
      hand.forEach((iid, i) => {
        const placement = handPlacement(ref.player!, i, hand.length)
        cards.push({ ...face(iid), placement, zone: ref, handIndex: i })
        placements.set(iid, placement)
      })
      return
    }
    const placement = zonePlacement(ref)
    const pile = (arr as Iid[]).map(face)
    zones.push({
      key: `${ref.player}.${ref.zone}`,
      ref,
      label: def.label,
      kind: 'pile',
      placement,
      count: pile.length,
      top: pile[0],
      cards: pile,
    })
    if (pile[0]) {
      cards.push({ ...pile[0], placement, zone: ref, stackIndex: 0 })
      placements.set(pile[0].iid, placement)
    }
  }

  for (const player of PLAYERS) for (const zone of PLAYER_ZONES) addZone({ player, zone })
  addZone({ zone: 'extraMonster' })

  // Arrows can point at cards not drawn on their own (inside piles): fall back
  // to the card's zone position.
  const pointOf = (iid: Iid): Point | undefined => {
    const p = placements.get(iid)
    if (p) return p
    const loc = locate(state, iid)
    if (!loc) return undefined
    if ('materialOf' in loc) return placements.get(loc.materialOf)
    return zonePlacement(loc.zone)
  }

  return {
    zones,
    cards,
    players: {
      p1: { name: state.players.p1.name, lp: state.players.p1.lp, handCount: state.players.p1.zones.hand.length },
      p2: { name: state.players.p2.name, lp: state.players.p2.lp, handCount: state.players.p2.zones.hand.length },
    },
    turn: state.turn,
    activePlayer: state.activePlayer,
    phase: state.phase,
    chain: state.chain.map((link, i) => ({ number: i + 1, card: face(link.card), label: link.label, player: link.player })),
    arrows: state.arrows.flatMap((a) => {
      const from = pointOf(a.from)
      const to = pointOf(a.to)
      return from && to ? [{ from, to, fromIid: a.from, toIid: a.to }] : []
    }),
  }
}
