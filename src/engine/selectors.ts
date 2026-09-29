// Derived values. Nothing here is stored in BoardState: current ATK, current
// name etc. are always computed from base card data plus modifiers.
import type { BoardState, CardInstance, Iid, Modifier } from './types'

// Base card data the engine needs. The card DB satisfies this; the engine
// never imports the DB itself.
export type CardLookup = (cardId: number) => { name: string; atk?: number; def?: number } | undefined

export const modifiersOn = (state: BoardState, iid: Iid): Modifier[] =>
  state.modifiers.filter((m) => m.target === iid)

export function baseStats(card: CardInstance, lookup: CardLookup) {
  if (card.custom) return { name: card.custom.name, atk: card.custom.atk, def: card.custom.def }
  const data = card.cardId !== undefined ? lookup(card.cardId) : undefined
  return { name: data?.name ?? card.iid, atk: data?.atk, def: data?.def }
}

function applyStat(base: number | undefined, mods: Modifier[]): number | undefined {
  if (base === undefined) return undefined
  let value = base
  for (const m of mods) {
    if (typeof m.value !== 'number') continue
    if (m.op === 'set') value = m.value
    else if (m.op === 'multiply') value = Math.round(value * m.value)
    else value += m.value
  }
  return Math.max(0, value)
}

export function currentAtk(state: BoardState, iid: Iid, lookup: CardLookup): number | undefined {
  const mods = modifiersOn(state, iid).filter((m) => m.kind === 'atk')
  return applyStat(baseStats(state.cards[iid], lookup).atk, mods)
}

export function currentDef(state: BoardState, iid: Iid, lookup: CardLookup): number | undefined {
  const mods = modifiersOn(state, iid).filter((m) => m.kind === 'def')
  return applyStat(baseStats(state.cards[iid], lookup).def, mods)
}

// The latest name modifier wins (e.g. Fusion Tag: "treated as VW-Tiger Catapult").
export function currentName(state: BoardState, iid: Iid, lookup: CardLookup): string {
  const renamed = modifiersOn(state, iid).filter((m) => m.kind === 'name' && typeof m.value === 'string')
  return (renamed.at(-1)?.value as string | undefined) ?? baseStats(state.cards[iid], lookup).name
}

// "Has this player Special Summoned a card with this passcode this duel?"
// Armed Dragon Catapult Cannon's summoning condition is the motivating case.
export function hasSpecialSummoned(state: BoardState, player: 'p1' | 'p2', cardId: number): boolean {
  return state.history.some(
    (h) => h.kind === 'summoned' && h.player === player && h.cardId === cardId && h.method !== 'normal' && h.method !== 'tribute' && h.method !== 'flip',
  )
}
