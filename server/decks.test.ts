// @vitest-environment node
import { buildDeck, expandDeck, parseDeckList } from './decks'
import { loadCardDb } from './files'

const db = loadCardDb()

describe('parseDeckList', () => {
  it('reads counts in any common form, merges repeats and skips the side deck', () => {
    const { entries, skipped } = parseDeckList(`
      Main Deck:
      3 Ojamatch
      2x Ash Blossom & Joyous Spring
      Ojamagic x3
      // a comment
      Ojama Yellow
      1 ojamatch
      #extra
      XYZ-Dragon Cannon
      Side Deck:
      3 Infinite Impermanence
      0 Nothing
    `)
    expect(entries).toEqual([
      { name: 'Ojamatch', count: 4 },
      { name: 'Ash Blossom & Joyous Spring', count: 2 },
      { name: 'Ojamagic', count: 3 },
      { name: 'Ojama Yellow', count: 1 },
      { name: 'XYZ-Dragon Cannon', count: 1 },
    ])
    expect(skipped).toEqual([])
  })
})

describe('buildDeck', () => {
  it('resolves names, sorts Extra Deck cards by type and warns on size', () => {
    const { file, unknown, warnings } = buildDeck(
      'test',
      'Test',
      [
        { name: 'ojamatch', count: 3 },
        { name: 'XYZ-Dragon Cannon', count: 1 },
        { name: 'Not A Card', count: 1 },
      ],
      db,
    )
    expect(file).toEqual({ id: 'test', name: 'Test', main: [{ name: 'Ojamatch', count: 3 }], extra: [{ name: 'XYZ-Dragon Cannon', count: 1 }] })
    expect(unknown).toEqual(['Not A Card'])
    expect(warnings).toEqual(['Main Deck has 3 cards (40 to 60 is legal)'])
  })
})

describe('expandDeck', () => {
  it('puts card data beside each count', () => {
    const d = expandDeck({ id: 'x', name: 'X', main: [{ name: 'Ojamatch', count: 3 }], extra: [] }, db)
    expect(d.size).toEqual({ main: 3, extra: 0 })
    expect(d.main[0]).toMatchObject({ count: 3, name: 'Ojamatch', desc: expect.any(String), id: expect.any(Number) })
  })
})
