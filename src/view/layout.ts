// Playmat geometry in abstract table units (a card is 1 wide). The 2D board
// converts these to percentages; a 3D board would use them as world coords.
// p1 sits at the bottom (+y); p2 is p1 rotated 180° around the centre.
import type { Player, ZoneName, ZoneRef } from '../engine'

export const CARD = { w: 1, h: 1.46 }
const COL = 1.2 // column pitch
const ROW = 1.62 // row pitch

export type Point = { x: number; y: number }
export type Placement = Point & { rotation: number } // degrees; 180 = facing p1

// Grid positions for p1, as [column, row]. Columns run -1..7 left to right;
// row 1 is the Monster Zone row, 2 the Spell & Trap row.
const P1_GRID: Partial<Record<ZoneName, (slot: number) => [number, number]>> = {
  fieldSpell: () => [0, 1],
  monster: (s) => [1 + s, 1],
  gy: () => [6, 1],
  banished: () => [7, 1],
  extraDeck: () => [0, 2],
  spellTrap: (s) => [1 + s, 2],
  deck: () => [6, 2],
}

const toPoint = ([c, r]: [number, number], player: Player): Placement => {
  const x = (c - 3) * COL
  const y = r * ROW
  return player === 'p1' ? { x, y, rotation: 0 } : { x: -x, y: -y, rotation: 180 }
}

export function zonePlacement(ref: ZoneRef): Placement {
  if (ref.zone === 'extraMonster') return { x: ((ref.slot ?? 0) === 0 ? -1 : 1) * COL, y: 0, rotation: 0 }
  if (ref.zone === 'hand') return handPlacement(ref.player!, 0, 1)
  const grid = P1_GRID[ref.zone]
  if (!grid) throw new Error(`No layout for zone ${ref.zone}`)
  return toPoint(grid(ref.slot ?? 0), ref.player!)
}

const HAND_Y = 2 * ROW + 1.95
const HAND_MAX_WIDTH = 6.5 * COL // leaves the corners for the deck box

export function handPlacement(player: Player, index: number, count: number): Placement {
  const pitch = Math.min(1.08, count > 1 ? HAND_MAX_WIDTH / (count - 1) : 0)
  const x = (index - (count - 1) / 2) * pitch
  return player === 'p1' ? { x, y: HAND_Y, rotation: 0 } : { x: -x, y: -HAND_Y, rotation: 180 }
}

// The deck box sits in the hand row's corner, by the Deck.
export const DECK_BOX = { w: 0.9, h: 1.3 }
export function deckBoxPlacement(player: Player): Placement {
  const x = 4 * COL
  return player === 'p1' ? { x, y: HAND_Y, rotation: 0 } : { x: -x, y: -HAND_Y, rotation: 180 }
}

// The table area every renderer should frame.
export const BOUNDS = (() => {
  const halfW = 4 * COL + CARD.w / 2 + 0.15
  const halfH = HAND_Y + CARD.h / 2 + 0.1
  return { minX: -halfW, minY: -halfH, width: halfW * 2, height: halfH * 2 }
})()

// Where Xyz materials peek out from under their monster.
export const MATERIAL_OFFSET = 0.09

// What a renderer's camera should frame. A player's area is their half plus
// the opponent's Monster Zones (what they'd attack or target) and the Extra
// Monster Zones.
export type FocusArea = 'all' | Player
export type Region = { minX: number; minY: number; width: number; height: number }

// handless: p1's hand is pinned to the screen, so its row isn't framed.
export function focusRegion(area: FocusArea, handless = false): Region {
  const bottom = handless ? 2 * ROW + CARD.h / 2 + 0.15 : BOUNDS.minY + BOUNDS.height
  if (area === 'all') return { ...BOUNDS, height: bottom - BOUNDS.minY }
  const oppMonsterTop = -(ROW + CARD.h / 2 + 0.15)
  const p2Bottom = BOUNDS.minY + (BOUNDS.minY + BOUNDS.height - oppMonsterTop)
  return area === 'p1'
    ? { minX: BOUNDS.minX, minY: oppMonsterTop, width: BOUNDS.width, height: bottom - oppMonsterTop }
    : { minX: BOUNDS.minX, minY: BOUNDS.minY, width: BOUNDS.width, height: p2Bottom - BOUNDS.minY }
}
