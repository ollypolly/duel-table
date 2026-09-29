// Data-driven zone definitions plus the helpers that read/write zones. Adding a
// zone (e.g. Pendulum) should be an entry here plus layout, nothing else.
import type { BoardState, Iid, Location, Player, PlayerZone, SlotZone, ZoneName, ZoneRef } from './types'

export type ZoneDef = {
  label: string
  kind: 'pile' | 'slots'
  capacity?: number // slots only
  field: boolean // on the field (cards here can be summoned, modified, attacked)
  shared?: boolean
  // Who can see face-down contents at a real table. This tool shows everything
  // to the learner anyway; the UI uses this for default face-up/face-down.
  visibility: 'public' | 'owner' | 'hidden'
  // Default face-up state for a card moved here without an explicit faceUp.
  defaultFaceUp: boolean
  // Where a card lands in a pile when no index is given.
  insertAt?: 'top' | 'bottom'
}

export const ZONES: Record<ZoneName, ZoneDef> = {
  deck: { label: 'Deck', kind: 'pile', field: false, visibility: 'hidden', defaultFaceUp: false, insertAt: 'top' },
  hand: { label: 'Hand', kind: 'pile', field: false, visibility: 'owner', defaultFaceUp: false, insertAt: 'bottom' },
  extraDeck: { label: 'Extra Deck', kind: 'pile', field: false, visibility: 'owner', defaultFaceUp: false, insertAt: 'top' },
  gy: { label: 'GY', kind: 'pile', field: false, visibility: 'public', defaultFaceUp: true, insertAt: 'top' },
  banished: { label: 'Banished', kind: 'pile', field: false, visibility: 'public', defaultFaceUp: true, insertAt: 'top' },
  monster: { label: 'Monster Zone', kind: 'slots', capacity: 5, field: true, visibility: 'public', defaultFaceUp: true },
  spellTrap: { label: 'Spell & Trap Zone', kind: 'slots', capacity: 5, field: true, visibility: 'public', defaultFaceUp: true },
  fieldSpell: { label: 'Field Zone', kind: 'slots', capacity: 1, field: true, visibility: 'public', defaultFaceUp: true },
  extraMonster: {
    label: 'Extra Monster Zone',
    kind: 'slots',
    capacity: 2,
    field: true,
    shared: true,
    visibility: 'public',
    defaultFaceUp: true,
  },
}

export const PLAYER_ZONES = (Object.keys(ZONES) as ZoneName[]).filter((z) => !ZONES[z].shared) as PlayerZone[]
export const MONSTER_ZONES: ZoneName[] = ['monster', 'extraMonster']
export const PLAYERS: Player[] = ['p1', 'p2']
export const opponent = (p: Player): Player => (p === 'p1' ? 'p2' : 'p1')

export class EngineError extends Error {}

export function emptyZones(): BoardState['players']['p1']['zones'] {
  const zones = {} as BoardState['players']['p1']['zones']
  for (const z of PLAYER_ZONES) {
    const def = ZONES[z]
    ;(zones as Record<string, unknown>)[z] = def.kind === 'slots' ? Array(def.capacity).fill(null) : []
  }
  return zones
}

export function zoneKey(ref: ZoneRef): string {
  return ZONES[ref.zone]?.shared ? ref.zone : `${ref.player}.${ref.zone}`
}

// Returns the live array for a zone (mutate only on a cloned state).
export function zoneArray(state: BoardState, ref: ZoneRef): (Iid | null)[] {
  const def = ZONES[ref.zone]
  if (!def) throw new EngineError(`Unknown zone "${ref.zone}"`)
  if (def.shared) return state.extraMonster
  if (!ref.player) throw new EngineError(`Zone "${ref.zone}" needs a player`)
  return state.players[ref.player].zones[ref.zone as PlayerZone]
}

export const isSlotZone = (z: ZoneName): z is SlotZone | 'extraMonster' => ZONES[z].kind === 'slots'
export const isFieldZone = (z: ZoneName) => ZONES[z].field

export function locate(state: BoardState, iid: Iid): Location | undefined {
  for (const player of PLAYERS) {
    for (const zone of PLAYER_ZONES) {
      const i = state.players[player].zones[zone].indexOf(iid)
      if (i !== -1) return { zone: isSlotZone(zone) ? { player, zone, slot: i } : { player, zone }, index: i }
    }
  }
  const e = state.extraMonster.indexOf(iid)
  if (e !== -1) return { zone: { zone: 'extraMonster', slot: e }, index: e }
  for (const card of Object.values(state.cards)) {
    const m = card.materials.indexOf(iid)
    if (m !== -1) return { materialOf: card.iid, index: m }
  }
  return undefined
}

export function zoneOf(state: BoardState, iid: Iid): ZoneRef | undefined {
  const loc = locate(state, iid)
  return loc && 'zone' in loc ? loc.zone : undefined
}

export function isOnField(state: BoardState, iid: Iid): boolean {
  const z = zoneOf(state, iid)
  return !!z && isFieldZone(z.zone)
}

// Everything in a zone, in order, skipping empty slots.
export function cardsIn(state: BoardState, ref: ZoneRef): Iid[] {
  return zoneArray(state, ref).filter((x): x is Iid => x !== null)
}

export function firstEmptySlot(state: BoardState, ref: ZoneRef): number | undefined {
  const i = zoneArray(state, ref).indexOf(null)
  return i === -1 ? undefined : i
}
