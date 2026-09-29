// Which part of the table a step is about, for the camera: the player whose
// cards it moves, activates or summons, or the whole table when it involves
// both (an attack, an effect on the opponent's card). Quiet steps follow the
// turn player.
import { controllerOf, type BoardState, type EngineEvent, type Player, type Step } from '../engine'
import type { FocusArea } from './layout'

export function stepFocus(state: BoardState, step: Step | undefined, events: EngineEvent[]): FocusArea {
  if (step?.intent?.type === 'attack') return 'all'
  const touched = new Set<Player>()
  const byCard = (iid: string) => state.cards[iid] && touched.add(controllerOf(state, iid))
  const i = step?.intent
  if (i && 'card' in i) byCard(i.card)
  for (const a of state.arrows) [a.from, a.to].forEach(byCard)
  for (const e of events) {
    if (e.type === 'moved') {
      if ('zone' in e.to && e.to.zone.player) touched.add(e.to.zone.player)
      else byCard(e.card)
      if ('zone' in e.from && e.from.zone.player) touched.add(e.from.zone.player)
    }
    if (e.type === 'summoned' || e.type === 'drew' || e.type === 'turnStarted') touched.add(e.player)
    if (e.type === 'chainLinkAdded') touched.add(e.link.player)
    if (e.type === 'flipped' || e.type === 'positionChanged') byCard(e.card)
    if (e.type === 'modifierAdded') byCard(e.modifier.target)
  }
  if (touched.size === 2) return 'all'
  return [...touched][0] ?? state.activePlayer
}
