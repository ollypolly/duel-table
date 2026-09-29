import cardsJson from '../../data/cards.json'
import deck from '../../decks/chazz-armed-ojama.json'
import { createCardDb, type CardDbFile } from '../data/cardDb'
import { resolveScenario, type ResolveContext } from '../scenarios/resolve'
import { branchFrom, describeAction, parseBranch, tryAction, uniqueId } from './branches'

const db = createCardDb(cardsJson as CardDbFile)
const base = {
  id: 'base',
  title: 'Base',
  seed: 1,
  players: { p1: { name: 'You', deck: 'chazz-armed-ojama' }, p2: { name: 'Friend', cards: ['Super Quantum Blue Layer'] } },
  setup: { p1: { hand: ['Ojamatch', 'Fusion Tag'], monster: [null, 'Armed Dragon LV7'] } },
  steps: [
    { label: 'A', actions: [{ type: 'move', card: 'p1-ojamatch-1', to: { player: 'p1', zone: 'gy' } }] },
    { label: 'B', actions: [{ type: 'draw', player: 'p1' }] },
    { label: 'C', actions: [{ type: 'phase', phase: 'end' }] },
  ],
}
const ctx = (scenarios: Record<string, unknown> = {}): ResolveContext => ({
  db,
  decks: { 'chazz-armed-ojama': deck },
  scenarios: { base, ...scenarios },
})
const resolved = (raw: unknown, c = ctx()) => {
  const r = resolveScenario(raw, c)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.scenario
}

describe('branchFrom', () => {
  it('forks a scenario at a position (0 = setup)', () => {
    expect(branchFrom(resolved(base), 2, [])).toEqual({
      id: 'base--branch-1',
      title: 'Base (branch 1 from step 2)',
      extends: { scenario: 'base', atStep: 1 },
      steps: [],
    })
    expect(branchFrom(resolved(base), 0, ['base--branch-1']).extends).toEqual({ scenario: 'base', atStep: -1 })
    expect(branchFrom(resolved(base), 0, ['base--branch-1']).id).toBe('base--branch-2')
  })

  it('flattens a branch of a branch onto the root scenario', () => {
    const own = { label: 'X', actions: [{ type: 'phase', phase: 'battle' }] }
    const b1 = { ...branchFrom(resolved(base), 2, []), steps: [own, own] }
    const r1 = resolved(b1, ctx({ [b1.id]: b1 }))
    // After one of the branch's own steps: same root, fewer own steps.
    const after = branchFrom(r1, 3, [b1.id])
    expect(after.extends).toEqual({ scenario: 'base', atStep: 1 })
    expect(after.steps).toEqual([own])
    expect(after.title).toBe('Base (branch 2 from step 3)')
    // Inside the inherited part: a plain fork of the root.
    expect(branchFrom(r1, 1, [b1.id])).toMatchObject({ extends: { scenario: 'base', atStep: 0 }, steps: [] })
    expect(resolved(after).timeline).toHaveLength(4)
  })
})

describe('tryAction', () => {
  const state = resolved(base).timeline[0].state

  it('wraps a valid action as a labelled step', () => {
    const r = tryAction(state, { type: 'move', card: 'p1-fusion-tag-1', to: { player: 'p1', zone: 'spellTrap', slot: 0 }, faceUp: false }, db)
    expect(r).toEqual({ ok: true, warnings: [], step: { label: 'Set Fusion Tag', actions: [expect.any(Object)] } })
  })

  it('rejects physically impossible actions and passes warnings through', () => {
    const occupied = tryAction(state, { type: 'move', card: 'p1-fusion-tag-1', to: { player: 'p1', zone: 'monster', slot: 1 } }, db)
    expect(occupied.ok).toBe(false)
    const wrongOwner = tryAction(state, { type: 'move', card: 'p1-fusion-tag-1', to: { player: 'p2', zone: 'gy' } }, db)
    expect(wrongOwner.ok && wrongOwner.warnings).toEqual([expect.stringContaining("owner's GY")])
  })
})

describe('describeAction', () => {
  const state = resolved(base).timeline[0].state
  it.each([
    [{ type: 'move', card: 'p1-ojamatch-1', to: { player: 'p1', zone: 'gy' } }, 'Ojamatch to your GY'],
    [{ type: 'move', card: 'p1-ojamatch-1', to: { player: 'p2', zone: 'banished' } }, "Ojamatch to Friend's Banished"],
    [{ type: 'move', card: 'p1-xyz-dragon-cannon-1', to: { zone: 'extraMonster' }, summon: 'special' }, 'Special Summon XYZ-Dragon Cannon'],
    [{ type: 'draw', player: 'p1' }, 'You draw'],
    [{ type: 'draw', player: 'p2', count: 2 }, 'Friend draws 2'],
    [{ type: 'lp', player: 'p2', delta: -1500 }, 'Friend loses 1500 LP'],
    [{ type: 'lp', player: 'p1', set: 4000 }, 'Set your LP to 4000'],
    [{ type: 'nextTurn' }, 'Turn 2'],
    [{ type: 'position', card: 'p1-armed-dragon-lv7-1', position: 'def' }, 'Armed Dragon LV7 to Defense Position'],
  ] as const)('%j → %s', (action, label) => {
    expect(describeAction(state, action, db)).toBe(label)
  })
})

describe('import helpers', () => {
  it('only accepts fork files', () => {
    expect(parseBranch(base).ok).toBe(false)
    expect(parseBranch({ id: 'b', title: 'B', extends: { scenario: 'base', atStep: 0 }, steps: [] }).ok).toBe(true)
    expect(parseBranch({ id: 'b', extends: { scenario: 'base', atStep: 0 }, steps: [] }).ok).toBe(false)
  })

  it('picks a free id', () => {
    expect(uniqueId('b', ['a'])).toBe('b')
    expect(uniqueId('b', ['b', 'b-2'])).toBe('b-3')
  })
})
