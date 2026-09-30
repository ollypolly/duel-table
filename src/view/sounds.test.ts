import { describe, expect, it } from 'vitest'
import type { EngineEvent, Location } from '../engine'
import { stepSounds } from './sounds'

const at = (zone: 'monster' | 'gy' | 'hand' | 'extraDeck'): Location => ({ zone: { player: 'p1', zone }, index: 0 })
const moved = (from: Location, to: Location, reason?: 'battle' | 'effect' | 'cost'): EngineEvent => ({
  type: 'moved',
  card: 'c1',
  from,
  to,
  ...(reason && { cause: { reason } }),
})

describe('stepSounds', () => {
  it('plays a Special Summon over the materials going to the GY', () => {
    const events: EngineEvent[] = [
      moved(at('monster'), at('gy'), 'cost'),
      moved(at('extraDeck'), at('monster')),
      { type: 'summoned', card: 'c2', method: 'link', player: 'p1' },
    ]
    expect(stepSounds(events)).toEqual(['summon', 'place'])
  })

  it('crunches for a card destroyed in battle, with the damage', () => {
    const events: EngineEvent[] = [moved(at('monster'), at('gy'), 'battle'), { type: 'lpChanged', player: 'p2', from: 8000, to: 7000 }]
    expect(stepSounds(events)).toEqual(['destroy', 'damage'])
  })

  it('slides a card to the hand, and whooshes for an attack', () => {
    expect(stepSounds([moved(at('gy'), at('hand'), 'effect')])).toEqual(['slide'])
    expect(stepSounds([], [{ type: 'arrow', from: 'c1', to: 'c2' }])).toEqual(['attack'])
  })
})
