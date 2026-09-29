import { StepError, stateAt, timeline, type ScriptedGame } from '../replay'
import { createInitialState } from '../setup'
import { makeSetup } from './fixtures'

const game: ScriptedGame = {
  setup: makeSetup(),
  steps: [
    { label: 'Draw', actions: [{ type: 'phase', phase: 'main1' }, { type: 'draw', player: 'p1' }] },
    {
      label: 'Ojamatch',
      actions: [
        { type: 'move', card: 'p1-ojamatch-1', to: { player: 'p1', zone: 'spellTrap', slot: 0 } },
        { type: 'highlight', cards: ['p1-ojamatch-1'] },
        { type: 'reveal', cards: ['p1-fusion-tag-1'] },
      ],
    },
    { label: 'Shuffle', actions: [{ type: 'shuffle', player: 'p1', zone: 'deck' }, { type: 'draw', player: 'p1' }] },
  ],
}

describe('replay', () => {
  it('stateAt(-1) is the setup state', () => {
    expect(stateAt(game, -1)).toEqual(createInitialState(game.setup))
  })

  it('is deterministic, including shuffles', () => {
    expect(stateAt(game, 2)).toEqual(stateAt(game, 2))
    expect(JSON.stringify(timeline(game))).toBe(JSON.stringify(timeline(game)))
  })

  it('timeline matches stateAt at every step', () => {
    const t = timeline(game)
    expect(t).toHaveLength(4)
    for (let n = -1; n < game.steps.length; n++) expect(t[n + 1].state).toEqual(stateAt(game, n))
  })

  it('clears reveals and highlights at the start of every step', () => {
    expect(stateAt(game, 1).highlights).toEqual(['p1-ojamatch-1'])
    expect(stateAt(game, 1).revealed).toEqual(['p1-fusion-tag-1'])
    expect(stateAt(game, 2).highlights).toEqual([])
    expect(stateAt(game, 2).revealed).toEqual([])
  })

  it('collects each step’s events', () => {
    const t = timeline(game)
    expect(t[1].events.map((e) => e.type)).toEqual(['phaseChanged', 'moved', 'drew'])
  })

  it('reports which step and action failed', () => {
    const bad: ScriptedGame = {
      ...game,
      steps: [...game.steps, { actions: [{ type: 'phase', phase: 'end' }, { type: 'flip', card: 'p1-nope-1' }] }],
    }
    expect(() => timeline(bad)).toThrow(StepError)
    try {
      timeline(bad)
    } catch (e) {
      expect(e).toMatchObject({ step: 3, action: 1, message: 'Step 4, action 2: Unknown card "p1-nope-1"' })
    }
  })
})
