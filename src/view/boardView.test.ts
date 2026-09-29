import { cardDb } from '../data/cards'
import { applyAction, createInitialState } from '../engine'
import { makeSetup } from '../engine/test/fixtures'
import { buildBoardView } from './boardView'

describe('buildBoardView', () => {
  const s = createInitialState(makeSetup())
  const view = buildBoardView(s, cardDb)
  const card = (iid: string) => view.cards.find((c) => c.iid === iid)

  it('shows your hand, hides the opponent hand and both decks', () => {
    const p2 = applyAction(s, { type: 'draw', player: 'p2' }).state
    const v = buildBoardView(p2, cardDb)
    expect(v.cards.find((c) => c.zone.zone === 'hand' && c.owner === 'p2')?.visible).toBe(false)
    expect(card('p1-ojamatch-1')?.visible).toBe(true)
    expect(view.zones.find((z) => z.key === 'p1.deck')?.top?.visible).toBe(false)
  })

  it('shows revealed cards for the step', () => {
    const drawn = applyAction(s, { type: 'draw', player: 'p2' }).state
    const iid = drawn.players.p2.zones.hand[0]
    const v = buildBoardView(applyAction(drawn, { type: 'reveal', cards: [iid] }).state, cardDb)
    expect(v.cards.find((c) => c.iid === iid)).toMatchObject({ visible: true, revealed: true })
  })

  it('marks your own set cards as set but still visible to you', () => {
    const set = applyAction(s, { type: 'flip', card: 'p1-armed-dragon-lv7-1' }).state
    expect(buildBoardView(set, cardDb).cards.find((c) => c.iid === 'p1-armed-dragon-lv7-1')).toMatchObject({ set: true, visible: true })
  })

  it('mirrors the opponent and places every slot', () => {
    expect(view.zones.filter((z) => z.kind === 'slots')).toHaveLength(2 * 11 + 2)
    const p1m = view.zones.find((z) => z.key === 'p1.monster.0')!.placement
    const p2m = view.zones.find((z) => z.key === 'p2.monster.0')!.placement
    expect(p2m).toEqual({ x: -p1m.x, y: -p1m.y, rotation: 180 })
  })
})
