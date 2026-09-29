import type { GameSetup, SetupCard } from '../setup'

const monster = (name: string, atk: number, def = 1000): SetupCard => ({
  name,
  extra: false,
  custom: { name, text: `${name} text`, kind: 'monster', atk, def },
})
const spell = (name: string): SetupCard => ({ name, extra: false, custom: { name, text: '', kind: 'spell' } })
const extra = (name: string, atk: number): SetupCard => ({
  name,
  extra: true,
  custom: { name, text: '', kind: 'extra', atk, def: 2000 },
})

export const lookup = () => undefined

// A small duel built from custom cards, so engine tests don't depend on the card DB.
export function makeSetup(overrides: Partial<GameSetup> = {}): GameSetup {
  return {
    seed: 42,
    players: {
      p1: {
        name: 'You',
        pool: [
          monster('Ojama Yellow', 0),
          monster('Ojama Green', 0),
          monster('Armed Dragon LV7', 2800),
          spell('Ojamatch'),
          spell('Ojamatch'),
          spell('Fusion Tag'),
          ...Array.from({ length: 10 }, (_, i) => monster(`Filler ${i}`, 100 * i)),
          extra('XYZ-Dragon Cannon', 2800),
          extra('XYZ-Dragon Cannon', 2800),
        ],
        placed: {
          hand: [{ name: 'Ojamatch' }, { name: 'Fusion Tag' }],
          monster: [null, { name: 'Armed Dragon LV7' }],
        },
      },
      p2: {
        name: 'Friend',
        pool: [monster('Blue Layer', 1200), monster('Black Layer', 2400), extra('Magnaliger', 2600)],
      },
    },
    ...overrides,
  }
}
