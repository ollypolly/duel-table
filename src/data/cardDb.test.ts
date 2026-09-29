import cardsJson from '../../data/cards.json'
import { createCardDb, isExtraDeckCard, type CardDbFile } from './cardDb'

const db = createCardDb(cardsJson as CardDbFile)

describe('cardDb', () => {
  it('looks up by passcode', () => {
    expect(db.byId(38395123)?.name).toBe('Ojamatch')
  })

  it('looks up by name ignoring case and punctuation', () => {
    expect(db.byName('ash blossom and joyous spring')).toBeUndefined()
    expect(db.byName('ash blossom & joyous spring')?.id).toBe(14558127)
    expect(db.byName('XYZ-DRAGON CANNON')?.frameType).toBe('fusion')
  })

  it('stores Xyz rank separately from level', () => {
    const grampulse = db.byName('Super Quantal Mech Beast Grampulse')!
    expect(grampulse.rank).toBe(3)
    expect(grampulse.level).toBeUndefined()
  })

  it('suggests close matches for typos', () => {
    expect(db.closeMatches('Ojamassimilaton')[0]).toBe('Ojamassimilation')
    expect(db.closeMatches('Armed Dragon LV8')).toContain('Armed Dragon LV7')
    expect(db.closeMatches('Completely Unrelated Thing')).toEqual([])
  })

  it('knows which cards live in the Extra Deck', () => {
    expect(isExtraDeckCard(db.byName('VW-Tiger Catapult')!)).toBe(true)
    expect(isExtraDeckCard(db.byName('V-Tiger Jet')!)).toBe(false)
  })

  it('has every card in the Chazz deck', async () => {
    const deck = (await import('../../decks/chazz-armed-ojama.json')).default
    const missing = [...deck.main, ...deck.extra].filter((e) => !db.byName(e.name))
    expect(missing).toEqual([])
  })
})
