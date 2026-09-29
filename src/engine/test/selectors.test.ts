import { applyAction } from '../actions'
import { currentAtk, currentDef, currentName, hasSpecialSummoned } from '../selectors'
import { createInitialState } from '../setup'
import type { Action, BoardState } from '../types'
import { lookup, makeSetup } from './fixtures'

const LV7 = 'p1-armed-dragon-lv7-1'
const run = (state: BoardState, ...actions: Action[]) => actions.reduce((acc, a) => applyAction(acc, a).state, state)

describe('selectors', () => {
  const s = createInitialState(makeSetup())

  it('derives ATK from base stats plus modifiers in order', () => {
    expect(currentAtk(s, LV7, lookup)).toBe(2800)
    const state = run(
      s,
      { type: 'modify', modifier: { id: 'half', target: LV7, kind: 'atk', op: 'multiply', value: 0.5, until: 'endOfTurn' } },
      { type: 'modify', modifier: { id: 'plus', target: LV7, kind: 'atk', value: 300, until: 'endOfTurn' } },
    )
    expect(currentAtk(state, LV7, lookup)).toBe(1700)
    const set = run(state, { type: 'modify', modifier: { id: 'set', target: LV7, kind: 'atk', op: 'set', value: 0, until: 'endOfTurn' } })
    expect(currentAtk(set, LV7, lookup)).toBe(0)
    expect(currentDef(state, LV7, lookup)).toBe(1000)
  })

  it('never goes below 0', () => {
    const state = run(s, { type: 'modify', modifier: { id: 'm', target: LV7, kind: 'def', value: -5000, until: 'endOfTurn' } })
    expect(currentDef(state, LV7, lookup)).toBe(0)
  })

  it('uses the latest name modifier (Fusion Tag)', () => {
    expect(currentName(s, LV7, lookup)).toBe('Armed Dragon LV7')
    const state = run(s, { type: 'modify', modifier: { id: 'tag', target: LV7, kind: 'name', value: 'VW-Tiger Catapult', until: 'endOfTurn' } })
    expect(currentName(state, LV7, lookup)).toBe('VW-Tiger Catapult')
  })

  it('falls back to the card DB for real cards', () => {
    const real = { ...s, cards: { ...s.cards, x: { iid: 'x', cardId: 1, owner: 'p1' as const, faceUp: true, position: 'atk' as const, materials: [] } } }
    const db = (id: number) => (id === 1 ? { name: 'Real Card', atk: 1234 } : undefined)
    expect(currentName(real, 'x', db)).toBe('Real Card')
    expect(currentAtk(real, 'x', db)).toBe(1234)
  })

  it('knows what was Special Summoned this duel, even after it left the field', () => {
    const setup = makeSetup()
    setup.players.p1.pool = setup.players.p1.pool.map((c) => (c.name === 'XYZ-Dragon Cannon' ? { ...c, cardId: 99 } : c))
    let state = createInitialState(setup)
    expect(hasSpecialSummoned(state, 'p1', 99)).toBe(false)
    state = run(
      state,
      { type: 'move', card: 'p1-xyz-dragon-cannon-1', to: { player: 'p1', zone: 'monster', slot: 0 }, summon: 'fusion' },
      { type: 'move', card: 'p1-xyz-dragon-cannon-1', to: { player: 'p1', zone: 'banished' } },
    )
    expect(hasSpecialSummoned(state, 'p1', 99)).toBe(true)
    expect(hasSpecialSummoned(state, 'p2', 99)).toBe(false)
  })
})
