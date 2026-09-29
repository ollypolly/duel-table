// Card behaviour, kept separate from card data (which comes from the API).
// Empty in Level 1: this is the shape a card-effects layer would fill in.
import type { Action, BoardState, Iid } from '../types'

export type EffectContext = { state: BoardState; self: Iid }

export type EffectDef = {
  id: string
  label: string
  condition?(ctx: EffectContext): boolean
  cost?(ctx: EffectContext): Action[]
  resolve(ctx: EffectContext): Action[]
}

export type CardScript = { effects: EffectDef[] }

export const cardScripts: Record<number, CardScript> = {}

export const scriptFor = (cardId: number | undefined): CardScript | undefined =>
  cardId === undefined ? undefined : cardScripts[cardId]
