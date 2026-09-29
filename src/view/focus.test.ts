import { applyAction, createInitialState, type Action, type BoardState, type Step } from '../engine'
import { makeSetup } from '../engine/test/fixtures'
import { stepFocus } from './focus'

// Apply a step's actions and ask where the camera should look afterwards.
const focusAfter = (actions: Action[], intent?: Step['intent']) => {
  let state: BoardState = createInitialState(makeSetup())
  const events = []
  for (const a of actions) {
    const r = applyAction(state, a)
    state = r.state
    events.push(...r.events)
  }
  return stepFocus(state, { actions, intent }, events)
}

describe('stepFocus', () => {
  it('follows the turn player on quiet steps', () => {
    expect(focusAfter([{ type: 'phase', phase: 'battle' }])).toBe('p1')
  })

  it('looks at the player whose cards move', () => {
    expect(focusAfter([{ type: 'draw', player: 'p2' }])).toBe('p2')
    expect(focusAfter([{ type: 'move', card: 'p1-ojamatch-1', to: { player: 'p1', zone: 'gy' } }])).toBe('p1')
  })

  it('shows the whole table for attacks and steps touching both sides', () => {
    expect(focusAfter([], { type: 'attack', attacker: 'p1-ojamatch-1' })).toBe('all')
    expect(focusAfter([{ type: 'draw', player: 'p1' }, { type: 'draw', player: 'p2' }])).toBe('all')
  })
})
