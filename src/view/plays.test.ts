import { expect, test } from 'vitest'
import type { Step } from '../engine'
import { played, turnSoFar } from './plays'

const step = (label: string, rest: Partial<Step> = {}): Step => ({ label, actions: [], ...rest })
const set = (card: string): Step => step('Set a monster', { actions: [{ type: 'move', card, to: { player: 'p1', zone: 'monster', slot: 0 }, faceUp: false, position: 'def' }] })

test('a play is a summon, an activation, an attack or a Set, not a phase', () => {
  expect(played(step('Main Phase 1'))).toBeUndefined()
  expect(played(step('Resolve X'))).toBeUndefined()
  expect(played(step('Activate X', { intent: { type: 'activate', card: 'p2-x-1' } }))).toEqual({ card: 'p2-x-1', shown: true })
  expect(played(set('p2-y-1'))).toEqual({ card: 'p2-y-1', shown: false })
})

test("the turn so far counts only this turn's plays with the player's own cards", () => {
  const steps = [
    step('Turn 1'),
    step('Normal Summon A', { intent: { type: 'normalSummon', card: 'p1-a-1' } }),
    step('Turn 2'),
    step('Activate B', { intent: { type: 'activate', card: 'p2-b-1' } }),
    step('Turn 3'),
    step('Main Phase 1', { author: 'user' }),
  ]
  expect(turnSoFar(steps, 'p1')).toEqual({ plays: 0, normalUsed: false })
  steps.push(step('Activate C', { intent: { type: 'activate', card: 'p1-c-1' } }))
  expect(turnSoFar(steps, 'p1')).toEqual({ plays: 1, normalUsed: false })
  steps.push(set('p1-d-1'))
  expect(turnSoFar(steps, 'p1')).toEqual({ plays: 2, normalUsed: true })
})
