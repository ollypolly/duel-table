// Physical checks only, like a real table: is the card where it needs to be,
// is the slot free. Errors mean the action can't be applied at all; warnings
// are things a table allows but that are probably a mistake.
import { applyAction, getCard } from '../actions'
import type { Action, BoardState, Issue } from '../types'
import { isOnField, ZONES } from '../zones'
import type { RulesProvider } from './types'

export const tableRules: RulesProvider = {
  name: 'table',
  validate(state, action) {
    try {
      applyAction(state, action)
    } catch (e) {
      return [{ severity: 'error', message: e instanceof Error ? e.message : String(e) }]
    }
    return warnings(state, action)
  },
}

function warnings(state: BoardState, action: Action): Issue[] {
  const issues: Issue[] = []
  const warn = (message: string) => issues.push({ severity: 'warning', message })
  if (action.type === 'move' || action.type === 'detach') {
    const to = action.to
    const card = getCard(state, action.card)
    if (to && !ZONES[to.zone].field && to.player && to.player !== card.owner) {
      warn(`${action.card} belongs to ${card.owner}; cards go to their owner's ${ZONES[to.zone].label}`)
    }
  }
  if (action.type === 'move' && action.summon && !['monster', 'extraMonster'].includes(action.to.zone)) {
    warn(`${action.card} is summoned into ${ZONES[action.to.zone].label}, not a Monster Zone`)
  }
  if (action.type === 'attach' && !isOnField(state, action.to)) {
    warn(`${action.to} isn't on the field, so it can't hold materials`)
  }
  return issues
}

// Validate every action of a step in sequence (each against the state the
// previous one produced). Stops at the first error, since later actions would
// be checked against a state that never happened.
export function validateStep(provider: RulesProvider, state: BoardState, actions: Action[]): Issue[] {
  const issues: Issue[] = []
  let current = state
  for (const [i, action] of actions.entries()) {
    const found = provider.validate(current, action).map((x) => ({ ...x, action: i }))
    issues.push(...found)
    if (found.some((x) => x.severity === 'error')) break
    current = applyAction(current, action).state
  }
  return issues
}
