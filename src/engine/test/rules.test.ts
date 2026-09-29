import { cardScripts, scriptFor } from '../cards/registry'
import { tableRules, validateStep } from '../rules/tableRules'
import type { RulesProvider } from '../rules/types'
import { createInitialState } from '../setup'
import { makeSetup } from './fixtures'

describe('tableRules', () => {
  const s = createInitialState(makeSetup())

  it('reports an occupied slot as an error without throwing', () => {
    const issues = tableRules.validate(s, {
      type: 'move',
      card: 'p1-ojamatch-1',
      to: { player: 'p1', zone: 'monster', slot: 1 },
    })
    expect(issues).toEqual([{ severity: 'error', message: 'p1\'s Monster Zone slot 1 is occupied by p1-armed-dragon-lv7-1' }])
  })

  it('returns no issues for a legal table move', () => {
    expect(tableRules.validate(s, { type: 'move', card: 'p1-ojamatch-1', to: { player: 'p1', zone: 'gy' } })).toEqual([])
  })

  it('warns when a card goes to someone else’s pile', () => {
    const issues = tableRules.validate(s, { type: 'move', card: 'p1-ojamatch-1', to: { player: 'p2', zone: 'gy' } })
    expect(issues).toEqual([{ severity: 'warning', message: expect.stringContaining("owner's GY") }])
  })

  it('warns when attaching to a card that is not on the field', () => {
    const issues = tableRules.validate(s, { type: 'attach', card: 'p1-ojama-yellow-1', to: 'p1-fusion-tag-1' })
    expect(issues[0]).toMatchObject({ severity: 'warning' })
  })

  it('validates a step in sequence and stops at the first error', () => {
    const issues = validateStep(tableRules, s, [
      { type: 'move', card: 'p1-ojamatch-1', to: { player: 'p1', zone: 'monster', slot: 0 } },
      { type: 'move', card: 'p1-fusion-tag-1', to: { player: 'p1', zone: 'monster', slot: 0 } },
      { type: 'flip', card: 'nope' },
    ])
    expect(issues).toEqual([{ severity: 'error', action: 1, message: expect.stringMatching(/slot 0 is occupied/) }])
  })

  it('is one pluggable provider among many', () => {
    const strict: RulesProvider = { name: 'noDraws', validate: (_, a) => (a.type === 'draw' ? [{ severity: 'error', message: 'no' }] : []) }
    expect(validateStep(strict, s, [{ type: 'draw', player: 'p1' }])).toHaveLength(1)
  })
})

describe('card script registry', () => {
  it('exists and is empty in Level 1', () => {
    expect(cardScripts).toEqual({})
    expect(scriptFor(12345)).toBeUndefined()
  })
})

describe('engine purity', () => {
  const sources = import.meta.glob(['../**/*.ts', '!../**/*.test.ts', '!./**'], { query: '?raw', import: 'default', eager: true })

  it('imports nothing from React, Zustand, Node or the DOM', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5)
    for (const [file, src] of Object.entries(sources)) {
      expect(src, file).not.toMatch(/from ['"](react|zustand|node:|fs|path)/)
      expect(src, file).not.toMatch(/\b(window|document|localStorage|Date\.now|Math\.random)\b/)
    }
  })
})
