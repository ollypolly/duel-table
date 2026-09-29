import type { Action, BoardState, Intent, Issue, Player } from '../types'

// The seam a real rules engine plugs into. Level 1 only implements validate().
export interface RulesProvider {
  name: string
  validate(state: BoardState, action: Action): Issue[] // never throws
  legalIntents?(state: BoardState, player: Player): Intent[]
  resolveIntent?(state: BoardState, intent: Intent): Action[]
}
