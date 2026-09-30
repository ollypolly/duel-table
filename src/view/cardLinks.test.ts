import { describe, expect, it } from 'vitest'
import { cardDb } from '../data/cards'
import { cardNames } from './cardLinks'

const { split } = cardNames(cardDb)
const named = (text: string) => split(text).map((p) => (typeof p === 'string' ? p : `[${p.name}]`))

describe('cardNames', () => {
  it('links whole names, the longest that fits', () => {
    expect(named('Summon Dark Magician Girl, then Dark Magician.')).toEqual(['Summon ', '[Dark Magician Girl]', ', then ', '[Dark Magician]', '.'])
  })

  it("leaves names inside longer words, and a possessive's name is still linked", () => {
    expect(named('Ojamatches')).toEqual(['Ojamatches'])
    expect(named("Ojamatch's cost")).toEqual(['[Ojamatch]', "'s cost"])
  })
})
