import cardsJson from '../../data/cards.json'
import deck from '../../decks/chazz-armed-ojama.json'
import freeTable from '../../scenarios/free-table.json'
import { createCardDb, type CardDbFile } from '../data/cardDb'
import { resolveScenario, type ResolveContext } from './resolve'

const db = createCardDb(cardsJson as CardDbFile)
const base = {
  id: 'base',
  title: 'Base',
  seed: 1,
  players: { p1: { name: 'You', deck: 'chazz-armed-ojama' }, p2: { name: 'Friend', cards: ['Super Quantum Blue Layer'] } },
  setup: { p1: { hand: ['ojamatch', 'Fusion Tag'], monster: [null, 'Armed Dragon LV7'] } },
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
const errorsOf = (raw: unknown, c = ctx()) => {
  const r = resolveScenario(raw, c)
  if (r.ok) throw new Error('expected failure')
  return r.errors
}

describe('resolveScenario', () => {
  it('resolves decks, names and placements into a replayable game', () => {
    const r = resolveScenario(base, ctx())
    if (!r.ok) throw new Error(r.errors.join('\n'))
    const s = r.scenario
    expect(s.game.setup.players.p1.pool).toHaveLength(55)
    expect(s.timeline).toHaveLength(4)
    expect(s.timeline[0].state.players.p1.zones.hand).toEqual(['p1-ojamatch-1', 'p1-fusion-tag-1'])
    expect(s.timeline[0].state.cards['p1-ojamatch-1'].cardId).toBe(38395123)
    expect(s.timeline[0].state.players.p1.zones.extraDeck).toContain('p1-xyz-dragon-cannon-1')
  })

  it("uses a game's copy of its deck over the deck file", () => {
    const list = { id: 'chazz-armed-ojama', name: 'Old list', main: [{ name: 'Ojamatch', count: 3 }], extra: [] }
    const r = resolveScenario({ ...base, setup: undefined, players: { ...base.players, p1: { name: 'You', deck: 'chazz-armed-ojama', list } } }, ctx())
    if (!r.ok) throw new Error(r.errors.join('\n'))
    expect(r.scenario.game.setup.players.p1).toMatchObject({ deck: 'chazz-armed-ojama', pool: [{ name: 'Ojamatch' }, { name: 'Ojamatch' }, { name: 'Ojamatch' }] })
  })

  it('resolves the shipped free-table scenario', () => {
    const r = resolveScenario(freeTable, ctx())
    expect(r.ok ? [] : r.errors).toEqual([])
  })

  it('suggests close matches for unknown card names', () => {
    const bad = { ...base, players: { ...base.players, p2: { name: 'F', cards: ['Super Quantum Blu Layer'] } } }
    expect(errorsOf(bad)[0]).toMatch(/^players.p2.cards: unknown card "Super Quantum Blu Layer". Did you mean "Super Quantum Blue Layer", /)
  })

  it('rejects setup placements of cards the player does not own', () => {
    const bad = { ...base, setup: { p1: { hand: ['Super Quantum Blue Layer'] } } }
    expect(errorsOf(bad)[0]).toMatch(/setup.p1.hand\[0\]: "Super Quantum Blue Layer" isn't one of p1's cards/)
  })

  it('gives readable schema errors', () => {
    const bad = { ...base, steps: [{ actions: [{ type: 'move', card: 'x', to: { zone: 'moster', player: 'p1' } }] }] }
    expect(errorsOf(bad).join('\n')).toMatch(/scenario at steps.0.actions.0.to.zone/)
    expect(errorsOf({ ...base, id: 'Bad Id' })[0]).toMatch(/lowercase-with-dashes/)
  })

  it('names the failing step and suggests iids', () => {
    const bad = { ...base, steps: [...base.steps, { label: 'Oops', actions: [{ type: 'flip', card: 'p1-ojamatch-9' }] }] }
    expect(errorsOf(bad)).toEqual(['Step 4, action 1: Unknown card "p1-ojamatch-9" (step "Oops"). Did you mean p1-ojamatch-1, p1-ojamatch-2, p1-ojamatch-3?'])
  })

  it('collects tableRules warnings without failing', () => {
    const warn = { ...base, steps: [{ actions: [{ type: 'move', card: 'p1-ojamatch-1', to: { player: 'p2', zone: 'gy' } }] }] }
    const r = resolveScenario(warn, ctx())
    expect(r.ok && r.scenario.warnings).toEqual([expect.stringMatching(/^Step 1, action 1: .*owner's GY/)])
  })

  describe('forks', () => {
    const fork = { id: 'fork', title: 'Fork', extends: { scenario: 'base', atStep: 1 }, steps: [{ label: 'D', actions: [{ type: 'phase', phase: 'battle' }] }] }

    it('replays the parent up to atStep, then its own steps', () => {
      const r = resolveScenario(fork, ctx({ fork }))
      if (!r.ok) throw new Error(r.errors.join('\n'))
      expect(r.scenario.game.steps.map((s) => s.label)).toEqual(['A', 'B', 'D'])
      expect(r.scenario.inheritedSteps).toBe(2)
      expect(r.scenario.timeline.at(-1)!.state.phase).toBe('battle')
    })

    it('rejects loops, unknown parents and out-of-range steps', () => {
      const loop = { ...fork, id: 'loop', extends: { scenario: 'loop2', atStep: 0 } }
      const loop2 = { ...fork, id: 'loop2', extends: { scenario: 'loop', atStep: 0 } }
      expect(errorsOf(loop, ctx({ loop, loop2 }))[0]).toMatch(/extends loops/)
      expect(errorsOf({ ...fork, extends: { scenario: 'nope', atStep: 0 } })[0]).toMatch(/unknown scenario "nope"/)
      expect(errorsOf({ ...fork, extends: { scenario: 'base', atStep: 5 } })[0]).toMatch(/only has steps 0-2/)
    })

    it('does not let a fork redefine players', () => {
      expect(errorsOf({ ...fork, players: base.players }).join()).toMatch(/inherits players/)
    })
  })
})
