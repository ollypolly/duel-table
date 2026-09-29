import { createInitialState, iidFor, slug } from '../setup'
import { makeSetup } from './fixtures'

describe('createInitialState', () => {
  it('generates predictable iids from owner, slug and copy number', () => {
    expect(slug('Ash Blossom & Joyous Spring')).toBe('ash-blossom-joyous-spring')
    expect(iidFor('p1', 'XYZ-Dragon Cannon', 2)).toBe('p1-xyz-dragon-cannon-2')
    const s = createInitialState(makeSetup())
    expect(Object.keys(s.cards)).toContain('p1-ojamatch-2')
    expect(Object.keys(s.cards)).toContain('p2-blue-layer-1')
  })

  it('places named cards, lowest copy first', () => {
    const s = createInitialState(makeSetup())
    expect(s.players.p1.zones.hand).toEqual(['p1-ojamatch-1', 'p1-fusion-tag-1'])
    expect(s.players.p1.zones.monster).toEqual([null, 'p1-armed-dragon-lv7-1', null, null, null])
    expect(s.cards['p1-armed-dragon-lv7-1'].faceUp).toBe(true)
    expect(s.cards['p1-ojamatch-1'].faceUp).toBe(false)
  })

  it('puts Extra Deck cards in the Extra Deck and shuffles the rest into the Deck', () => {
    const s = createInitialState(makeSetup())
    expect(s.players.p1.zones.extraDeck).toEqual(['p1-xyz-dragon-cannon-1', 'p1-xyz-dragon-cannon-2'])
    expect(s.players.p1.zones.deck).toHaveLength(13)
    expect(s.players.p1.zones.deck).toContain('p1-ojamatch-2')
    expect(s.players.p2.zones.deck.sort()).toEqual(['p2-black-layer-1', 'p2-blue-layer-1'])
  })

  it('shuffles deterministically by seed', () => {
    const a = createInitialState(makeSetup()).players.p1.zones.deck
    const b = createInitialState(makeSetup()).players.p1.zones.deck
    const c = createInitialState(makeSetup({ seed: 7 })).players.p1.zones.deck
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('stacks listed Deck cards on top in order', () => {
    const setup = makeSetup()
    setup.players.p1.placed!.deck = [{ name: 'Filler 3' }, { name: 'Filler 1' }]
    const deck = createInitialState(setup).players.p1.zones.deck
    expect(deck.slice(0, 2)).toEqual(['p1-filler-3-1', 'p1-filler-1-1'])
  })

  it('places Xyz materials and Extra Monster Zone cards', () => {
    const setup = makeSetup({ extraMonster: [{ player: 'p2', name: 'Magnaliger', materials: ['Blue Layer'] }, null] })
    const s = createInitialState(setup)
    expect(s.extraMonster).toEqual(['p2-magnaliger-1', null])
    expect(s.cards['p2-magnaliger-1'].materials).toEqual(['p2-blue-layer-1'])
    expect(s.players.p2.zones.deck).toEqual(['p2-black-layer-1'])
  })

  it('fails clearly when setup places a card the player does not have', () => {
    const setup = makeSetup()
    setup.players.p1.placed!.hand!.push({ name: 'Ojamatch' }, { name: 'Ojamatch' })
    expect(() => createInitialState(setup)).toThrow(/no unplaced copy is left/)
  })

  it('starts at 8000 LP, turn 1, p1 active', () => {
    const s = createInitialState(makeSetup())
    expect(s.players.p1.lp).toBe(8000)
    expect([s.turn, s.activePlayer, s.phase]).toEqual([1, 'p1', 'draw'])
  })
})
