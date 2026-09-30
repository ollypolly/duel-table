// The translator on hand-made core messages, for moves bot duels rarely make.
import { describe, expect, it } from 'vitest'
import { applyAction } from '../../src/engine'
import { resolveScenario, type ResolvedScenario } from '../../src/scenarios/resolve'
import { repoContext } from '../files'
import type { OcgDuel } from './duel'
import { LOC, M, POS, type Ocg } from './lib'
import { Translator } from './translate'

const ctx = repoContext()

// Free table with p1's first monster Set in Monster Zone 1, and a translator
// over a core that reports nothing else.
function withSetMonster() {
  const r = resolveScenario(ctx().scenarios['free-table'], ctx())
  if (!r.ok) throw new Error(r.errors.join('\n'))
  let state = (r.scenario as ResolvedScenario).timeline.at(-1)!.state
  const iid = state.players.p1.zones.deck.find((i) => ctx().db.byId(state.cards[i].cardId!)?.type.includes('Monster'))!
  state = applyAction(state, { type: 'move', card: iid, to: { player: 'p1', zone: 'monster', slot: 0 }, faceUp: false, position: 'def' }).state
  const ocg = { card: (code: number) => ({ name: ctx().db.byId(code)?.name, type: 0 }) } as unknown as Ocg
  const duel = { fieldCards: () => [] } as unknown as OcgDuel
  return { iid, code: state.cards[iid].cardId!, translator: new Translator(state, ocg, duel) }
}

const message = <T extends object>(Class: new () => T, fields: Partial<T>) => Object.assign(new Class(), fields)

describe('Translator', () => {
  it('turns a Flip Summoned monster face-up in attack position', () => {
    const { iid, code, translator } = withSetMonster()
    const [step] = translator.feed([message(M.YGOProMsgFlipSummoning, { code, controller: 0, location: LOC.mzone, sequence: 0, position: POS.faceUpAtk })], 'p1')
    expect(step.label).toMatch(/^Flip Summon/)
    expect(translator.state.cards[iid]).toMatchObject({ faceUp: true, position: 'atk' })
  })

  it("doesn't flip twice when a position change follows", () => {
    const { iid, code, translator } = withSetMonster()
    translator.feed([
      message(M.YGOProMsgFlipSummoning, { code, controller: 0, location: LOC.mzone, sequence: 0, position: POS.faceUpAtk }),
      message(M.YGOProMsgPosChange, {
        code,
        card: { controller: 0, location: LOC.mzone, sequence: 0 },
        previousPosition: POS.faceDownDef,
        currentPosition: POS.faceUpAtk,
      }),
    ])
    expect(translator.state.cards[iid]).toMatchObject({ faceUp: true, position: 'atk' })
  })
})
