import { applyAction } from '../actions'
import { createInitialState } from '../setup'
import type { Action, BoardState } from '../types'
import { locate } from '../zones'
import { makeSetup } from './fixtures'

const LV7 = 'p1-armed-dragon-lv7-1'
const MATCH = 'p1-ojamatch-1'
const TAG = 'p1-fusion-tag-1'

let s: BoardState
beforeEach(() => {
  s = createInitialState(makeSetup())
})

const run = (state: BoardState, ...actions: Action[]) =>
  actions.reduce((acc, a) => applyAction(acc, a).state, state)

describe('applyAction', () => {
  it('never mutates its input', () => {
    const before = structuredClone(s)
    applyAction(s, { type: 'move', card: MATCH, to: { player: 'p1', zone: 'gy' } })
    expect(s).toEqual(before)
  })

  describe('move', () => {
    it('moves into a named slot and reports from/to', () => {
      const { state, events } = applyAction(s, {
        type: 'move',
        card: MATCH,
        to: { player: 'p1', zone: 'spellTrap', slot: 2 },
        cause: { reason: 'manual' },
      })
      expect(state.players.p1.zones.spellTrap[2]).toBe(MATCH)
      expect(state.players.p1.zones.hand).toEqual([TAG])
      expect(state.cards[MATCH].faceUp).toBe(true)
      expect(events).toEqual([
        {
          type: 'moved',
          card: MATCH,
          from: { zone: { player: 'p1', zone: 'hand' }, index: 0 },
          to: { zone: { player: 'p1', zone: 'spellTrap', slot: 2 }, index: 2 },
          cause: { reason: 'manual' },
        },
      ])
    })

    it('picks the first empty slot when none is given', () => {
      const state = run(s, { type: 'move', card: 'p1-ojama-yellow-1', to: { player: 'p1', zone: 'monster' } })
      expect(state.players.p1.zones.monster[0]).toBe('p1-ojama-yellow-1')
    })

    it('throws on an occupied slot', () => {
      expect(() =>
        applyAction(s, { type: 'move', card: MATCH, to: { player: 'p1', zone: 'monster', slot: 1 } }),
      ).toThrow(/slot 1 is occupied by p1-armed-dragon-lv7-1/)
    })

    it('throws on an unknown card or slot', () => {
      expect(() => applyAction(s, { type: 'move', card: 'nope', to: { player: 'p1', zone: 'gy' } })).toThrow(
        /Unknown card "nope"/,
      )
      expect(() =>
        applyAction(s, { type: 'move', card: MATCH, to: { player: 'p1', zone: 'monster', slot: 7 } }),
      ).toThrow(/no slot 7/)
    })

    it('sets face-down in Defense Position', () => {
      const state = run(s, {
        type: 'move',
        card: 'p1-ojama-green-1',
        to: { player: 'p1', zone: 'monster', slot: 0 },
        faceUp: false,
        position: 'def',
      })
      expect(state.cards['p1-ojama-green-1']).toMatchObject({ faceUp: false, position: 'def' })
    })

    it('puts cards on top of piles by default, at the end of the hand, or at an index', () => {
      let state = run(s, { type: 'move', card: MATCH, to: { player: 'p1', zone: 'gy' } })
      state = run(state, { type: 'move', card: TAG, to: { player: 'p1', zone: 'gy' } })
      expect(state.players.p1.zones.gy).toEqual([TAG, MATCH])
      state = run(state, { type: 'move', card: LV7, to: { player: 'p1', zone: 'hand' } })
      expect(state.players.p1.zones.hand).toEqual([LV7])
      state = run(state, { type: 'move', card: LV7, to: { player: 'p1', zone: 'gy' }, index: 99 })
      expect(state.players.p1.zones.gy).toEqual([TAG, MATCH, LV7])
    })

    it('resets position when a card leaves the field', () => {
      let state = run(s, { type: 'position', card: LV7, position: 'def' })
      state = run(state, { type: 'move', card: LV7, to: { player: 'p1', zone: 'gy' } })
      expect(state.cards[LV7]).toMatchObject({ position: 'atk', faceUp: true })
    })

    it('uses the shared Extra Monster Zone', () => {
      const state = run(s, {
        type: 'move',
        card: 'p1-xyz-dragon-cannon-1',
        to: { zone: 'extraMonster', slot: 1 },
        summon: 'fusion',
      })
      expect(state.extraMonster).toEqual([null, 'p1-xyz-dragon-cannon-1'])
      expect(locate(state, 'p1-xyz-dragon-cannon-1')).toEqual({ zone: { zone: 'extraMonster', slot: 1 }, index: 1 })
    })
  })

  describe('summons', () => {
    it('records history and emits summoned for Special Summons', () => {
      const { state, events } = applyAction(s, {
        type: 'move',
        card: 'p1-xyz-dragon-cannon-1',
        to: { player: 'p1', zone: 'monster', slot: 0 },
        summon: 'fusion',
      })
      expect(state.history).toEqual([
        { turn: 1, kind: 'summoned', player: 'p1', card: 'p1-xyz-dragon-cannon-1', method: 'fusion' },
      ])
      expect(events.at(-1)).toEqual({ type: 'summoned', card: 'p1-xyz-dragon-cannon-1', method: 'fusion', player: 'p1' })
      expect(state.turnFlags.normalSummonUsed.p1).toBe(false)
    })

    it('marks the Normal Summon as used', () => {
      const state = run(s, {
        type: 'move',
        card: 'p1-ojama-yellow-1',
        to: { player: 'p1', zone: 'monster', slot: 0 },
        summon: 'normal',
      })
      expect(state.turnFlags.normalSummonUsed).toEqual({ p1: true, p2: false })
    })

    it('rejects a summon that does not land in a Monster Zone', () => {
      expect(() =>
        applyAction(s, { type: 'move', card: MATCH, to: { player: 'p1', zone: 'spellTrap', slot: 0 }, summon: 'special' }),
      ).toThrow(/isn't in a Monster Zone/)
    })
  })

  describe('draw', () => {
    it('draws from the top of the Deck into the hand', () => {
      const top = s.players.p1.zones.deck.slice(0, 2)
      const { state, events } = applyAction(s, { type: 'draw', player: 'p1', count: 2 })
      expect(state.players.p1.zones.hand).toEqual([MATCH, TAG, ...top])
      expect(state.players.p1.zones.deck).toHaveLength(11)
      expect(events.at(-1)).toEqual({ type: 'drew', player: 'p1', cards: top })
    })

    it('defaults to one card and throws when the Deck runs out', () => {
      expect(applyAction(s, { type: 'draw', player: 'p2' }).state.players.p2.zones.hand).toHaveLength(1)
      expect(() => applyAction(s, { type: 'draw', player: 'p2', count: 3 })).toThrow(/only 2 card/)
    })
  })

  describe('shuffle', () => {
    it('shuffles a pile reproducibly using the state RNG', () => {
      const a = applyAction(s, { type: 'shuffle', player: 'p1', zone: 'deck' }).state
      const b = applyAction(s, { type: 'shuffle', player: 'p1', zone: 'deck' }).state
      expect(a.players.p1.zones.deck).toEqual(b.players.p1.zones.deck)
      expect(a.players.p1.zones.deck).not.toEqual(s.players.p1.zones.deck)
      expect(a.rng.cursor).toBeGreaterThan(s.rng.cursor)
      const twice = applyAction(a, { type: 'shuffle', player: 'p1', zone: 'deck' }).state
      expect(twice.players.p1.zones.deck).not.toEqual(a.players.p1.zones.deck)
    })

    it('refuses to shuffle a slot zone', () => {
      expect(() => applyAction(s, { type: 'shuffle', player: 'p1', zone: 'monster' as never })).toThrow(/isn't a pile/)
    })
  })

  it('changes LP by delta (floored at 0) or sets it', () => {
    let r = applyAction(s, { type: 'lp', player: 'p2', delta: -200, cause: { reason: 'battle' } })
    expect(r.state.players.p2.lp).toBe(7800)
    expect(r.events).toEqual([{ type: 'lpChanged', player: 'p2', from: 8000, to: 7800, cause: { reason: 'battle' } }])
    r = applyAction(r.state, { type: 'lp', player: 'p2', delta: -9999 })
    expect(r.state.players.p2.lp).toBe(0)
    expect(applyAction(s, { type: 'lp', player: 'p1', set: 4000 }).state.players.p1.lp).toBe(4000)
  })

  it('changes phase', () => {
    const { state, events } = applyAction(s, { type: 'phase', phase: 'main1' })
    expect(state.phase).toBe('main1')
    expect(events).toEqual([{ type: 'phaseChanged', from: 'draw', to: 'main1' }])
  })

  describe('nextTurn', () => {
    it('passes the turn, resets turn flags and goes to the Draw Phase', () => {
      let state = run(s, { type: 'move', card: 'p1-ojama-yellow-1', to: { player: 'p1', zone: 'monster' }, summon: 'normal' }, { type: 'phase', phase: 'end' })
      const r = applyAction(state, { type: 'nextTurn' })
      state = r.state
      expect([state.turn, state.activePlayer, state.phase]).toEqual([2, 'p2', 'draw'])
      expect(state.turnFlags.normalSummonUsed.p1).toBe(false)
      expect(r.events).toContainEqual({ type: 'turnStarted', turn: 2, player: 'p2' })
    })

    it('expires end-of-turn modifiers now and end-of-next-turn ones a turn later', () => {
      let state = run(
        s,
        { type: 'modify', modifier: { id: 'eot', target: LV7, kind: 'atk', value: 500, until: 'endOfTurn' } },
        { type: 'modify', modifier: { id: 'eont', target: LV7, kind: 'cannotAttack', until: 'endOfNextTurn' } },
        { type: 'modify', modifier: { id: 'perm', target: LV7, kind: 'negated', until: 'permanent' } },
      )
      state = run(state, { type: 'nextTurn' })
      expect(state.modifiers.map((m) => m.id)).toEqual(['eont', 'perm'])
      state = run(state, { type: 'nextTurn' })
      expect(state.modifiers.map((m) => m.id)).toEqual(['perm'])
    })
  })

  describe('attach / detach', () => {
    it('attaches a card as material and detaches it to the GY by default', () => {
      let state = run(
        s,
        { type: 'move', card: 'p1-xyz-dragon-cannon-1', to: { player: 'p1', zone: 'monster', slot: 0 } },
        { type: 'attach', card: 'p1-ojama-yellow-1', to: 'p1-xyz-dragon-cannon-1' },
      )
      expect(state.cards['p1-xyz-dragon-cannon-1'].materials).toEqual(['p1-ojama-yellow-1'])
      expect(state.players.p1.zones.deck).not.toContain('p1-ojama-yellow-1')
      expect(locate(state, 'p1-ojama-yellow-1')).toEqual({ materialOf: 'p1-xyz-dragon-cannon-1', index: 0 })
      state = run(state, { type: 'detach', card: 'p1-ojama-yellow-1' })
      expect(state.cards['p1-xyz-dragon-cannon-1'].materials).toEqual([])
      expect(state.players.p1.zones.gy[0]).toBe('p1-ojama-yellow-1')
    })

    it('brings an attached monster’s own materials along', () => {
      const state = run(
        s,
        { type: 'move', card: 'p1-xyz-dragon-cannon-1', to: { player: 'p1', zone: 'monster', slot: 0 } },
        { type: 'attach', card: 'p1-ojama-yellow-1', to: 'p1-xyz-dragon-cannon-1' },
        { type: 'move', card: 'p1-xyz-dragon-cannon-2', to: { player: 'p1', zone: 'monster', slot: 2 } },
        { type: 'attach', card: 'p1-xyz-dragon-cannon-1', to: 'p1-xyz-dragon-cannon-2' },
      )
      expect(state.cards['p1-xyz-dragon-cannon-2'].materials).toEqual(['p1-xyz-dragon-cannon-1', 'p1-ojama-yellow-1'])
      expect(state.cards['p1-xyz-dragon-cannon-1'].materials).toEqual([])
    })

    it('sends materials to the GY when their monster leaves the field', () => {
      const { state, events } = applyAction(
        run(
          s,
          { type: 'move', card: 'p1-xyz-dragon-cannon-1', to: { player: 'p1', zone: 'monster', slot: 0 } },
          { type: 'attach', card: 'p1-ojama-yellow-1', to: 'p1-xyz-dragon-cannon-1' },
        ),
        { type: 'move', card: 'p1-xyz-dragon-cannon-1', to: { player: 'p1', zone: 'extraDeck' } },
      )
      expect(state.players.p1.zones.gy).toEqual(['p1-ojama-yellow-1'])
      expect(state.players.p1.zones.extraDeck[0]).toBe('p1-xyz-dragon-cannon-1')
      expect(events.find((e) => e.type === 'moved' && e.card === 'p1-ojama-yellow-1')).toMatchObject({
        cause: { card: 'p1-xyz-dragon-cannon-1', reason: 'rule' },
      })
    })

    it('refuses to detach a card that is not material', () => {
      expect(() => applyAction(s, { type: 'detach', card: MATCH })).toThrow(/isn't attached/)
    })
  })

  it('flips and changes position', () => {
    let state = run(s, { type: 'flip', card: LV7 })
    expect(state.cards[LV7].faceUp).toBe(false)
    state = run(state, { type: 'position', card: LV7, position: 'def' })
    expect(state.cards[LV7].position).toBe('def')
  })

  it('records reveals, highlights and arrows', () => {
    const state = run(
      s,
      { type: 'reveal', cards: [MATCH] },
      { type: 'highlight', cards: [LV7] },
      { type: 'arrow', from: LV7, to: 'p2-blue-layer-1' },
    )
    expect(state.revealed).toEqual([MATCH])
    expect(state.highlights).toEqual([LV7])
    expect(state.arrows).toEqual([{ from: LV7, to: 'p2-blue-layer-1' }])
  })

  describe('modify / unmodify', () => {
    it('adds a modifier stamped with the turn, and removes it by id', () => {
      let state = run(s, { type: 'modify', modifier: { id: 'tag', target: LV7, kind: 'name', value: 'VW-Tiger Catapult', until: 'endOfTurn' } })
      expect(state.modifiers).toEqual([
        { id: 'tag', target: LV7, kind: 'name', value: 'VW-Tiger Catapult', until: 'endOfTurn', turn: 1 },
      ])
      expect(() => run(state, { type: 'modify', modifier: { id: 'tag', target: LV7, kind: 'atk', until: 'endOfTurn' } })).toThrow(
        /already exists/,
      )
      state = run(state, { type: 'unmodify', id: 'tag' })
      expect(state.modifiers).toEqual([])
      expect(() => run(state, { type: 'unmodify', id: 'tag' })).toThrow(/No modifier/)
    })

    it('drops non-permanent modifiers when the card leaves the field', () => {
      const state = run(
        s,
        { type: 'modify', modifier: { id: 'a', target: LV7, kind: 'atk', value: 100, until: 'leavesField' } },
        { type: 'modify', modifier: { id: 'b', target: LV7, kind: 'atk', value: 100, until: 'permanent' } },
        { type: 'move', card: LV7, to: { player: 'p1', zone: 'gy' } },
      )
      expect(state.modifiers.map((m) => m.id)).toEqual(['b'])
    })
  })

  describe('chain', () => {
    it('builds up and resolves in reverse order', () => {
      let r = applyAction(s, { type: 'chainPush', card: MATCH, label: 'Ojamatch' })
      r = applyAction(r.state, { type: 'chainPush', card: 'p2-blue-layer-1' })
      expect(r.state.chain).toEqual([
        { card: MATCH, player: 'p1', label: 'Ojamatch' },
        { card: 'p2-blue-layer-1', player: 'p2' },
      ])
      expect(r.events).toEqual([{ type: 'chainLinkAdded', link: { card: 'p2-blue-layer-1', player: 'p2' }, number: 2 }])
      r = applyAction(r.state, { type: 'chainResolve' })
      expect(r.events).toEqual([{ type: 'chainLinkResolved', link: { card: 'p2-blue-layer-1', player: 'p2' }, number: 2 }])
      r = applyAction(r.state, { type: 'chainResolve' })
      expect(r.state.chain).toEqual([])
      expect(() => applyAction(r.state, { type: 'chainResolve' })).toThrow(/chain is empty/)
    })
  })
})
