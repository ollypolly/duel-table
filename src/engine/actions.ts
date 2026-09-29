// The reducer. applyAction never mutates its input; it clones, applies one
// primitive action and reports what happened as events. Physically impossible
// actions (unknown card, occupied slot, empty deck) throw EngineError; run
// them through a RulesProvider first to get them as issues instead.
import type {
  Action,
  ActionResult,
  BoardState,
  CardInstance,
  Cause,
  EngineEvent,
  Iid,
  Location,
  Player,
  Position,
  SummonMethod,
  ZoneRef,
} from './types'
import { shuffle } from './rng'
import { EngineError, isFieldZone, isSlotZone, locate, opponent, ZONES, zoneArray, zoneOf } from './zones'

export function applyAction(prev: BoardState, action: Action): ActionResult {
  const state = structuredClone(prev)
  const events: EngineEvent[] = []

  switch (action.type) {
    case 'move':
      moveCard(state, events, action.card, action.to, action)
      if (action.summon) recordSummon(state, events, action.card, action.summon)
      break

    case 'draw': {
      const count = action.count ?? 1
      const deck = state.players[action.player].zones.deck
      if (deck.length < count) {
        throw new EngineError(`${action.player} can't draw ${count}: only ${deck.length} card(s) in the Deck`)
      }
      const drawn = deck.slice(0, count)
      for (const iid of drawn) moveCard(state, events, iid, { player: action.player, zone: 'hand' }, action)
      events.push({ type: 'drew', player: action.player, cards: drawn })
      break
    }

    case 'shuffle': {
      if (isSlotZone(action.zone)) throw new EngineError(`Can't shuffle ${action.zone}: it isn't a pile`)
      const zones = state.players[action.player].zones
      const result = shuffle(zones[action.zone], state.rng)
      zones[action.zone] = result.items
      state.rng = result.rng
      events.push({ type: 'shuffled', player: action.player, zone: action.zone })
      break
    }

    case 'lp': {
      const p = state.players[action.player]
      const from = p.lp
      if ((action.set === undefined) === (action.delta === undefined)) {
        throw new EngineError('lp needs exactly one of delta or set')
      }
      p.lp = action.set ?? Math.max(0, p.lp + action.delta!)
      events.push({ type: 'lpChanged', player: action.player, from, to: p.lp, cause: action.cause })
      break
    }

    case 'phase':
      events.push({ type: 'phaseChanged', from: state.phase, to: action.phase })
      state.phase = action.phase
      break

    case 'nextTurn': {
      for (const m of [...state.modifiers]) {
        const expires =
          m.until === 'endOfTurn' || (m.until === 'endOfNextTurn' && (m.turn ?? state.turn) < state.turn)
        if (expires) removeModifier(state, events, m.id, 'expired')
      }
      state.turn += 1
      state.activePlayer = opponent(state.activePlayer)
      state.phase = 'draw'
      state.turnFlags = { normalSummonUsed: { p1: false, p2: false }, oncePerTurn: {} }
      events.push({ type: 'turnStarted', turn: state.turn, player: state.activePlayer })
      break
    }

    case 'attach': {
      if (action.card === action.to) throw new EngineError(`Can't attach ${action.card} to itself`)
      const host = getCard(state, action.to)
      const card = getCard(state, action.card)
      const from = mustLocate(state, action.card)
      const leavingField = 'zone' in from && isFieldZone(from.zone.zone)
      removeFrom(state, from, action.card)
      // A monster attached as material brings its own materials with it.
      const carried = card.materials
      card.materials = []
      host.materials.push(action.card, ...carried)
      card.faceUp = true
      card.position = 'atk'
      if (leavingField) leftField(state, events, action.card)
      events.push({
        type: 'moved',
        card: action.card,
        from,
        to: { materialOf: host.iid, index: host.materials.indexOf(action.card) },
        cause: action.cause,
      })
      break
    }

    case 'detach': {
      const card = getCard(state, action.card)
      const from = locate(state, action.card)
      if (!from || !('materialOf' in from)) throw new EngineError(`${action.card} isn't attached as material`)
      moveCard(state, events, action.card, action.to ?? { player: card.owner, zone: 'gy' }, action)
      break
    }

    case 'flip': {
      const card = getCard(state, action.card)
      card.faceUp = !card.faceUp
      events.push({ type: 'flipped', card: card.iid, faceUp: card.faceUp })
      break
    }

    case 'position': {
      const card = getCard(state, action.card)
      card.position = action.position
      events.push({ type: 'positionChanged', card: card.iid, position: action.position })
      break
    }

    case 'reveal':
      for (const iid of action.cards) getCard(state, iid)
      state.revealed = [...new Set([...state.revealed, ...action.cards])]
      events.push({ type: 'revealed', cards: action.cards })
      break

    case 'highlight':
      for (const iid of action.cards) getCard(state, iid)
      state.highlights = [...new Set([...state.highlights, ...action.cards])]
      break

    case 'arrow':
      getCard(state, action.from)
      getCard(state, action.to)
      state.arrows.push({ from: action.from, to: action.to })
      break

    case 'modify': {
      const m = action.modifier
      getCard(state, m.target)
      if (state.modifiers.some((x) => x.id === m.id)) throw new EngineError(`Modifier "${m.id}" already exists`)
      const modifier = { ...m, turn: state.turn }
      state.modifiers.push(modifier)
      events.push({ type: 'modifierAdded', modifier })
      break
    }

    case 'unmodify':
      removeModifier(state, events, action.id, 'unmodify')
      break

    case 'chainPush': {
      getCard(state, action.card)
      const link = { card: action.card, player: action.player ?? controllerOf(state, action.card), label: action.label }
      if (link.label === undefined) delete link.label
      state.chain.push(link)
      events.push({ type: 'chainLinkAdded', link, number: state.chain.length })
      break
    }

    case 'chainResolve': {
      const number = state.chain.length
      const link = state.chain.pop()
      if (!link) throw new EngineError('The chain is empty')
      events.push({ type: 'chainLinkResolved', link, number })
      break
    }

    case 'create': {
      if (state.cards[action.card]) throw new EngineError(`Card "${action.card}" already exists`)
      state.cards[action.card] = {
        iid: action.card,
        ...(action.cardId !== undefined && { cardId: action.cardId }),
        ...(action.custom && { custom: action.custom }),
        owner: action.owner,
        faceUp: action.faceUp ?? ZONES[action.to.zone]?.defaultFaceUp ?? true,
        position: action.position ?? 'atk',
        materials: [],
      }
      const to = placeInto(state, action.card, action.to)
      events.push({ type: 'created', card: action.card, to })
      break
    }

    case 'remove': {
      const from = mustLocate(state, action.card)
      if ('zone' in from && isFieldZone(from.zone.zone)) leftField(state, events, action.card)
      removeFrom(state, from, action.card)
      delete state.cards[action.card]
      events.push({ type: 'removed', card: action.card, from })
      break
    }

    default: {
      const unknown: never = action
      throw new EngineError(`Unknown action type "${(unknown as { type: string }).type}"`)
    }
  }

  return { state, events }
}

export function getCard(state: BoardState, iid: Iid): CardInstance {
  const card = state.cards[iid]
  if (!card) throw new EngineError(`Unknown card "${iid}"`)
  return card
}

export function controllerOf(state: BoardState, iid: Iid): Player {
  return zoneOf(state, iid)?.player ?? getCard(state, iid).owner
}

function mustLocate(state: BoardState, iid: Iid): Location {
  getCard(state, iid)
  const loc = locate(state, iid)
  if (!loc) throw new EngineError(`Card "${iid}" isn't anywhere on the board`)
  return loc
}

function removeFrom(state: BoardState, loc: Location, iid: Iid) {
  if ('materialOf' in loc) {
    const host = state.cards[loc.materialOf]
    host.materials = host.materials.filter((m) => m !== iid)
    return
  }
  const arr = zoneArray(state, loc.zone)
  if (isSlotZone(loc.zone.zone)) arr[loc.index] = null
  else arr.splice(loc.index, 1)
}

// Place a card (already removed from wherever it was) into a zone.
function placeInto(state: BoardState, iid: Iid, to: ZoneRef, index?: number): Location {
  const def = ZONES[to.zone]
  if (!def) throw new EngineError(`Unknown zone "${to.zone}"`)
  const ref: ZoneRef = def.shared ? { zone: to.zone, slot: to.slot } : { player: to.player, zone: to.zone }
  const arr = zoneArray(state, ref)
  if (def.kind === 'slots') {
    const slot = to.slot ?? arr.indexOf(null)
    if (slot < 0) throw new EngineError(`No free slot in ${zoneLabel(to)}`)
    if (slot >= arr.length) throw new EngineError(`${zoneLabel(to)} has no slot ${slot} (0-${arr.length - 1})`)
    if (arr[slot] !== null) throw new EngineError(`${zoneLabel(to)} slot ${slot} is occupied by ${arr[slot]}`)
    arr[slot] = iid
    return { zone: { ...ref, slot }, index: slot }
  }
  const at = Math.min(index ?? (def.insertAt === 'bottom' ? arr.length : 0), arr.length)
  arr.splice(at, 0, iid)
  return { zone: ref, index: at }
}

export function zoneLabel(ref: ZoneRef): string {
  const def = ZONES[ref.zone]
  return def?.shared ? def.label : `${ref.player}'s ${def?.label ?? ref.zone}`
}

function moveCard(
  state: BoardState,
  events: EngineEvent[],
  iid: Iid,
  to: ZoneRef,
  opts: { faceUp?: boolean; position?: Position; index?: number; cause?: Cause },
) {
  const card = getCard(state, iid)
  const from = mustLocate(state, iid)
  const wasOnField = 'zone' in from && isFieldZone(from.zone.zone)
  removeFrom(state, from, iid)
  const placed = placeInto(state, iid, to, opts.index)
  const def = ZONES[to.zone]
  card.faceUp = opts.faceUp ?? def.defaultFaceUp
  if (opts.position) card.position = opts.position
  else if (!def.field) card.position = 'atk'
  if (wasOnField && !def.field) leftField(state, events, iid)
  events.push({ type: 'moved', card: iid, from, to: placed, cause: opts.cause })
}

// A card leaving the field loses its non-permanent modifiers, and any Xyz
// materials under it go to their owners' GYs.
function leftField(state: BoardState, events: EngineEvent[], iid: Iid) {
  for (const m of state.modifiers.filter((m) => m.target === iid && m.until !== 'permanent')) {
    removeModifier(state, events, m.id, 'leftField')
  }
  const card = state.cards[iid]
  for (const mat of [...card.materials]) {
    moveCard(state, events, mat, { player: state.cards[mat].owner, zone: 'gy' }, { cause: { card: iid, reason: 'rule' } })
  }
}

function removeModifier(
  state: BoardState,
  events: EngineEvent[],
  id: string,
  reason: 'unmodify' | 'expired' | 'leftField',
) {
  const modifier = state.modifiers.find((m) => m.id === id)
  if (!modifier) throw new EngineError(`No modifier with id "${id}"`)
  state.modifiers = state.modifiers.filter((m) => m.id !== id)
  events.push({ type: 'modifierRemoved', modifier, reason })
}

function recordSummon(state: BoardState, events: EngineEvent[], iid: Iid, method: SummonMethod) {
  const zone = zoneOf(state, iid)
  if (!zone || (zone.zone !== 'monster' && zone.zone !== 'extraMonster')) {
    throw new EngineError(`${iid} was summoned but isn't in a Monster Zone`)
  }
  const player = controllerOf(state, iid)
  const card = state.cards[iid]
  state.history.push({ turn: state.turn, kind: 'summoned', player, card: iid, cardId: card.cardId, method })
  if (method === 'normal' || method === 'tribute') state.turnFlags.normalSummonUsed[player] = true
  events.push({ type: 'summoned', card: iid, method, player })
}
